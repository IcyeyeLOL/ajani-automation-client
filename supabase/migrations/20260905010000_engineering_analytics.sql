-- Exact aggregates are separate from paginated operator lists. Cohort counters
-- contain no client text/identity and survive routine deletion of source drafts.
begin;

lock table public.request_drafts, public.request_draft_ai_states in share row exclusive mode;

create table public.admin_analytics_coverage (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now()
);
insert into public.admin_analytics_coverage default values;

create table public.request_cohort_daily (
  cohort_day date primary key,
  saved bigint not null default 0,
  processed bigint not null default 0,
  approved bigint not null default 0,
  claimed bigint not null default 0,
  submitted bigint not null default 0
);
alter table public.admin_analytics_coverage enable row level security;
alter table public.request_cohort_daily enable row level security;
revoke all on public.admin_analytics_coverage, public.request_cohort_daily from public, anon, authenticated;
grant select on public.admin_analytics_coverage, public.request_cohort_daily to service_role;

alter table public.request_drafts
  add column analytics_cohort_day date,
  add column analytics_processed boolean not null default false,
  add column analytics_approved boolean not null default false,
  add column analytics_claimed boolean not null default false,
  add column analytics_submitted boolean not null default false;

update public.request_drafts d set
  analytics_cohort_day = (d.created_at at time zone 'UTC')::date,
  analytics_processed = exists(select 1 from public.request_draft_ai_states a where a.request_draft_id = d.id and a.latest_extraction #>> '{demand,method}' = 'ai'),
  analytics_approved = exists(select 1 from public.request_draft_ai_states a where a.request_draft_id = d.id and a.approved_revision is not null),
  analytics_claimed = d.claimed_at is not null,
  analytics_submitted = d.submitted_build_request_id is not null;

insert into public.request_cohort_daily(cohort_day, saved, processed, approved, claimed, submitted)
select analytics_cohort_day, count(*), count(*) filter(where analytics_processed), count(*) filter(where analytics_approved),
  count(*) filter(where analytics_claimed), count(*) filter(where analytics_submitted)
from public.request_drafts group by analytics_cohort_day;

create function public.track_request_cohort() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p integer := 0; a integer := 0; c integer := 0; s integer := 0; inserted integer := 0;
begin
  if tg_op = 'INSERT' then
    new.analytics_cohort_day := (new.created_at at time zone 'UTC')::date;
    new.analytics_processed := false;
    new.analytics_approved := false;
    new.analytics_claimed := new.claimed_at is not null;
    new.analytics_submitted := new.submitted_build_request_id is not null;
    inserted := 1;
    c := new.analytics_claimed::integer; s := new.analytics_submitted::integer;
  else
    new.analytics_cohort_day := old.analytics_cohort_day;
    new.analytics_processed := old.analytics_processed or new.analytics_processed;
    new.analytics_approved := old.analytics_approved or new.analytics_approved;
    new.analytics_claimed := old.analytics_claimed or new.claimed_at is not null;
    new.analytics_submitted := old.analytics_submitted or new.submitted_build_request_id is not null;
    p := new.analytics_processed::integer - old.analytics_processed::integer;
    a := new.analytics_approved::integer - old.analytics_approved::integer;
    c := new.analytics_claimed::integer - old.analytics_claimed::integer;
    s := new.analytics_submitted::integer - old.analytics_submitted::integer;
  end if;
  if inserted + p + a + c + s > 0 then
    insert into public.request_cohort_daily as cohort(cohort_day,saved,processed,approved,claimed,submitted)
    values(new.analytics_cohort_day,inserted,p,a,c,s)
    on conflict(cohort_day) do update set saved = cohort.saved + excluded.saved,
      processed = cohort.processed + excluded.processed, approved = cohort.approved + excluded.approved,
      claimed = cohort.claimed + excluded.claimed, submitted = cohort.submitted + excluded.submitted;
  end if;
  return new;
end;
$$;
create trigger track_request_cohort before insert or update on public.request_drafts
for each row execute function public.track_request_cohort();

create function public.track_request_ai_cohort() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.request_drafts set
    analytics_processed = analytics_processed or coalesce(new.latest_extraction #>> '{demand,method}' = 'ai', false),
    analytics_approved = analytics_approved or new.approved_revision is not null
  where id = new.request_draft_id
    and ((not analytics_processed and new.latest_extraction #>> '{demand,method}' = 'ai')
      or (not analytics_approved and new.approved_revision is not null));
  return new;
end;
$$;
create trigger track_request_ai_cohort after insert or update on public.request_draft_ai_states
for each row execute function public.track_request_ai_cohort();
revoke execute on function public.track_request_cohort(), public.track_request_ai_cohort() from public, anon, authenticated;

-- All asynchronous AI-state writes must take the parent lock first, matching
-- submit/deletion. Otherwise the cohort trigger can invert the draft/AI locks.
create function public.persist_request_demand_analysis(p_draft_id uuid,p_transcript_fingerprint text,p_latest_extraction jsonb,p_confidence numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_id uuid;
begin
  perform 1 from public.request_drafts where id=p_draft_id and deletion_reserved_at is null for update;
  if not found then return false; end if;
  update public.request_draft_ai_states set latest_extraction=p_latest_extraction,confidence=p_confidence
    where request_draft_id=p_draft_id and transcript_fingerprint=p_transcript_fingerprint
    returning request_draft_id into updated_id;
  return updated_id is not null;
end;
$$;
revoke all on function public.persist_request_demand_analysis(uuid,text,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.persist_request_demand_analysis(uuid,text,jsonb,numeric) to service_role;
-- Enforce the lock-order contract for future writers, not just today's route.
-- Initial INSERT happens before the capability is published; retain that grant.
-- Rolling upgrade: deploy the matching RPC caller with this migration. An older
-- callback loses optional demand enrichment until updated, never the saved brief.
revoke update on public.request_draft_ai_states from service_role;

create index if not exists outreach_experiments_page_idx on public.outreach_experiments(created_at desc,id desc);
create index if not exists outreach_batches_experiment_idx on public.outreach_batches(experiment_id);
create index if not exists build_requests_created_idx on public.build_requests(created_at);

create function public.load_admin_analytics(p_experiment_page integer default 0, p_batch_page integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
with bounds as (
  select (now() at time zone 'UTC')::date as today,
    (now() at time zone 'UTC')::date - 29 as current_start,
    (now() at time zone 'UTC')::date - 59 as previous_start
), experiment_page as materialized (
  select * from public.outreach_experiments order by created_at desc,id desc
  limit 25 offset greatest(0,p_experiment_page)::bigint * 25
), batch_page as materialized (
  select * from public.outreach_batches order by activity_date desc,created_at desc,id desc
  limit 20 offset greatest(0,p_batch_page)::bigint * 20
), activity as materialized (
  select b.id as batch_id,b.experiment_id,b.activity_date,m.variant_id,m.variant_label,
    m.connection_requests,m.connections_accepted,m.initial_dms,m.f1_sent,m.f2_sent,m.custom_sent,
    m.replies,m.attributed_replies,m.positive_replies,m.calls_booked,
    (m.connection_requests::bigint+m.initial_dms+m.f1_sent+m.f2_sent+m.custom_sent) as touches
  from public.outreach_batches b join public.outreach_batch_metrics m on m.batch_id=b.id
), outreach as (
  select coalesce(sum(connection_requests),0) as connection_requests,coalesce(sum(connections_accepted),0) as connections_accepted,
    coalesce(sum(initial_dms),0) as initial_dms,coalesce(sum(f1_sent),0) as f1_sent,coalesce(sum(f2_sent),0) as f2_sent,
    coalesce(sum(custom_sent),0) as custom_sent,coalesce(sum(replies),0) as replies,
    coalesce(sum(positive_replies),0) as positive_replies,coalesce(sum(calls_booked),0) as calls_booked
  from activity
), period_activity as (
  select coalesce(sum(touches) filter(where activity_date>=current_start and activity_date<=today),0) as outreach_current,
    coalesce(sum(touches) filter(where activity_date>=previous_start and activity_date<current_start),0) as outreach_previous,
    coalesce(sum(replies) filter(where activity_date>=current_start and activity_date<=today),0) as replies_current,
    coalesce(sum(replies) filter(where activity_date>=previous_start and activity_date<current_start),0) as replies_previous,
    coalesce(sum(initial_dms) filter(where activity_date>=current_start and activity_date<=today),0) as initial_dms_current
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
  'batch_count',(select count(*) from public.outreach_batches)
);
$$;
revoke execute on function public.load_admin_analytics(integer,integer) from public,anon,authenticated;
grant execute on function public.load_admin_analytics(integer,integer) to service_role;

commit;
