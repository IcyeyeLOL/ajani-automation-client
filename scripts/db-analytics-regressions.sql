-- Synthetic, transactional fixtures. Root harness runs only in isolated local Postgres.
begin;
do $$
declare
  first_snapshot jsonb; next_snapshot jsonb; baseline_saved bigint; baseline_touches bigint;
  baseline_experiments bigint; baseline_batches bigint; baseline_approved bigint; baseline_processed bigint;
  draft_id uuid; exp_id uuid; batch_id uuid; variant_id uuid; i integer; bucket text;
begin
  first_snapshot := public.load_admin_analytics();
  baseline_saved := (first_snapshot #>> '{metrics,saved_current}')::bigint;
  baseline_touches := (first_snapshot #>> '{outreach,initial_dms}')::bigint;
  baseline_experiments := (first_snapshot->>'experiment_count')::bigint;
  baseline_batches := (first_snapshot->>'batch_count')::bigint;
  baseline_approved := (first_snapshot #>> '{funnel,approved}')::bigint;
  baseline_processed := (first_snapshot #>> '{funnel,processed}')::bigint;

  insert into public.request_drafts(token_hash)
  select md5('analytics-exact-'||n)||md5('analytics-exact-second-'||n) from generate_series(1,11050) n;
  next_snapshot := public.load_admin_analytics();
  if (next_snapshot #>> '{metrics,saved_current}')::bigint <> baseline_saved+11050 then
    raise exception 'analytics exact count must not truncate at PostgREST row cap';
  end if;

  select id into draft_id from public.request_drafts where token_hash=md5('analytics-exact-1')||md5('analytics-exact-second-1');
  insert into public.request_draft_ai_states(request_draft_id,transcript_fingerprint,latest_extraction,approved_revision,approved_hash,approved_plain_language_scope)
  values(draft_id,'analytics-fingerprint','{}',1,'audit-hash','Audit approved scope');
  if public.persist_request_demand_analysis(draft_id,'stale-fingerprint','{"demand":{"method":"ai"}}',0.9) then
    raise exception 'stale extraction must not modify the current revision';
  end if;
  if not public.persist_request_demand_analysis(draft_id,'analytics-fingerprint','{"demand":{"method":"ai","demandCategory":"Audit","confidence":0.9}}',0.9) then
    raise exception 'ordered demand persistence must update the matching revision';
  end if;
  update public.request_draft_ai_states set approved_revision=2,latest_extraction='{"demand":{"method":"ai","demandCategory":"Audit","confidence":0.9}}' where request_draft_id=draft_id;
  update public.request_draft_ai_states set approved_revision=null,approved_hash=null,approved_plain_language_scope=null,latest_extraction='{}' where request_draft_id=draft_id;
  next_snapshot := public.load_admin_analytics();
  if (next_snapshot #>> '{funnel,approved}')::bigint<>baseline_approved+1
    or (next_snapshot #>> '{funnel,processed}')::bigint<>baseline_processed+1 then
    raise exception 'cohort transitions must count once and never move backwards';
  end if;
  delete from public.request_drafts where token_hash=md5('analytics-exact-1')||md5('analytics-exact-second-1');
  next_snapshot := public.load_admin_analytics();
  if (next_snapshot #>> '{metrics,saved_current}')::bigint<>baseline_saved+11050
    or (next_snapshot #>> '{funnel,approved}')::bigint<>baseline_approved+1 then
    raise exception 'retention must not alter cohort conversion denominator or milestones';
  end if;

  for i in 1..31 loop
    insert into public.outreach_experiments(title,audience,created_by) values('Analytics audit '||i,'Synthetic test','audit_analytics') returning id into exp_id;
    insert into public.outreach_variants(experiment_id,label,title) values(exp_id,'A','Audit variant') returning id into variant_id;
    insert into public.outreach_batches(activity_date,team_member,channel,method,audience,experiment_id)
    values(current_date,'Audit','test','manual','Synthetic',exp_id) returning id into batch_id;
    insert into public.outreach_batch_metrics(batch_id,variant_id,variant_label,initial_dms,replies,attributed_replies)
    values(batch_id,variant_id,'A',1000,100,100);
  end loop;
  first_snapshot := public.load_admin_analytics(0,0);
  next_snapshot := public.load_admin_analytics(1,1);
  if jsonb_array_length(first_snapshot->'experiments')<>25 or jsonb_array_length(first_snapshot->'recent_batches')<>20 then
    raise exception 'detail pages must stay bounded';
  end if;
  if (first_snapshot->>'experiment_count')::bigint<>baseline_experiments+31
    or (first_snapshot->>'batch_count')::bigint<>baseline_batches+31
    or (first_snapshot #>> '{outreach,initial_dms}')::bigint<>baseline_touches+31000
    or first_snapshot->'outreach' is distinct from next_snapshot->'outreach' then
    raise exception 'all-page totals must remain exact independently of selected list pages';
  end if;
  if exists(select 1 from jsonb_array_elements(first_snapshot->'experiments') a
    join jsonb_array_elements(next_snapshot->'experiments') b on a->>'id'=b->>'id') then
    raise exception 'deterministic experiment pages must not overlap';
  end if;

  -- Same caller, independent operation buckets. Eight AI uses must not spend save quota.
  bucket := md5('audit-ai')||md5('audit-ai-other');
  for i in 1..12 loop
    if not public.consume_public_request_allowance(bucket,12,600) then raise exception 'AI quota early rejection'; end if;
  end loop;
  if public.consume_public_request_allowance(bucket,12,600) then raise exception 'AI quota must reject abuse'; end if;
  if not public.consume_public_request_allowance(md5('audit-save')||md5('audit-save-other'),8,600) then
    raise exception 'save allowance must be independent';
  end if;
  if has_function_privilege('authenticated','public.load_admin_analytics(integer,integer)','execute')
    or has_function_privilege('anon','public.load_admin_analytics(integer,integer)','execute')
    or has_function_privilege('authenticated','public.persist_request_demand_analysis(uuid,text,jsonb,numeric)','execute')
    or has_table_privilege('authenticated','public.request_cohort_daily','select') then
    raise exception 'analytics must remain internal';
  end if;
  if not has_function_privilege('service_role','public.load_admin_analytics(integer,integer)','execute') then
    raise exception 'trusted analytics worker must be allowed';
  end if;
  if has_table_privilege('service_role','public.request_draft_ai_states','update')
    or not has_table_privilege('service_role','public.request_draft_ai_states','insert')
    or not has_function_privilege('service_role','public.persist_request_demand_analysis(uuid,text,jsonb,numeric)','execute') then
    raise exception 'AI updates must use the ordered RPC; initial inserts remain allowed';
  end if;
  raise notice 'analytics regressions passed: exact totals, pagination, monotonic cohorts, retention, quotas, permissions';
end;
$$;
rollback;
