-- Outreach adds up every channel (2026-10-18).
--
-- The owner asked for Outreach to be the total of all outreach: logged
-- batches, Dripify, Reddit DMs and cold calls, so touches, replies, reply rate
-- and calls booked show one combined number, with each channel still
-- available under the Channel filter:
--
--   logged batches   channel/method as logged ("linkedin/manual")
--   Dripify sync     linkedin/dripify: leads contacted (touches and reply
--                    base) and replies, summed over campaigns
--   Reddit DMs       reddit/dm: DMs sent (first messages), replies, calls booked
--   cold calls       phone/cold_call: calls made (touches and reply base),
--                    everyone who answered with a positive, neutral or
--                    negative reply, positive replies, meetings booked
--
-- Nothing is counted twice. From the first day the Dripify sync records new
-- activity, it counts Dripify's sends and replies, and logged Dripify batches
-- add only what it can't see (positive replies and calls booked). Reddit DMs
-- and cold calls are logged in Log numbers only.
--
-- The overview's outreach cards and trend show the same totals. The Outreach
-- page's batch funnel, recent batches and A/B tests still read the batches.
begin;

-------------------------------------------------------------------------------
-- 1. Daily values: the outreach block reads every channel.
-------------------------------------------------------------------------------
create or replace function public.analytics_daily_values(p_keys text[], p_from date, p_to date, p_dimension text)
returns table (metric_key text, metric_date date, dimension_key text, value numeric)
language sql stable security definer set search_path = '' as $$
  select f.metric_key, f.metric_date, f.dimension_key, f.value::numeric
  from public.analytics_metric_daily f
  where f.metric_key = any(p_keys) and f.metric_date between p_from and p_to
    and (p_dimension is null or f.dimension_key = p_dimension)
  union all
  select x.metric_key, c.cohort_day, '', x.value
  from public.request_cohort_daily c
  cross join lateral (values ('ajani.drafts_saved', c.saved::numeric), ('ajani.cohort_submitted', c.submitted::numeric)) x(metric_key, value)
  where p_dimension is null and p_keys && array['ajani.drafts_saved', 'ajani.cohort_submitted']
    and c.cohort_day between p_from and p_to and x.metric_key = any(p_keys)
    -- Earlier cohort rows were backfilled only from drafts that survived
    -- retention, so they undercount saves; they are unknown, not data.
    and c.cohort_day >= coalesce((select (cv.started_at at time zone 'UTC')::date from public.admin_analytics_coverage cv), date '2000-01-01')
  union all
  select 'ajani.builds_submitted', (b.created_at at time zone 'UTC')::date, '', count(*)::numeric
  from public.build_requests b
  where p_dimension is null and 'ajani.builds_submitted' = any(p_keys)
    and b.created_at >= p_from::timestamp at time zone 'UTC' and b.created_at < (p_to + 1)::timestamp at time zone 'UTC'
  group by 2
  union all
  select 'ajani.new_workspaces', (o.created_at at time zone 'UTC')::date, '', count(*)::numeric
  from public.organizations o
  where p_dimension is null and 'ajani.new_workspaces' = any(p_keys)
    and o.created_at >= p_from::timestamp at time zone 'UTC' and o.created_at < (p_to + 1)::timestamp at time zone 'UTC'
  group by 2
  union all
  select x.metric_key, o.activity_date, o.dimension_key, x.value
  from (
    select s.activity_date, s.dimension_key,
      sum(s.connection_requests) as connection_requests,
      sum(s.connections_accepted) as connections_accepted,
      sum(s.initial_dms) as initial_dms,
      sum(s.follow_ups) as follow_ups,
      -- Touches that are not LinkedIn steps: Dripify leads contacted, cold calls made.
      sum(s.other_touches) as other_touches,
      sum(s.replies) as replies,
      sum(s.reply_base) as reply_base,
      sum(s.positive_replies) as positive_replies,
      sum(s.calls_booked) as calls_booked
    from (
      -- Logged batches. A Dripify batch on or after the sync's first day of new
      -- activity keeps only its positive replies and calls booked.
      select b.activity_date,
        public.analytics_dimension_slug(b.channel, 39) || '/' || public.analytics_dimension_slug(b.method, 40) as dimension_key,
        case when dripify.skip then 0 else m.connection_requests end::numeric as connection_requests,
        case when dripify.skip then 0 else m.connections_accepted end::numeric as connections_accepted,
        case when dripify.skip then 0 else m.initial_dms end::numeric as initial_dms,
        case when dripify.skip then 0 else m.f1_sent::bigint + m.f2_sent + m.custom_sent end::numeric as follow_ups,
        0::numeric as other_touches,
        case when dripify.skip then 0 else m.replies end::numeric as replies,
        case when dripify.skip then 0 else m.reply_base end::numeric as reply_base,
        m.positive_replies::numeric as positive_replies,
        m.calls_booked::numeric as calls_booked
      from public.outreach_batches b
      join public.outreach_batch_metrics m on m.batch_id = b.id
      cross join lateral (select public.analytics_dimension_slug(b.method, 40) = 'dripify'
        and b.activity_date >= (select min(d.metric_date) from public.analytics_metric_daily d where d.metric_key = 'dripify.new_contacted') as skip) dripify
      where b.voided_at is null and b.activity_date between p_from and p_to
      union all
      -- Dripify sync: new leads contacted and new replies, every campaign.
      select f.metric_date, 'linkedin/dripify', 0, 0, 0, 0,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_contacted'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_replies'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_contacted'), 0),
        0, 0
      from public.analytics_metric_daily f
      where f.metric_key in ('dripify.new_contacted', 'dripify.new_replies') and f.metric_date between p_from and p_to
      group by f.metric_date
      union all
      -- Reddit DMs: each DM is a first message.
      select f.metric_date, 'reddit/dm', 0, 0,
        coalesce(sum(f.value) filter (where f.metric_key = 'reddit.dms_sent'), 0),
        0, 0,
        coalesce(sum(f.value) filter (where f.metric_key = 'reddit.dm_replies'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'reddit.dms_sent'), 0),
        0,
        coalesce(sum(f.value) filter (where f.metric_key = 'reddit.dm_calls_booked'), 0)
      from public.analytics_metric_daily f
      where f.metric_key in ('reddit.dms_sent', 'reddit.dm_replies', 'reddit.dm_calls_booked') and f.metric_date between p_from and p_to
      group by f.metric_date
      union all
      -- Cold calls: a reply is anyone who answered and gave one.
      select f.metric_date, 'phone/cold_call', 0, 0, 0, 0,
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.dials'), 0),
        coalesce(sum(f.value) filter (where f.metric_key in ('cold_calls.positive_replies', 'cold_calls.neutral_replies', 'cold_calls.negative_replies')), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.dials'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.positive_replies'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.meetings_booked'), 0)
      from public.analytics_metric_daily f
      where f.metric_key in ('cold_calls.dials', 'cold_calls.positive_replies', 'cold_calls.neutral_replies', 'cold_calls.negative_replies', 'cold_calls.meetings_booked')
        and f.metric_date between p_from and p_to
      group by f.metric_date
    ) s
    where p_keys && array['outreach.touches', 'outreach.connection_requests', 'outreach.connections_accepted',
        'outreach.initial_dms', 'outreach.follow_ups', 'outreach.replies', 'outreach.reply_base',
        'outreach.positive_replies', 'outreach.calls_booked']
      and (p_dimension is null or s.dimension_key = p_dimension)
    group by 1, 2
  ) o
  cross join lateral (values
    ('outreach.touches', o.connection_requests + o.initial_dms + o.follow_ups + o.other_touches),
    ('outreach.connection_requests', o.connection_requests),
    ('outreach.connections_accepted', o.connections_accepted),
    ('outreach.initial_dms', o.initial_dms),
    ('outreach.follow_ups', o.follow_ups),
    ('outreach.replies', o.replies),
    ('outreach.reply_base', o.reply_base),
    ('outreach.positive_replies', o.positive_replies),
    ('outreach.calls_booked', o.calls_booked)
  ) x(metric_key, value)
  where x.metric_key = any(p_keys)
$$;

-------------------------------------------------------------------------------
-- 2. Catalog: the Channel filter lists every channel with numbers.
-------------------------------------------------------------------------------
create or replace function public.load_analytics_catalog()
returns jsonb language sql stable security definer set search_path = '' as $$
with per_dimension as materialized (
  select f.metric_key, f.dimension_key, min(f.metric_date) as first_date, max(f.metric_date) as last_date
  from public.analytics_metric_daily f
  group by f.metric_key, f.dimension_key
), stored as (
  select p.metric_key, min(p.first_date) as first_date, max(p.last_date) as last_date
  from per_dimension p group by p.metric_key
), stored_dimensions as (
  select ranked.metric_key, jsonb_agg(ranked.dimension_key order by ranked.dimension_key) as dimensions
  from (
    select p.metric_key, p.dimension_key,
      row_number() over (partition by p.metric_key order by p.last_date desc, p.dimension_key) as position
    from per_dimension p where p.dimension_key <> ''
  ) ranked
  where ranked.position <= 50
  group by ranked.metric_key
), outreach_dimensions as (
  select coalesce(jsonb_agg(d.dimension_key order by d.dimension_key), '[]'::jsonb) as dimensions
  from (
    select c.dimension_key from (
      select distinct public.analytics_dimension_slug(b.channel, 39) || '/' || public.analytics_dimension_slug(b.method, 40) as dimension_key
      from public.outreach_batches b where b.voided_at is null
      union
      select channel.dimension_key
      from (values
        ('linkedin/dripify', array['dripify.new_contacted', 'dripify.new_replies']),
        ('reddit/dm', array['reddit.dms_sent', 'reddit.dm_replies', 'reddit.dm_calls_booked']),
        ('phone/cold_call', array['cold_calls.dials', 'cold_calls.positive_replies', 'cold_calls.neutral_replies', 'cold_calls.negative_replies', 'cold_calls.meetings_booked'])
      ) channel(dimension_key, metric_keys)
      where exists (select 1 from per_dimension p where p.metric_key = any(channel.metric_keys))
    ) c
    order by 1 limit 50
  ) d
), definitions as (
  select d.*, coalesce(case when d.aggregation = 'ratio' then d.numerator_key else d.metric_key end, d.metric_key) as data_key
  from public.analytics_metric_definitions d where d.active
)
select jsonb_build_object(
  'today', (now() at time zone 'UTC')::date,
  'coverage_started_at', (select c.started_at from public.admin_analytics_coverage c),
  'metrics', coalesce((
    select jsonb_agg(jsonb_build_object(
      'metric_key', d.metric_key,
      'source', d.source,
      'category', d.category,
      'label', d.label,
      'description', d.description,
      'unit', d.unit,
      'aggregation', d.aggregation,
      'numerator_key', d.numerator_key,
      'denominator_key', d.denominator_key,
      'entry_mode', d.entry_mode,
      'higher_is_better', d.higher_is_better,
      'chartable', d.chartable,
      'first_date', s.first_date,
      'last_date', s.last_date,
      'dimensions', case when d.source = 'outreach' then (select o.dimensions from outreach_dimensions o)
        else coalesce(sd.dimensions, '[]'::jsonb) end
    ) order by d.sort_order, d.metric_key)
    from definitions d
    left join stored s on s.metric_key = d.data_key
    left join stored_dimensions sd on sd.metric_key = d.data_key
  ), '[]'::jsonb),
  'dimension_labels', coalesce((
    select jsonb_object_agg(l.dimension_key, l.label)
    from public.analytics_dimension_labels l
    where l.dimension_key in (select p.dimension_key from per_dimension p)
  ), '{}'::jsonb),
  'recent_entries', coalesce((
    select jsonb_agg(jsonb_build_object(
      'metric_key', r.metric_key,
      'metric_date', r.metric_date,
      'dimension_key', r.dimension_key,
      'value', r.value,
      'recorded_at', r.recorded_at
    ) order by r.recorded_at desc, r.metric_key)
    from (
      select f.metric_key, f.metric_date, f.dimension_key, f.value, f.recorded_at
      from public.analytics_metric_daily f where f.origin = 'manual'
      order by f.recorded_at desc limit 30
    ) r
  ), '[]'::jsonb)
);
$$;

revoke all on function public.analytics_daily_values(text[], date, date, text) from public, anon, authenticated, service_role;
revoke all on function public.load_analytics_catalog() from public, anon, authenticated;
grant execute on function public.load_analytics_catalog() to service_role;

-------------------------------------------------------------------------------
-- 3. The overview's outreach cards and 90-day trend read the same totals.
-------------------------------------------------------------------------------
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
), outreach_totals as materialized (
  -- Every channel, as Trends adds them up; the batch totals and A/B tests stay batches only.
  select v.metric_key,v.metric_date,sum(v.value) as value
  from bounds cross join lateral public.analytics_daily_values(
    array['outreach.touches','outreach.replies','outreach.initial_dms','outreach.reply_base'],today-89,today,null) v
  group by 1,2
), period_activity as (
  select coalesce(sum(value) filter(where metric_key='outreach.touches' and metric_date>=current_start),0) as outreach_current,
    coalesce(sum(value) filter(where metric_key='outreach.touches' and metric_date>=previous_start and metric_date<current_start),0) as outreach_previous,
    coalesce(sum(value) filter(where metric_key='outreach.replies' and metric_date>=current_start),0) as replies_current,
    coalesce(sum(value) filter(where metric_key='outreach.replies' and metric_date>=previous_start and metric_date<current_start),0) as replies_previous,
    coalesce(sum(value) filter(where metric_key='outreach.initial_dms' and metric_date>=current_start),0) as initial_dms_current,
    coalesce(sum(value) filter(where metric_key='outreach.reply_base' and metric_date>=current_start),0) as reply_base_current
  from outreach_totals cross join bounds
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
  select metric_date as day,sum(value) filter(where metric_key='outreach.touches') as outreach,
    sum(value) filter(where metric_key='outreach.replies') as replies
  from outreach_totals group by metric_date
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

revoke all on function public.load_admin_analytics(integer, integer) from public, anon, authenticated;
grant execute on function public.load_admin_analytics(integer, integer) to service_role;

-------------------------------------------------------------------------------
-- 4. Definitions say what the totals include.
-------------------------------------------------------------------------------
update public.analytics_metric_definitions set description = 'Every outreach attempt: connection requests, first messages and follow-ups from logged batches, Dripify leads contacted, Reddit DMs sent and cold calls made. Voided entries excluded.'
where metric_key = 'outreach.touches';
update public.analytics_metric_definitions set description = 'People who replied on any channel, including everyone who answered a cold call with a positive, neutral or negative reply.'
where metric_key = 'outreach.replies';
update public.analytics_metric_definitions set description = 'What replies are measured against: first messages sent (for an A/B test, the sends at the tested step), Dripify leads contacted, Reddit DMs sent and cold calls made.'
where metric_key = 'outreach.reply_base';
update public.analytics_metric_definitions set description = 'Replies showing interest, from logged batches and cold calls. Dripify and Reddit DMs don''t record this.'
where metric_key = 'outreach.positive_replies';
update public.analytics_metric_definitions set description = 'Sales calls booked from outreach on every channel: logged batches, Reddit DMs and cold calls. Count a call only once Calendly confirms the booking.'
where metric_key = 'outreach.calls_booked';
update public.analytics_metric_definitions set description = 'Replies ÷ people reached, across every channel.'
where metric_key = 'outreach.reply_rate';
update public.analytics_metric_definitions set description = 'Positive replies ÷ people reached. Dripify and Reddit DMs don''t record positive replies, so they lower this rate; filter by channel to compare.'
where metric_key = 'outreach.positive_reply_rate';

commit;
