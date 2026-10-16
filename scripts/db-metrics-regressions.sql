-- Synthetic, transactional fixtures for measurement accuracy and the metric store.
-- Root harness runs only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  week_start date := date_trunc('week', (now() at time zone 'UTC')::date::timestamp)::date;
  baseline jsonb; snapshot jsonb; series jsonb; catalog jsonb; item jsonb;
  exp_id uuid; other_exp_id uuid; variant_a uuid; variant_b uuid; foreign_variant uuid;
  snapshot_batch uuid; plain_batch uuid; draft_id uuid; claimed_id uuid;
  baseline_saved bigint; baseline_batches bigint; written integer; failed boolean;
begin
  ---------------------------------------------------------------------------
  -- Reply rates use the exposure each reply is measured against.
  ---------------------------------------------------------------------------
  baseline := public.load_admin_analytics();
  baseline_batches := (baseline->>'batch_count')::bigint;

  exp_id := public.create_outreach_experiment('Follow-up angle audit', 'Synthetic owners', '', 'linkedin', 'manual',
    'follow_up_1', 'reply_rate', 'audit_metrics', '[{"label":"A","title":"Short"},{"label":"B","title":"Long"}]'::jsonb);
  select id into variant_a from public.outreach_variants where experiment_id = exp_id and label = 'A';
  select id into variant_b from public.outreach_variants where experiment_id = exp_id and label = 'B';
  other_exp_id := public.create_outreach_experiment('Other audit', 'Synthetic owners', '', 'linkedin', 'manual',
    'initial_dm', 'reply_rate', 'audit_metrics', '[{"label":"A","title":"One"},{"label":"B","title":"Two"}]'::jsonb);
  select id into foreign_variant from public.outreach_variants where experiment_id = other_exp_id and label = 'A';

  snapshot_batch := public.create_experiment_metric_snapshot(exp_id, today, 'Audit team', '',
    jsonb_build_array(
      jsonb_build_object('variantId', variant_a, 'sent', 100, 'replies', 20, 'positiveReplies', 5, 'callsBooked', 2, 'connectionRequests', 0, 'connectionsAccepted', 0),
      jsonb_build_object('variantId', variant_b, 'sent', 60, 'replies', 6, 'positiveReplies', 1, 'callsBooked', 0, 'connectionRequests', 0, 'connectionsAccepted', 0)
    ), 'audit_metrics');
  plain_batch := public.create_outreach_batch(today, 'Audit team', 'LinkedIn', 'Dripify', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":40,"connectionsAccepted":10,"initialDms":50,"f1Sent":20,"f2Sent":5,"customSent":0,"replies":5,"attributedReplies":5,"positiveReplies":2,"callsBooked":1}]'::jsonb,
    'audit_metrics');

  if (select sum(reply_base) from public.outreach_batch_metrics where batch_id = snapshot_batch) <> 160
    or (select reply_base from public.outreach_batch_metrics where batch_id = plain_batch) <> 50 then
    raise exception 'reply_base must equal step exposure for snapshots and initial DMs for batches';
  end if;
  if (select channel || '/' || method from public.outreach_batches where id = plain_batch) <> 'linkedin/dripify' then
    raise exception 'batch channel and method must be normalized';
  end if;
  snapshot := public.load_admin_analytics();
  if (snapshot #>> '{outreach,reply_base}')::bigint - (baseline #>> '{outreach,reply_base}')::bigint <> 210
    or (snapshot #>> '{outreach,replies}')::bigint - (baseline #>> '{outreach,replies}')::bigint <> 31
    or (snapshot #>> '{metrics,reply_base_current}')::bigint < 210 then
    raise exception 'aggregate reply rate must use reply_base, not initial DMs';
  end if;

  ---------------------------------------------------------------------------
  -- Database-level batch validation is restored.
  ---------------------------------------------------------------------------
  begin
    perform public.create_outreach_batch(today, 'Audit team', 'linkedin', 'manual', 'Synthetic owners', '', null, '',
      '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":5,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":9,"attributedReplies":0,"positiveReplies":0,"callsBooked":0}]'::jsonb,
      'audit_metrics');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'replies above initial DMs must be rejected'; end if;

  begin
    perform public.create_outreach_batch(today, 'Audit team', 'linkedin', 'manual', 'Synthetic owners', '', exp_id, '',
      jsonb_build_array(jsonb_build_object('variantId', foreign_variant, 'variantLabel', 'A', 'connectionRequests', 0,
        'connectionsAccepted', 0, 'initialDms', 5, 'f1Sent', 0, 'f2Sent', 0, 'customSent', 0, 'replies', 1,
        'attributedReplies', 1, 'positiveReplies', 0, 'callsBooked', 0)),
      'audit_metrics');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'variants from another experiment must be rejected'; end if;

  begin
    perform public.create_outreach_batch(today, 'Audit team', 'linkedin', 'manual', 'Synthetic owners', '', null, '',
      '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":0,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":0,"attributedReplies":0,"positiveReplies":0,"callsBooked":0}]'::jsonb,
      'audit_metrics');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'empty batches must be rejected'; end if;

  begin
    insert into public.outreach_batch_metrics (batch_id, variant_label, initial_dms, replies, reply_base)
    values (plain_batch, 'Direct insert', 3, 4, 3);
    failed := false;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'replies above reply_base must violate the table constraint'; end if;

  ---------------------------------------------------------------------------
  -- Voided entries leave every total, list and count.
  ---------------------------------------------------------------------------
  begin
    perform public.void_outreach_batch(plain_batch, 'x', 'audit_metrics');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'voiding requires a reason'; end if;
  if not public.void_outreach_batch(plain_batch, 'Entered twice by mistake', 'audit_metrics') then
    raise exception 'first void must succeed';
  end if;
  if public.void_outreach_batch(plain_batch, 'Entered twice by mistake', 'audit_metrics') then
    raise exception 'second void must be a no-op';
  end if;
  snapshot := public.load_admin_analytics();
  if (snapshot #>> '{outreach,reply_base}')::bigint - (baseline #>> '{outreach,reply_base}')::bigint <> 160
    or (snapshot->>'batch_count')::bigint <> baseline_batches + 1
    or exists (select 1 from jsonb_array_elements(snapshot->'recent_batches') b where b->>'id' = plain_batch::text) then
    raise exception 'voided batches must be excluded from totals, counts and lists';
  end if;
  if not exists (select 1 from public.admin_activity_log where entity_id = plain_batch::text and action = 'voided') then
    raise exception 'voids must be audited';
  end if;

  ---------------------------------------------------------------------------
  -- Failed saves do not inflate saved-draft cohorts.
  ---------------------------------------------------------------------------
  select coalesce(saved, 0) into baseline_saved from public.request_cohort_daily where cohort_day = today;
  baseline_saved := coalesce(baseline_saved, 0);
  insert into public.request_drafts(token_hash) values (md5('metrics-discard') || md5('metrics-discard-2')) returning id into draft_id;
  insert into public.request_draft_ai_states(request_draft_id, transcript_fingerprint, latest_extraction, approved_revision, approved_hash, approved_plain_language_scope)
  values (draft_id, 'metrics-fingerprint', '{}', 1, 'metrics-hash', 'Metrics approved scope');
  if (select saved from public.request_cohort_daily where cohort_day = today) <> baseline_saved + 1 then
    raise exception 'saving must count once';
  end if;
  if not public.discard_unpublished_request_draft(draft_id) then raise exception 'discard must succeed'; end if;
  if (select saved from public.request_cohort_daily where cohort_day = today) <> baseline_saved
    or exists (select 1 from public.request_drafts where id = draft_id) then
    raise exception 'a discarded save must leave no draft and no cohort count';
  end if;
  if public.discard_unpublished_request_draft(draft_id) then raise exception 'discarding twice must be a no-op'; end if;

  -- A published (older or deletion-reserved) draft is retention's job, never a discard.
  insert into public.request_drafts(token_hash, created_at)
  values (md5('metrics-published') || md5('metrics-published-2'), now() - interval '1 hour') returning id into claimed_id;
  begin
    perform public.discard_unpublished_request_draft(claimed_id);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'published drafts must never be discarded'; end if;
  update public.request_drafts set created_at = now(), deletion_reserved_at = now() where id = claimed_id;
  begin
    perform public.discard_unpublished_request_draft(claimed_id);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'deletion-reserved drafts must never be discarded'; end if;

  ---------------------------------------------------------------------------
  -- Metric store: idempotent upserts, flows, stocks and ratios.
  ---------------------------------------------------------------------------
  written := public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'youtube.views', 'date', week_start - 7, 'value', 100),
    jsonb_build_object('metricKey', 'youtube.views', 'date', week_start - 6, 'value', 50),
    jsonb_build_object('metricKey', 'youtube.views', 'date', week_start, 'value', 30),
    jsonb_build_object('metricKey', 'youtube.subscribers', 'date', week_start - 30, 'value', 900),
    jsonb_build_object('metricKey', 'youtube.subscribers', 'date', week_start - 1, 'value', 1100),
    jsonb_build_object('metricKey', 'youtube.subscribers', 'date', week_start, 'value', 1150),
    jsonb_build_object('metricKey', 'youtube.subscribers', 'date', week_start - 3, 'dimension', ' @Second ', 'value', 200),
    jsonb_build_object('metricKey', 'sales.calls_held', 'date', week_start, 'value', 10),
    jsonb_build_object('metricKey', 'sales.deals_won', 'date', week_start, 'value', 3)
  ), 'manual', 'audit_metrics');
  if written <> 9 then raise exception 'all new values must be written, got %', written; end if;

  -- Re-entering a day replaces it; an identical value is a no-op.
  written := public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'youtube.views', 'date', week_start, 'value', 30),
    jsonb_build_object('metricKey', 'youtube.views', 'date', week_start - 6, 'value', 60)
  ), 'manual', 'audit_metrics');
  if written <> 1 or (select value from public.analytics_metric_daily where metric_key = 'youtube.views' and metric_date = week_start - 6) <> 60 then
    raise exception 're-entry must replace, never add';
  end if;
  if (select dimension_key from public.analytics_metric_daily where metric_key = 'youtube.subscribers' and metric_date = week_start - 3) <> '@second' then
    raise exception 'account keys must be normalized';
  end if;

  series := public.load_analytics_series(array['youtube.views', 'youtube.subscribers', 'sales.close_rate', 'outreach.reply_rate', 'ajani.drafts_saved'], 'week', week_start - 7, today);
  if jsonb_array_length(series->'buckets') <> 2 or (series->>'from')::date <> week_start - 7
    or (series #>> '{buckets,0,partial}')::boolean or (series #>> '{buckets,1,end}')::date <> today then
    raise exception 'weekly buckets must align to Monday and clip the current week: %', series->'buckets';
  end if;
  if (series #>> '{buckets,1,partial}')::boolean <> (week_start + 6 > today) then
    raise exception 'the current week must be marked partial until it ends';
  end if;
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'youtube.views';
  if item->'values' <> '[160, 30]'::jsonb or (item->>'current')::numeric <> 190 or item->'previous' <> 'null'::jsonb then
    raise exception 'flows must sum per bucket and stay unknown without data: %', item;
  end if;
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'youtube.subscribers';
  -- Week 0 ends Sunday: 1100 (primary) + 200 (@second). Week 1: 1150 + 200 carried forward.
  -- Previous window ends the day before week 0: only the seeded 900 is known.
  if item->'values' <> '[1300, 1350]'::jsonb or (item->>'current')::numeric <> 1350 or (item->>'previous')::numeric <> 900 then
    raise exception 'stocks must carry each account forward and sum accounts: %', item;
  end if;
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'sales.close_rate';
  if (item #>> '{values,1}')::numeric <> 0.3 or item #> '{values,0}' <> 'null'::jsonb
    or (item->>'current')::numeric <> 0.3 or (item->>'current_numerator')::numeric <> 3 then
    raise exception 'ratios must be recomputed from components and stay null without data: %', item;
  end if;
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'outreach.reply_rate';
  if (item->>'current_denominator')::numeric < 160 or (item->>'current')::numeric > 1 then
    raise exception 'derived reply rate must use reply_base and stay at or below 100%%: %', item;
  end if;
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'ajani.drafts_saved';
  if jsonb_array_length(item->'values') <> 2 or item #> '{values,0}' = 'null'::jsonb then
    raise exception 'derived flows must be zero-filled: %', item;
  end if;

  series := public.load_analytics_series(array['youtube.subscribers'], 'week', week_start - 7, today, '@SECOND');
  select value into item from jsonb_array_elements(series->'series') where value->>'metric_key' = 'youtube.subscribers';
  if item->'values' <> '[200, 200]'::jsonb then raise exception 'account filter must isolate one account: %', item; end if;

  series := public.load_analytics_series(array['outreach.touches'], 'day', today, today, 'linkedin/dripify');
  if (series #>> '{series,0,values,0}')::numeric <> 0 then
    raise exception 'voided outreach must not reach derived metrics';
  end if;

  series := public.load_analytics_series(array['youtube.views'], 'quarter', today - 400, today);
  if jsonb_array_length(series->'buckets') not between 5 and 6 then raise exception 'quarter grain must use three-month buckets'; end if;
  series := public.load_analytics_series(array['youtube.views'], 'year', today - 1500, today);
  if jsonb_array_length(series->'buckets') not between 4 and 6 then raise exception 'year grain must use annual buckets'; end if;
  series := public.load_analytics_series(array['youtube.views'], 'month', week_start - 7, today);
  if ((series #>> '{series,0,current}')::numeric) <> 190 and date_trunc('month', (week_start - 7)::timestamp) = date_trunc('month', today::timestamp) then
    raise exception 'month totals must match the underlying days';
  end if;

  catalog := public.load_analytics_catalog();
  select value into item from jsonb_array_elements(catalog->'metrics') where value->>'metric_key' = 'youtube.subscribers';
  if (item->>'last_date')::date <> week_start or not (item->'dimensions' ? '@second') then
    raise exception 'catalog must report coverage and accounts: %', item;
  end if;
  select value into item from jsonb_array_elements(catalog->'metrics') where value->>'metric_key' = 'outreach.touches';
  if not (item->'dimensions' ? 'linkedin/manual') and not (item->'dimensions' ? 'linkedin/dripify') and jsonb_array_length(item->'dimensions') = 0 then
    raise exception 'outreach metrics must list channel/method breakdowns';
  end if;
  if jsonb_array_length(catalog->'recent_entries') < 9 then raise exception 'recent manual entries must be listed'; end if;

  if not public.delete_analytics_metric_value('sales.deals_won', week_start, '', 'audit_metrics')
    or public.delete_analytics_metric_value('sales.deals_won', week_start, '', 'audit_metrics') then
    raise exception 'deleting a manual value must succeed once';
  end if;

  ---------------------------------------------------------------------------
  -- Input validation.
  ---------------------------------------------------------------------------
  foreach item in array array[
    jsonb_build_object('metricKey', 'nope.metric', 'date', today, 'value', 1),
    jsonb_build_object('metricKey', 'outreach.reply_rate', 'date', today, 'value', 1),
    jsonb_build_object('metricKey', 'ajani.drafts_saved', 'date', today, 'value', 1),
    jsonb_build_object('metricKey', 'youtube.views', 'date', today, 'value', -1),
    jsonb_build_object('metricKey', 'youtube.views', 'date', today, 'value', 1.5),
    jsonb_build_object('metricKey', 'youtube.views', 'date', today + 5, 'value', 1),
    jsonb_build_object('metricKey', 'youtube.views', 'date', today, 'value', '12'),
    jsonb_build_object('metricKey', 'youtube.views', 'date', today, 'dimension', 'bad account!', 'value', 1)
  ]
  loop
    begin
      perform public.upsert_analytics_metric_values(jsonb_build_array(item), 'manual', 'audit_metrics');
      failed := false;
    exception when others then failed := true;
    end;
    if not failed then raise exception 'invalid metric value must be rejected: %', item; end if;
  end loop;
  if public.upsert_analytics_metric_values('[{"metricKey":"youtube.watch_hours","date":"2026-01-01","value":1.25}]'::jsonb, 'manual', 'audit_metrics') <> 1 then
    raise exception 'fractional hours must be accepted';
  end if;

  foreach item in array array[
    jsonb_build_object('grain', 'decade', 'from', today - 10, 'to', today),
    jsonb_build_object('grain', 'day', 'from', today, 'to', today - 1),
    jsonb_build_object('grain', 'day', 'from', today - 1000, 'to', today),
    jsonb_build_object('grain', 'day', 'from', today, 'to', today + 10)
  ]
  loop
    begin
      perform public.load_analytics_series(array['youtube.views'], item->>'grain', (item->>'from')::date, (item->>'to')::date);
      failed := false;
    exception when others then failed := true;
    end;
    if not failed then raise exception 'invalid series request must be rejected: %', item; end if;
  end loop;
  begin
    perform public.load_analytics_series(array['nope.metric'], 'day', today - 1, today);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'unknown metrics must be rejected'; end if;

  ---------------------------------------------------------------------------
  -- Privileges: internal only, and writes only through validating RPCs.
  ---------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.load_analytics_series(text[],text,date,date,text)', 'execute')
    or has_function_privilege('authenticated', 'public.load_analytics_catalog()', 'execute')
    or has_function_privilege('authenticated', 'public.upsert_analytics_metric_values(jsonb,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.void_outreach_batch(uuid,text,text)', 'execute')
    or has_function_privilege('anon', 'public.discard_unpublished_request_draft(uuid)', 'execute')
    or has_function_privilege('service_role', 'public.analytics_daily_values(text[],date,date,text)', 'execute')
    or has_table_privilege('authenticated', 'public.analytics_metric_daily', 'select')
    or has_table_privilege('service_role', 'public.analytics_metric_daily', 'insert')
    or has_table_privilege('service_role', 'public.analytics_metric_daily', 'update')
    or has_table_privilege('service_role', 'public.analytics_metric_definitions', 'update') then
    raise exception 'metric store must remain internal and RPC-written';
  end if;
  if not has_function_privilege('service_role', 'public.load_analytics_series(text[],text,date,date,text)', 'execute')
    or not has_function_privilege('service_role', 'public.upsert_analytics_metric_values(jsonb,text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.void_outreach_batch(uuid,text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.discard_unpublished_request_draft(uuid)', 'execute')
    or not has_table_privilege('service_role', 'public.analytics_metric_daily', 'select') then
    raise exception 'trusted server code must be able to read and write through RPCs';
  end if;

  raise notice 'metrics regressions passed: reply bases, validation, voids, discards, rollups, stocks, ratios, permissions';
end;
$$;
rollback;
