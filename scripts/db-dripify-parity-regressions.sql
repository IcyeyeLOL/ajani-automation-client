-- Synthetic, transactional fixtures for Dripify dashboard parity (new activity,
-- leads remaining, statuses, inbox counts) and load_analytics_latest_values.
-- Root harness runs only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  payload jsonb; failed boolean; latest record; total integer;
  keys text[] := array['dripify.new_contacted', 'dripify.new_accepted', 'dripify.new_replies', 'dripify.leads_remaining',
    'dripify.leads_in_progress', 'dripify.leads_finished', 'dripify.leads_failed', 'dripify.unread_messages', 'dripify.active_campaigns'];
  key text;
begin
  ---------------------------------------------------------------------------
  -- New metrics exist, belong to the connector, and only the connector writes them.
  ---------------------------------------------------------------------------
  foreach key in array keys loop
    if not exists (select 1 from public.analytics_metric_definitions where metric_key = key and active and entry_mode = 'connector' and category = 'outreach') then
      raise exception 'Dripify metric % must exist and be connector-owned', key;
    end if;
    begin
      perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', key, 'date', today, 'value', 1)), 'manual', 'admin');
      failed := false;
    exception when others then failed := true;
    end;
    if not failed then raise exception '% must not be typed in by hand', key; end if;
  end loop;

  ---------------------------------------------------------------------------
  -- Period rates are new replies or acceptances over new contacts in the range.
  ---------------------------------------------------------------------------
  perform public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'dripify.new_contacted', 'date', today - 2, 'dimension', 'dripify:10', 'value', 30),
    jsonb_build_object('metricKey', 'dripify.new_contacted', 'date', today - 1, 'dimension', 'dripify:10', 'value', 20),
    jsonb_build_object('metricKey', 'dripify.new_contacted', 'date', today - 1, 'dimension', 'dripify:11', 'value', 50),
    jsonb_build_object('metricKey', 'dripify.new_accepted', 'date', today - 1, 'dimension', 'dripify:10', 'value', 25),
    jsonb_build_object('metricKey', 'dripify.new_replies', 'date', today - 1, 'dimension', 'dripify:11', 'value', 10)
  ), 'connector', 'connector:dripify');
  payload := public.load_analytics_series(array['dripify.period_acceptance_rate', 'dripify.period_reply_rate', 'dripify.new_contacted'], 'day', today - 6, today);
  if (select (s ->> 'current')::numeric from jsonb_array_elements(payload -> 'series') s where s ->> 'metric_key' = 'dripify.period_acceptance_rate') <> 0.25
    or (select (s ->> 'current')::numeric from jsonb_array_elements(payload -> 'series') s where s ->> 'metric_key' = 'dripify.period_reply_rate') <> 0.1
    or (select (s ->> 'current')::numeric from jsonb_array_elements(payload -> 'series') s where s ->> 'metric_key' = 'dripify.new_contacted') <> 100 then
    raise exception 'Dripify period figures must add up across campaigns, got %', payload -> 'series';
  end if;

  ---------------------------------------------------------------------------
  -- Latest value per account before a date, with the account's display name.
  ---------------------------------------------------------------------------
  perform public.upsert_analytics_dimension_labels(jsonb_build_array(jsonb_build_object('dimension', 'dripify:10', 'label', 'Insurance owners TX')), 'connector:dripify');
  perform public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today - 3, 'dimension', 'dripify:10', 'value', 100),
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today - 1, 'dimension', 'dripify:10', 'value', 140),
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today, 'dimension', 'dripify:10', 'value', 150),
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today - 5, 'dimension', 'dripify:11', 'value', 70)
  ), 'connector', 'connector:dripify');

  select * into latest from public.load_analytics_latest_values(array['dripify.leads_contacted'], today) where dimension_key = 'dripify:10';
  if latest.value <> 140 or latest.metric_date <> today - 1 or latest.label <> 'Insurance owners TX' then
    raise exception 'latest value before today must be yesterday''s total with its label, got %', latest;
  end if;
  select count(*) into total from public.load_analytics_latest_values(array['dripify.leads_contacted'], today + 1);
  if total <> 2 or (select value from public.load_analytics_latest_values(array['dripify.leads_contacted'], today + 1) where dimension_key = 'dripify:10') <> 150 then
    raise exception 'one latest row per account must be returned, including today when asked';
  end if;
  if exists (select 1 from public.load_analytics_latest_values(array['dripify.leads_contacted'], today - 5)) then
    raise exception 'values on or after the cut-off date must be excluded';
  end if;
  begin
    perform public.load_analytics_latest_values(array[]::text[], today);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'an empty key list must be refused'; end if;
  begin
    perform public.load_analytics_latest_values(array_fill('dripify.leads_contacted'::text, array[21]), today);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'more than twenty keys must be refused'; end if;

  if has_function_privilege('anon', 'public.load_analytics_latest_values(text[],date)', 'execute')
    or has_function_privilege('authenticated', 'public.load_analytics_latest_values(text[],date)', 'execute') then
    raise exception 'latest values must remain internal';
  end if;
  if not has_function_privilege('service_role', 'public.load_analytics_latest_values(text[],date)', 'execute') then
    raise exception 'trusted server code must read latest values';
  end if;

  raise notice 'Dripify parity regressions passed: connector-owned metrics, period rates, latest values, permissions';
end;
$$;
rollback;
