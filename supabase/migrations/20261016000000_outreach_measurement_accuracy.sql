-- Measurement accuracy for outreach and website-funnel analytics.
--
-- 1. Every outreach metric row records `reply_base`: the exact exposure its
--    replies are measured against. Batch rows use unique initial DMs; experiment
--    snapshots use sends at the tested message step. Aggregate reply rates are
--    replies / reply_base and can no longer exceed 100%.
-- 2. Mistaken entries are voided (kept for audit, excluded everywhere) instead
--    of being re-entered on top of each other.
-- 3. Database-level consistency checks for the batch logger are restored. The
--    20260823 rewrite dropped the checks added by 20260814020000.
-- 4. A save that fails before its capability is published is discarded with
--    its cohort contribution, so failed saves no longer inflate saved drafts.
begin;

lock table public.outreach_batches, public.outreach_batch_metrics in share row exclusive mode;

alter table public.outreach_batch_metrics
  add column reply_base integer not null default 0 check (reply_base >= 0);

update public.outreach_batch_metrics m set reply_base = case
  when snapshot.entity_id is null then m.initial_dms
  when e.message_step = 'connection_request' then m.connection_requests
  when e.message_step = 'follow_up_1' then m.f1_sent
  when e.message_step = 'follow_up_2' then m.f2_sent
  when e.message_step = 'custom' then m.custom_sent
  when e.message_step = 'initial_dm' then m.initial_dms
  else greatest(m.initial_dms, m.f1_sent, m.f2_sent, m.custom_sent, m.connection_requests)
end
from public.outreach_batches b
left join public.outreach_experiments e on e.id = b.experiment_id
left join (
  select distinct entity_id from public.admin_activity_log where entity_type = 'experiment_metric_snapshot'
) snapshot on snapshot.entity_id = b.id::text
where b.id = m.batch_id;

-- Writers that predate reply_base keep their original meaning (initial DMs).
alter table public.outreach_batch_metrics alter column reply_base drop default;
create function public.default_outreach_reply_base() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.reply_base := coalesce(new.reply_base, new.initial_dms);
  return new;
end;
$$;
create trigger outreach_batch_metrics_reply_base before insert on public.outreach_batch_metrics
for each row execute function public.default_outreach_reply_base();
revoke all on function public.default_outreach_reply_base() from public, anon, authenticated;

-- Enforced for every new row. Historical rows are validated only when clean so
-- the migration can never fail on legacy data; the rate stays exact either way.
alter table public.outreach_batch_metrics
  add constraint outreach_batch_metrics_reply_base_bound check (replies <= reply_base) not valid;
do $$
begin
  if not exists (select 1 from public.outreach_batch_metrics where replies > reply_base) then
    alter table public.outreach_batch_metrics validate constraint outreach_batch_metrics_reply_base_bound;
  end if;
end;
$$;

alter table public.outreach_batches
  add column voided_at timestamptz,
  add column voided_by text check (voided_by is null or char_length(voided_by) between 1 and 200),
  add column void_reason text check (void_reason is null or char_length(void_reason) between 3 and 300),
  add constraint outreach_batches_void_consistency check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  );

create index outreach_batches_live_page_idx
  on public.outreach_batches (activity_date desc, created_at desc, id desc) where voided_at is null;

