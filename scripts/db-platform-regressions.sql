-- Synthetic, transactional fixtures for the YouTube and Instagram connectors,
-- the sealed credential store and Reddit tracking. Root harness runs only in
-- isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  payload jsonb; status jsonb; failed boolean; written integer; stored record;
  synced_keys text[] := array[
    'youtube.subscribers', 'youtube.total_views', 'youtube.videos_published', 'youtube.views', 'youtube.watch_hours',
    'youtube.likes', 'youtube.comments', 'youtube.shares', 'youtube.subscribers_gained', 'youtube.subscribers_lost',
    'youtube.shorts_views',
    'instagram.followers', 'instagram.posts_published', 'instagram.reach', 'instagram.views', 'instagram.interactions',
    'instagram.likes', 'instagram.comments', 'instagram.shares', 'instagram.saves', 'instagram.profile_link_taps'
  ];
  key text;
begin
  ---------------------------------------------------------------------------
  -- Every metric a connector writes exists, is active, and accepts connector values.
  ---------------------------------------------------------------------------
  foreach key in array synced_keys loop
    if not exists (select 1 from public.analytics_metric_definitions d
      where d.metric_key = key and d.active and d.entry_mode in ('manual', 'connector') and d.aggregation <> 'ratio') then
      raise exception 'connector metric % must be defined and writable', key;
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('metricKey', k, 'date', today - 1, 'value', 3)) into payload from unnest(synced_keys) k;
  written := public.upsert_analytics_metric_values(payload, 'connector', 'connector:youtube');
  if written <> array_length(synced_keys, 1) then
    raise exception 'connector values must all be stored, got %', written;
  end if;

  -- Watch hours keep two decimals; counts stay whole.
  perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', 'youtube.watch_hours', 'date', today - 2, 'value', 12.75)), 'connector', 'connector:youtube');
  if (select value from public.analytics_metric_daily where metric_key = 'youtube.watch_hours' and metric_date = today - 2 and dimension_key = '') <> 12.75 then
    raise exception 'watch hours must keep decimals';
  end if;

  -- Connector-only metrics cannot be typed in; manual Reddit numbers can.
  begin
    perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', 'youtube.total_views', 'date', today, 'value', 10)), 'manual', 'admin');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'youtube.total_views must only be written by its integration'; end if;

  ---------------------------------------------------------------------------
  -- Reddit: content and DM outreach are logged by hand; the reply rate is derived.
  ---------------------------------------------------------------------------
  perform public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'reddit.dms_sent', 'date', today - 3, 'value', 20),
    jsonb_build_object('metricKey', 'reddit.dms_sent', 'date', today - 2, 'value', 20),
    jsonb_build_object('metricKey', 'reddit.dm_replies', 'date', today - 2, 'value', 6),
    jsonb_build_object('metricKey', 'reddit.dm_calls_booked', 'date', today - 1, 'value', 1),
    jsonb_build_object('metricKey', 'reddit.upvotes', 'date', today - 1, 'value', 41),
    jsonb_build_object('metricKey', 'reddit.comments', 'date', today - 1, 'value', 9),
    jsonb_build_object('metricKey', 'reddit.karma', 'date', today - 1, 'value', 1200)
  ), 'manual', 'admin');
  payload := public.load_analytics_series(array['reddit.dm_reply_rate', 'reddit.dms_sent', 'reddit.dm_replies'], 'day', today - 6, today);
  if (select (s ->> 'current')::numeric from jsonb_array_elements(payload -> 'series') s where s ->> 'metric_key' = 'reddit.dm_reply_rate') <> 0.15 then
    raise exception 'Reddit DM reply rate must be replies over DMs sent, got %', payload -> 'series';
  end if;
  begin
    perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', 'reddit.dm_reply_rate', 'date', today, 'value', 0.5)), 'connector', 'connector:ingest');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'the Reddit reply rate must never be written directly'; end if;
  if (select category from public.analytics_metric_definitions where metric_key = 'reddit.dms_sent') <> 'outreach' then
    raise exception 'Reddit DMs belong with outreach';
  end if;

  ---------------------------------------------------------------------------
  -- Run log: fixed tokens only, pruned after 90 days, summarised per connector.
  ---------------------------------------------------------------------------
  perform public.record_analytics_connector_run('youtube', 'synced', null, 12);
  perform public.record_analytics_connector_run('instagram', 'rejected', 'token_expired', 0);
  begin
    perform public.record_analytics_connector_run('instagram', 'rejected', 'Error validating access token: Session has expired', 0);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'run reasons must be tokens, never provider text'; end if;
  begin
    perform public.record_analytics_connector_run('reddit', 'synced', null, 1);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'only known connectors may record runs'; end if;
  begin
    perform public.record_analytics_connector_run('youtube', 'exploded', null, 1);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'run status must be a known value'; end if;
  perform public.record_analytics_connector_run('youtube', 'partial', 'rate_limited', -5);
  if (select values_written from public.analytics_connector_runs where connector = 'youtube' order by id desc limit 1) <> 0 then
    raise exception 'a negative count must be stored as zero';
  end if;

  insert into public.analytics_connector_runs (connector, status, reason, values_written, ran_at)
  values ('youtube', 'synced', null, 1, now() - interval '91 days');
  perform public.record_analytics_connector_run('youtube', 'synced', null, 2);
  if exists (select 1 from public.analytics_connector_runs where ran_at < now() - interval '90 days') then
    raise exception 'runs older than 90 days must be pruned';
  end if;

  status := public.load_analytics_connector_status();
  if status -> 'youtube' ->> 'last_status' <> 'synced' or status -> 'youtube' ->> 'last_synced_at' is null
    or status -> 'instagram' ->> 'last_status' <> 'rejected' or status -> 'instagram' ->> 'last_reason' <> 'token_expired'
    or status -> 'instagram' ->> 'last_synced_at' is not null then
    raise exception 'connector status must show the latest run and the latest sync, got %', status;
  end if;

  ---------------------------------------------------------------------------
  -- Credentials: only sealed values, one row per connector, replaced in place.
  ---------------------------------------------------------------------------
  begin
    perform public.save_analytics_connector_credential('instagram', 'IGQVJplaintexttoken', now() + interval '60 days');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'a plaintext token must never be stored'; end if;
  perform public.save_analytics_connector_credential('instagram', 'v1.aaaaaaaaaaaaaaaa.bbbbbbbb.cccccccccccccccccccccc', now() + interval '60 days');
  perform public.save_analytics_connector_credential('instagram', 'v1.dddddddddddddddd.eeeeeeee.ffffffffffffffffffffff', now() + interval '59 days');
  select * into stored from public.load_analytics_connector_credential('instagram');
  if stored.sealed <> 'v1.dddddddddddddddd.eeeeeeee.ffffffffffffffffffffff' or (select count(*) from public.analytics_connector_credentials) <> 1 then
    raise exception 'saving a credential must replace the previous one';
  end if;
  if exists (select 1 from public.load_analytics_connector_credential('youtube')) then
    raise exception 'a connector without a stored credential must return no row';
  end if;

  ---------------------------------------------------------------------------
  -- Nothing here is reachable from the browser roles, and tables are RPC-only.
  ---------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.load_analytics_connector_credential(text)', 'execute')
    or has_function_privilege('authenticated', 'public.load_analytics_connector_credential(text)', 'execute')
    or has_function_privilege('anon', 'public.save_analytics_connector_credential(text,text,timestamp with time zone)', 'execute')
    or has_function_privilege('authenticated', 'public.save_analytics_connector_credential(text,text,timestamp with time zone)', 'execute')
    or has_function_privilege('anon', 'public.record_analytics_connector_run(text,text,text,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.record_analytics_connector_run(text,text,text,integer)', 'execute')
    or has_function_privilege('anon', 'public.load_analytics_connector_status()', 'execute')
    or has_function_privilege('authenticated', 'public.load_analytics_connector_status()', 'execute')
    or has_table_privilege('anon', 'public.analytics_connector_credentials', 'select')
    or has_table_privilege('authenticated', 'public.analytics_connector_credentials', 'select')
    or has_table_privilege('service_role', 'public.analytics_connector_credentials', 'select')
    or has_table_privilege('service_role', 'public.analytics_connector_credentials', 'insert')
    or has_table_privilege('service_role', 'public.analytics_connector_runs', 'select')
    or has_table_privilege('service_role', 'public.analytics_connector_runs', 'delete') then
    raise exception 'connector credentials and runs must remain internal';
  end if;
  if not has_function_privilege('service_role', 'public.load_analytics_connector_credential(text)', 'execute')
    or not has_function_privilege('service_role', 'public.save_analytics_connector_credential(text,text,timestamp with time zone)', 'execute')
    or not has_function_privilege('service_role', 'public.record_analytics_connector_run(text,text,text,integer)', 'execute')
    or not has_function_privilege('service_role', 'public.load_analytics_connector_status()', 'execute') then
    raise exception 'trusted server code must reach the connector RPCs';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.analytics_connector_credentials'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.analytics_connector_runs'::regclass) then
    raise exception 'connector tables must have row level security on';
  end if;

  raise notice 'platform regressions passed: connector metrics, Reddit DMs, run log, sealed credentials, permissions';
end;
$$;
rollback;
