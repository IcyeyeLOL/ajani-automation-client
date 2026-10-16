-- Synthetic, transactional fixtures for platform connectors (Dripify) and
-- account display labels. Root harness runs only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  series jsonb; catalog jsonb; item jsonb; written integer; failed boolean;
begin
  ---------------------------------------------------------------------------
  -- Only the connector writes dripify.* counts; rates are always computed.
  ---------------------------------------------------------------------------
  begin
    perform public.upsert_analytics_metric_values(
      jsonb_build_array(jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today, 'dimension', 'dripify:1', 'value', 5)),
      'manual', 'audit_connector');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'manual entry must not overwrite connector metrics'; end if;
  begin
    perform public.upsert_analytics_metric_values(
      jsonb_build_array(jsonb_build_object('metricKey', 'dripify.reply_rate', 'date', today, 'dimension', 'dripify:1', 'value', 0.2)),
      'connector', 'connector:dripify');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'rates must never be stored'; end if;

  -- Campaign 1 is synced on days -2 and 0; campaign 2 only on day -1, so its
  -- snapshot must carry forward into day 0.
  written := public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today - 2, 'dimension', 'dripify:1', 'value', 100),
    jsonb_build_object('metricKey', 'dripify.leads_accepted', 'date', today - 2, 'dimension', 'dripify:1', 'value', 10),
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today - 1, 'dimension', 'dripify:2', 'value', 20),
    jsonb_build_object('metricKey', 'dripify.leads_accepted', 'date', today - 1, 'dimension', 'dripify:2', 'value', 5),
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today, 'dimension', 'dripify:1', 'value', 110),
    jsonb_build_object('metricKey', 'dripify.leads_accepted', 'date', today, 'dimension', 'dripify:1', 'value', 12)
  ), 'connector', 'connector:dripify');
  if written <> 6 then raise exception 'connector snapshots must be written, got %', written; end if;

  -- A re-run on the same day replaces the snapshot instead of adding to it.
  written := public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'dripify.leads_contacted', 'date', today, 'dimension', 'dripify:1', 'value', 110),
    jsonb_build_object('metricKey', 'dripify.leads_accepted', 'date', today, 'dimension', 'dripify:1', 'value', 13)
  ), 'connector', 'connector:dripify');
  if written <> 1 then raise exception 'a same-day re-sync must replace only changed values, got %', written; end if;

  series := public.load_analytics_series(array['dripify.leads_contacted', 'dripify.acceptance_rate'], 'day', today - 2, today);
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'dripify.leads_contacted';
  if item->'values' <> '[100, 120, 130]'::jsonb or (item->>'current')::numeric <> 130 then
    raise exception 'campaign snapshots must carry forward and sum across campaigns: %', item;
  end if;
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'dripify.acceptance_rate';
  if (item->>'current_numerator')::numeric <> 18 or (item->>'current_denominator')::numeric <> 130
    or (item #>> '{values,0}')::numeric <> 0.1 or (item->>'current')::numeric <> round(18 / 130.0, 6) then
    raise exception 'acceptance must be recomputed from exact counts: %', item;
  end if;

  series := public.load_analytics_series(array['dripify.leads_contacted'], 'day', today - 2, today, 'dripify:2');
  if series #> '{series,0,values}' <> '[null, 20, 20]'::jsonb then
    raise exception 'a campaign filter must isolate one campaign: %', series #> '{series,0}';
  end if;

  ---------------------------------------------------------------------------
  -- Display labels: normalized, idempotent, validated, and display-only.
  ---------------------------------------------------------------------------
  written := public.upsert_analytics_dimension_labels(jsonb_build_array(
    jsonb_build_object('dimension', 'DRIPIFY:1', 'label', E'  Insurance\n owners   TX '),
    jsonb_build_object('dimension', 'dripify:2', 'label', 'Agencies'),
    jsonb_build_object('dimension', 'dripify:99', 'label', 'No data yet')
  ), 'connector:dripify');
  if written <> 3 or (select label from public.analytics_dimension_labels where dimension_key = 'dripify:1') <> 'Insurance owners TX' then
    raise exception 'labels must be keyed like accounts and whitespace-normalized';
  end if;
  if public.upsert_analytics_dimension_labels('[{"dimension":"dripify:2","label":"Agencies"}]'::jsonb, 'connector:dripify') <> 0 then
    raise exception 'an unchanged label must be a no-op';
  end if;
  -- Separate statements: a statement does not see its own function's writes.
  written := public.upsert_analytics_dimension_labels(jsonb_build_array(jsonb_build_object('dimension', 'dripify:2', 'label', repeat('x', 200))), 'connector:dripify');
  if written <> 1 or (select char_length(label) from public.analytics_dimension_labels where dimension_key = 'dripify:2') <> 120 then
    raise exception 'long labels must be shortened, not rejected';
  end if;
  foreach item in array array[
    '{"dimension":"bad key!","label":"x"}'::jsonb,
    '{"dimension":"dripify:3","label":"   "}'::jsonb,
    '{"dimension":"dripify:3","label":7}'::jsonb,
    '{"dimension":"","label":"Main"}'::jsonb
  ]
  loop
    begin
      perform public.upsert_analytics_dimension_labels(jsonb_build_array(item), 'connector:dripify');
      failed := false;
    exception when others then failed := true;
    end;
    if not failed then raise exception 'invalid label must be rejected: %', item; end if;
  end loop;
  begin
    perform public.upsert_analytics_dimension_labels('{"dimension":"dripify:3"}'::jsonb, 'connector:dripify');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'labels must arrive as an array'; end if;

  catalog := public.load_analytics_catalog();
  if catalog #>> '{dimension_labels,dripify:1}' <> 'Insurance owners TX' or catalog->'dimension_labels' ? 'dripify:99' then
    raise exception 'the catalog must label accounts that have data, and only those: %', catalog->'dimension_labels';
  end if;
  select value into item from jsonb_array_elements(catalog->'metrics') where value->>'metric_key' = 'dripify.acceptance_rate';
  if not (item->'dimensions' ? 'dripify:1' and item->'dimensions' ? 'dripify:2') or (item->>'last_date')::date <> today then
    raise exception 'connector ratios must expose their campaigns and coverage: %', item;
  end if;

  -- With more than 50 accounts, the most recently recorded ones stay listed.
  perform public.upsert_analytics_metric_values((
    select jsonb_agg(jsonb_build_object('metricKey', 'instagram.reach', 'date', today - 60 + n, 'dimension', '@acct' || lpad(n::text, 2, '0'), 'value', n))
    from generate_series(1, 55) n
  ), 'manual', 'audit_connector');
  select value into item from jsonb_array_elements(public.load_analytics_catalog()->'metrics') where value->>'metric_key' = 'instagram.reach';
  if jsonb_array_length(item->'dimensions') <> 50 or not (item->'dimensions' ? '@acct55') or item->'dimensions' ? '@acct01' then
    raise exception 'account lists must keep the most recent 50 accounts: %', item->'dimensions';
  end if;

  ---------------------------------------------------------------------------
  -- Privileges: labels are internal and written only through the RPC.
  ---------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.upsert_analytics_dimension_labels(jsonb,text)', 'execute')
    or has_function_privilege('authenticated', 'public.upsert_analytics_dimension_labels(jsonb,text)', 'execute')
    or has_function_privilege('authenticated', 'public.load_analytics_catalog()', 'execute')
    or has_table_privilege('authenticated', 'public.analytics_dimension_labels', 'select')
    or has_table_privilege('service_role', 'public.analytics_dimension_labels', 'insert')
    or has_table_privilege('service_role', 'public.analytics_dimension_labels', 'update') then
    raise exception 'account labels must remain internal and RPC-written';
  end if;
  if not has_function_privilege('service_role', 'public.upsert_analytics_dimension_labels(jsonb,text)', 'execute')
    or not has_function_privilege('service_role', 'public.load_analytics_catalog()', 'execute')
    or not has_table_privilege('service_role', 'public.analytics_dimension_labels', 'select') then
    raise exception 'trusted server code must read and label accounts';
  end if;

  raise notice 'connector regressions passed: connector-only writes, carry-forward sums, exact rates, labels, recency, permissions';
end;
$$;
rollback;