create function public.void_outreach_batch(p_batch_id uuid, p_reason text, p_actor text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  voided_id uuid;
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'A void reason between 3 and 300 characters is required';
  end if;
  if char_length(btrim(coalesce(p_actor, ''))) not between 1 and 200 then
    raise exception 'An actor is required';
  end if;

  update public.outreach_batches
  set voided_at = now(), voided_by = btrim(p_actor), void_reason = btrim(p_reason)
  where id = p_batch_id and voided_at is null
  returning id into voided_id;
  if voided_id is null then return false; end if;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (btrim(p_actor), 'voided', 'outreach_batch', voided_id::text, jsonb_build_object('reason', btrim(p_reason)));
  return true;
end;
$$;

create or replace function public.create_outreach_batch(
  p_activity_date date,
  p_team_member text,
  p_channel text,
  p_method text,
  p_audience text,
  p_campaign text,
  p_experiment_id uuid,
  p_notes text,
  p_metrics jsonb,
  p_actor text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  batch_id uuid;
  metric jsonb;
  metric_variant_id uuid;
  metric_label text;
  connection_requests integer;
  connections_accepted integer;
  initial_dms integer;
  f1_sent integer;
  f2_sent integer;
  custom_sent integer;
  replies integer;
  attributed_replies integer;
  positive_replies integer;
  calls_booked integer;
  activity_total bigint := 0;
begin
  if jsonb_typeof(p_metrics) is distinct from 'array'
    or jsonb_array_length(p_metrics) not between 1 and 12 then
    raise exception 'A batch requires between one and twelve metric rows';
  end if;

  if p_experiment_id is not null and not exists (
    select 1 from public.outreach_experiments where id = p_experiment_id and status = 'active'
  ) then
    raise exception 'The selected experiment is not active';
  end if;

  insert into public.outreach_batches (activity_date, team_member, channel, method, audience, campaign, experiment_id, notes)
  values (
    p_activity_date, btrim(p_team_member), lower(btrim(p_channel)), lower(btrim(p_method)), btrim(p_audience),
    nullif(btrim(p_campaign), ''), p_experiment_id, nullif(btrim(p_notes), '')
  )
  returning id into batch_id;

  for metric in select value from jsonb_array_elements(p_metrics)
  loop
    metric_variant_id := nullif(metric ->> 'variantId', '')::uuid;
    connection_requests := coalesce((metric ->> 'connectionRequests')::integer, 0);
    connections_accepted := coalesce((metric ->> 'connectionsAccepted')::integer, 0);
    initial_dms := coalesce((metric ->> 'initialDms')::integer, 0);
    f1_sent := coalesce((metric ->> 'f1Sent')::integer, 0);
    f2_sent := coalesce((metric ->> 'f2Sent')::integer, 0);
    custom_sent := coalesce((metric ->> 'customSent')::integer, 0);
    replies := coalesce((metric ->> 'replies')::integer, 0);
    attributed_replies := coalesce((metric ->> 'attributedReplies')::integer, 0);
    positive_replies := coalesce((metric ->> 'positiveReplies')::integer, 0);
    calls_booked := coalesce((metric ->> 'callsBooked')::integer, 0);

    if metric_variant_id is null then
      metric_label := coalesce(nullif(btrim(metric ->> 'variantLabel'), ''), 'No variant');
    else
      -- The stored label always comes from the variant itself, never the browser.
      select label into metric_label
      from public.outreach_variants
      where id = metric_variant_id and experiment_id = p_experiment_id and active;
      if not found then
        raise exception 'A metric variant does not belong to the selected experiment';
      end if;
    end if;

    if least(connection_requests, connections_accepted, initial_dms, f1_sent, f2_sent, custom_sent,
        replies, attributed_replies, positive_replies, calls_booked) < 0
      or greatest(connection_requests, connections_accepted, initial_dms, f1_sent, f2_sent, custom_sent,
        replies, attributed_replies, positive_replies, calls_booked) > 1000000 then
      raise exception 'Outreach metric counts must be between 0 and 1,000,000';
    end if;

    if connections_accepted > connection_requests
      or replies > initial_dms
      or attributed_replies > replies
      or f2_sent > f1_sent
      or positive_replies > replies
      or calls_booked > replies then
      raise exception 'Outreach metric counts are internally inconsistent';
    end if;

    activity_total := activity_total + connection_requests + connections_accepted + initial_dms + f1_sent
      + f2_sent + custom_sent + replies + attributed_replies + positive_replies + calls_booked;

    insert into public.outreach_batch_metrics (
      batch_id, variant_id, variant_label, connection_requests, connections_accepted,
      initial_dms, f1_sent, f2_sent, custom_sent, replies, attributed_replies,
      positive_replies, calls_booked, reply_base
    ) values (
      batch_id, metric_variant_id, metric_label, connection_requests, connections_accepted,
      initial_dms, f1_sent, f2_sent, custom_sent, replies, attributed_replies,
      positive_replies, calls_booked, initial_dms
    );
  end loop;

  if activity_total = 0 then
    raise exception 'Enter at least one activity or outcome count';
  end if;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (
    p_actor,
    'created',
    'outreach_batch',
    batch_id::text,
    jsonb_build_object('activity_date', p_activity_date, 'experiment_id', p_experiment_id, 'team_member', btrim(p_team_member))
  );
  return batch_id;
end;
$$;

create or replace function public.create_experiment_metric_snapshot(
  p_experiment_id uuid,
  p_activity_date date,
  p_team_member text,
  p_notes text,
  p_metrics jsonb,
  p_actor text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  experiment_record public.outreach_experiments%rowtype;
  variant_record public.outreach_variants%rowtype;
  batch_id uuid;
  metric jsonb;
  metric_variant_id uuid;
  sent integer;
  replies integer;
  positive_replies integer;
  calls_booked integer;
  connection_requests integer;
  connections_accepted integer;
  activity_total bigint := 0;
begin
  if jsonb_typeof(p_metrics) is distinct from 'array'
    or jsonb_array_length(p_metrics) not between 1 and 12 then
    raise exception 'An experiment entry requires between one and twelve metric rows';
  end if;

  select * into experiment_record
  from public.outreach_experiments
  where id = p_experiment_id and status = 'active';

  if not found then
    raise exception 'The selected experiment is not active';
  end if;

  if char_length(btrim(p_team_member)) not between 2 and 100 then
    raise exception 'The team member must contain between two and one hundred characters';
  end if;

  insert into public.outreach_batches (
    activity_date, team_member, channel, method, audience, campaign, experiment_id, notes
  ) values (
    p_activity_date,
    btrim(p_team_member),
    experiment_record.channel,
    experiment_record.method,
    experiment_record.audience,
    experiment_record.campaign,
    experiment_record.id,
    nullif(btrim(p_notes), '')
  ) returning id into batch_id;

  for metric in select value from jsonb_array_elements(p_metrics)
  loop
    metric_variant_id := nullif(metric ->> 'variantId', '')::uuid;
    sent := coalesce((metric ->> 'sent')::integer, 0);
    replies := coalesce((metric ->> 'replies')::integer, 0);
    positive_replies := coalesce((metric ->> 'positiveReplies')::integer, 0);
    calls_booked := coalesce((metric ->> 'callsBooked')::integer, 0);
    connection_requests := case
      when experiment_record.message_step = 'connection_request' then sent
      else coalesce((metric ->> 'connectionRequests')::integer, 0)
    end;
    connections_accepted := coalesce((metric ->> 'connectionsAccepted')::integer, 0);

    select * into variant_record
    from public.outreach_variants
    where id = metric_variant_id
      and experiment_id = experiment_record.id
      and active;

    if not found then
      raise exception 'A metric variant does not belong to the selected experiment';
    end if;

    if sent < 0 or sent > 1000000
      or replies < 0 or replies > 1000000
      or positive_replies < 0 or positive_replies > 1000000
      or calls_booked < 0 or calls_booked > 1000000
      or connection_requests < 0 or connection_requests > 1000000
      or connections_accepted < 0 or connections_accepted > 1000000
      or replies > sent
      or positive_replies > replies
      or calls_booked > replies
      or connections_accepted > connection_requests then
      raise exception 'Experiment metric counts are internally inconsistent';
    end if;

    activity_total := activity_total + sent + replies + positive_replies + calls_booked
      + connection_requests + connections_accepted;

    -- reply_base = sends at the tested step: replies are measured against the
    -- exposure that produced them, not against initial DMs that were not logged.
    insert into public.outreach_batch_metrics (
      batch_id,
      variant_id,
      variant_label,
      connection_requests,
      connections_accepted,
      initial_dms,
      f1_sent,
      f2_sent,
      custom_sent,
      replies,
      attributed_replies,
      positive_replies,
      calls_booked,
      reply_base
    ) values (
      batch_id,
      variant_record.id,
      variant_record.label,
      connection_requests,
      connections_accepted,
      case when experiment_record.message_step = 'initial_dm' then sent else 0 end,
      case when experiment_record.message_step = 'follow_up_1' then sent else 0 end,
      case when experiment_record.message_step = 'follow_up_2' then sent else 0 end,
      case when experiment_record.message_step = 'custom' then sent else 0 end,
      replies,
      replies,
      positive_replies,
      calls_booked,
      sent
    );
  end loop;

  if activity_total = 0 then
    raise exception 'Enter at least one experiment activity or outcome count';
  end if;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (
    p_actor,
    'created',
    'experiment_metric_snapshot',
    batch_id::text,
    jsonb_build_object(
      'activity_date', p_activity_date,
      'experiment_id', experiment_record.id,
      'message_step', experiment_record.message_step,
      'team_member', btrim(p_team_member)
    )
  );

  return batch_id;
end;
$$;

-- Same lock order as the cohort trigger and the submit/delete RPCs: the draft
-- row first, then its cascaded children, then the cohort counter row.
create function public.discard_unpublished_request_draft(p_draft_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  draft public.request_drafts%rowtype;
begin
  select * into draft from public.request_drafts where id = p_draft_id for update;
  if not found then return false; end if;
  if draft.claimed_at is not null
    or draft.submitted_build_request_id is not null
    or draft.deletion_reserved_at is not null
    or draft.created_at < now() - interval '15 minutes' then
    raise exception 'Only a just-created, unpublished draft can be discarded';
  end if;

  delete from public.request_drafts where id = p_draft_id;
  update public.request_cohort_daily set
    saved = greatest(saved - 1, 0),
    processed = greatest(processed - draft.analytics_processed::integer, 0),
    approved = greatest(approved - draft.analytics_approved::integer, 0),
    claimed = greatest(claimed - draft.analytics_claimed::integer, 0),
    submitted = greatest(submitted - draft.analytics_submitted::integer, 0)
  where cohort_day = draft.analytics_cohort_day;
  return true;
end;
$$;

create or replace function public.load_admin_analytics(p_experiment_page integer default 0, p_batch_page integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
with bounds as (
  select (now() at time zone 'UTC')::date as today,
    (now() at time zone 'UTC')::date - 29 as current_start,
    (now() at time zone 'UTC')::date - 59 as previous_start
), experiment_page as materialized (
  select * from public.outreach_experiments order by created_at desc,id desc
  limit 25 offset greatest(0,p_experiment_page)::bigint * 25
), batch_page as materialized (
  select * from public.outreach_batches where voided_at is null order by activity_date desc,created_at desc,id desc
  limit 20 offset greatest(0,p_batch_page)::bigint * 20
), activity as materialized (
  select b.id as batch_id,b.experiment_id,b.activity_date,m.variant_id,m.variant_label,
    m.connection_requests,m.connections_accepted,m.initial_dms,m.f1_sent,m.f2_sent,m.custom_sent,
    m.replies,m.attributed_replies,m.positive_replies,m.calls_booked,m.reply_base,
    (m.connection_requests::bigint+m.initial_dms+m.f1_sent+m.f2_sent+m.custom_sent) as touches
  from public.outreach_batches b join public.outreach_batch_metrics m on m.batch_id=b.id
  where b.voided_at is null
), outreach as (
  select coalesce(sum(connection_requests),0) as connection_requests,coalesce(sum(connections_accepted),0) as connections_accepted,
    coalesce(sum(initial_dms),0) as initial_dms,coalesce(sum(f1_sent),0) as f1_sent,coalesce(sum(f2_sent),0) as f2_sent,
    coalesce(sum(custom_sent),0) as custom_sent,coalesce(sum(replies),0) as replies,coalesce(sum(reply_base),0) as reply_base,
    coalesce(sum(positive_replies),0) as positive_replies,coalesce(sum(calls_booked),0) as calls_booked
  from activity
), period_activity as (
  select coalesce(sum(touches) filter(where activity_date>=current_start and activity_date<=today),0) as outreach_current,
    coalesce(sum(touches) filter(where activity_date>=previous_start and activity_date<current_start),0) as outreach_previous,
    coalesce(sum(replies) filter(where activity_date>=current_start and activity_date<=today),0) as replies_current,
    coalesce(sum(replies) filter(where activity_date>=previous_start and activity_date<current_start),0) as replies_previous,
    coalesce(sum(initial_dms) filter(where activity_date>=current_start and activity_date<=today),0) as initial_dms_current,
    coalesce(sum(reply_base) filter(where activity_date>=current_start and activity_date<=today),0) as reply_base_current
  from activity cross join bounds
), cohort_metrics as (
  select coalesce(sum(saved) filter(where cohort_day>=current_start and cohort_day<=today),0) as saved_current,
    coalesce(sum(saved) filter(where cohort_day>=previous_start and cohort_day<current_start),0) as saved_previous,
    coalesce(sum(submitted) filter(where cohort_day>=current_start and cohort_day<=today),0) as cohort_submitted_current
  from public.request_cohort_daily cross join bounds
), build_metrics as (
  select count(*) filter(where created_at>=current_start::timestamp at time zone 'UTC') as builds_current,
    count(*) filter(where created_at>=previous_start::timestamp at time zone 'UTC' and created_at<current_start::timestamp at time zone 'UTC') as builds_previous
  from public.build_requests cross join bounds
), funnel as (
  select coalesce(sum(saved),0) as saved,coalesce(sum(processed),0) as processed,coalesce(sum(approved),0) as approved,
    coalesce(sum(claimed),0) as claimed,coalesce(sum(submitted),0) as submitted
  from public.request_cohort_daily cross join bounds where cohort_day>=today-179 and cohort_day<=today
), daily_activity as (
  select activity_date as day,sum(touches) as outreach,sum(replies) as replies from activity cross join bounds
  where activity_date>=today-89 and activity_date<=today group by activity_date
), daily_builds as (
  select (created_at at time zone 'UTC')::date as day,count(*) as submissions from public.build_requests cross join bounds
  where created_at >= (today-89)::timestamp at time zone 'UTC' group by 1
), trend as (
  select calendar.day::date as date,coalesce(c.saved,0) as drafts,coalesce(b.submissions,0) as submissions,
    coalesce(a.outreach,0) as outreach,coalesce(a.replies,0) as replies
  from bounds cross join lateral generate_series(today-89,today,interval '1 day') as calendar(day)
  left join public.request_cohort_daily c on c.cohort_day=calendar.day::date
  left join daily_activity a on a.day=calendar.day::date left join daily_builds b on b.day=calendar.day::date
), experiment_metrics as (
  select a.experiment_id as batch_id,a.variant_id,a.variant_label,
    sum(a.connection_requests) as connection_requests,sum(a.connections_accepted) as connections_accepted,
    sum(a.initial_dms) as initial_dms,sum(a.f1_sent) as f1_sent,sum(a.f2_sent) as f2_sent,sum(a.custom_sent) as custom_sent,
    sum(a.replies) as replies,sum(a.attributed_replies) as attributed_replies,
    sum(a.positive_replies) as positive_replies,sum(a.calls_booked) as calls_booked
  from activity a join experiment_page e on e.id=a.experiment_id group by a.experiment_id,a.variant_id,a.variant_label
), recent_metrics as (
  select a.batch_id,sum(a.touches) as sent,sum(a.replies) as replies,sum(a.calls_booked) as calls
  from activity a join batch_page b on b.id=a.batch_id group by a.batch_id
), job_states as (
  select 'AI workflow' as label,status from public.request_draft_ai_runs where created_at>=now()-interval '180 days'
  union all select 'Transcription',status from public.voice_memo_transcription_jobs where created_at>=now()-interval '180 days'
  union all select 'Internal notification',status from public.build_request_notification_jobs where created_at>=now()-interval '180 days'
), operations as (
  select labels.label,count(*) filter(where status in('succeeded','sent')) as healthy,
    count(*) filter(where status in('retryable_failed','terminal_failed','failed')) as attention,
    count(status)::text || ' recorded jobs' as detail
  from (values('AI workflow'),('Transcription'),('Internal notification')) labels(label)
  left join job_states j on j.label=labels.label group by labels.label
  union all select 'Live systems',count(*) filter(where health::text='healthy'),
    count(*) filter(where health::text in('warning','error','paused')),count(*)::text || ' provisioned systems'
  from public.automation_systems
), demand as (
  select trim(latest_extraction #>> '{demand,demandCategory}') as label,count(*) as value
  from public.request_draft_ai_states where created_at>=now()-interval '180 days'
    and latest_extraction #>> '{demand,method}'='ai'
    and coalesce(latest_extraction #>> '{demand,demandCategory}','')<>''
    and case when jsonb_typeof(latest_extraction #> '{demand,confidence}')='number'
      then (latest_extraction #>> '{demand,confidence}')::numeric>=0.5 else true end
  group by 1 order by value desc,label limit 6
)
select jsonb_build_object(
  'coverage_started_at',(select started_at from public.admin_analytics_coverage),
  'metrics',(select to_jsonb(c)||to_jsonb(b)||to_jsonb(a)||jsonb_build_object(
    'organizations_current',(select count(*) from public.organizations,bounds where created_at>=current_start::timestamp at time zone 'UTC'),
    'quoted_pipeline',(select coalesce(sum(amount_cents),0) from public.build_request_quotes where review_status<>'rejected'),
    'mrr',(select coalesce(sum(amount_cents),0) from public.billing_subscriptions where status::text='active' and interval='month'))
    from cohort_metrics c cross join build_metrics b cross join period_activity a),
  'funnel',(select to_jsonb(f) from funnel f),
  'trend',coalesce((select jsonb_agg(to_jsonb(t) order by date) from trend t),'[]'::jsonb),
  'outreach',(select to_jsonb(o) from outreach o),
  'experiments',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,id desc) from experiment_page e),'[]'::jsonb),
  'variants',coalesce((select jsonb_agg(to_jsonb(v)) from public.outreach_variants v join experiment_page e on e.id=v.experiment_id),'[]'::jsonb),
  'experiment_metrics',coalesce((select jsonb_agg(to_jsonb(m)) from experiment_metrics m),'[]'::jsonb),
  'recent_batches',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('sent',coalesce(m.sent,0),'replies',coalesce(m.replies,0),'calls',coalesce(m.calls,0)) order by b.activity_date desc,b.created_at desc,b.id desc)
    from batch_page b left join recent_metrics m on b.id=m.batch_id),'[]'::jsonb),
  'operations',coalesce((select jsonb_agg(to_jsonb(o)) from operations o),'[]'::jsonb),
  'content_demand',coalesce((select jsonb_agg(to_jsonb(d)) from demand d),'[]'::jsonb),
  'experiment_count',(select count(*) from public.outreach_experiments),
  'batch_count',(select count(*) from public.outreach_batches where voided_at is null)
);
$$;

revoke all on function public.void_outreach_batch(uuid, text, text) from public, anon, authenticated;
revoke all on function public.discard_unpublished_request_draft(uuid) from public, anon, authenticated;
revoke all on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_experiment_metric_snapshot(uuid, date, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.load_admin_analytics(integer, integer) from public, anon, authenticated;
grant execute on function public.void_outreach_batch(uuid, text, text) to service_role;
grant execute on function public.discard_unpublished_request_draft(uuid) to service_role;
grant execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb, text) to service_role;
grant execute on function public.create_experiment_metric_snapshot(uuid, date, text, text, jsonb, text) to service_role;
grant execute on function public.load_admin_analytics(integer, integer) to service_role;

commit;
