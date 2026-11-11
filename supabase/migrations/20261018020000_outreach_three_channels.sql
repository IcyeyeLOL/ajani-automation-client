-- Outreach is Dripify, Reddit DMs and cold calls (2026-10-18).
--
-- The owner reaches people three ways: Dripify, Reddit DMs and cold calls.
-- Nobody hand-logs LinkedIn, Instagram, Reddit or YouTube outreach batches, so
-- Outreach now adds up only those three channels (each still a Channel-filter
-- option):
--
--   linkedin/dripify   the sync's leads contacted (touches, connection requests
--                      and people reached), acceptances and replies, plus the
--                      positive replies and calls booked logged in Log numbers
--   reddit/dm          DMs sent (first messages and people reached), replies,
--                      calls booked
--   phone/cold_call    calls made (touches and people reached), positive
--                      answers (replies and positive replies), meetings booked
--
-- Cold calls count only a positive answer as a reply: neutral and negative
-- answers inflated the reply rate. Outreach batches stay in their tables and
-- still feed the Experiments page (A/B tests), but no longer count toward
-- Outreach, so nothing can be counted twice. Follow-ups and first messages are
-- retired from the catalog: nothing the owner uses feeds them.
--
-- Additive for data: two new Dripify definitions; no stored value changes.
begin;

-------------------------------------------------------------------------------
-- 1. Dripify outcomes Dripify doesn't report, logged in Log numbers.
-------------------------------------------------------------------------------
insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('dripify.positive_replies', 'dripify', 'outreach', 'Dripify positive replies', 'Replies from Dripify conversations that showed interest. Dripify doesn''t report these, so log them here on the day they came in.', 'count', 'sum', null, null, 'manual', true, true, 42),
  ('dripify.calls_booked', 'dripify', 'outreach', 'Dripify calls booked', 'Sales calls booked from Dripify conversations. Count one only once Calendly confirms the booking.', 'count', 'sum', null, null, 'manual', true, true, 42)
on conflict (metric_key) do nothing;

-------------------------------------------------------------------------------
-- 2. Daily values: the outreach block reads the three channels.
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
      -- Touches that are not LinkedIn steps: cold calls made.
      sum(s.other_touches) as other_touches,
      sum(s.replies) as replies,
      sum(s.reply_base) as reply_base,
      sum(s.positive_replies) as positive_replies,
      sum(s.calls_booked) as calls_booked
    from (
      -- Dripify: the sync's new leads contacted (as connection requests and
      -- people reached), new acceptances and new replies, every campaign; the
      -- positive replies and calls booked from Dripify conversations are logged
      -- in Log numbers, because Dripify doesn't report them.
      select f.metric_date as activity_date, 'linkedin/dripify'::text as dimension_key,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_contacted'), 0) as connection_requests,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_accepted'), 0) as connections_accepted,
        0::numeric as initial_dms,
        0::numeric as follow_ups,
        0::numeric as other_touches,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_replies'), 0) as replies,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.new_contacted'), 0) as reply_base,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.positive_replies'), 0) as positive_replies,
        coalesce(sum(f.value) filter (where f.metric_key = 'dripify.calls_booked'), 0) as calls_booked
      from public.analytics_metric_daily f
      where f.metric_key in ('dripify.new_contacted', 'dripify.new_accepted', 'dripify.new_replies', 'dripify.positive_replies', 'dripify.calls_booked')
        and f.metric_date between p_from and p_to
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
      -- Cold calls: only a positive answer is a reply; neutral and negative
      -- answers would inflate the reply rate.
      select f.metric_date, 'phone/cold_call', 0, 0, 0, 0,
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.dials'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.positive_replies'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.dials'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.positive_replies'), 0),
        coalesce(sum(f.value) filter (where f.metric_key = 'cold_calls.meetings_booked'), 0)
      from public.analytics_metric_daily f
      where f.metric_key in ('cold_calls.dials', 'cold_calls.positive_replies', 'cold_calls.meetings_booked')
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
-- 3. Catalog: the Channel filter lists the three channels with numbers.
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
  select coalesce(jsonb_agg(channel.dimension_key order by channel.dimension_key), '[]'::jsonb) as dimensions
  from (values
    ('linkedin/dripify', array['dripify.new_contacted', 'dripify.new_accepted', 'dripify.new_replies', 'dripify.positive_replies', 'dripify.calls_booked']),
    ('reddit/dm', array['reddit.dms_sent', 'reddit.dm_replies', 'reddit.dm_calls_booked']),
    ('phone/cold_call', array['cold_calls.dials', 'cold_calls.positive_replies', 'cold_calls.meetings_booked'])
  ) channel(dimension_key, metric_keys)
  where exists (select 1 from per_dimension p where p.metric_key = any(channel.metric_keys))
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
-- 4. Definitions say what the totals include; unused ones are retired.
-------------------------------------------------------------------------------
update public.analytics_metric_definitions set active = false where metric_key = 'outreach.follow_ups';
update public.analytics_metric_definitions set active = false where metric_key = 'outreach.initial_dms';
update public.analytics_metric_definitions set label = 'People reached', description = 'Everyone reached, which replies are measured against: leads Dripify contacted, Reddit DMs sent and cold calls made.'
where metric_key = 'outreach.reply_base';
update public.analytics_metric_definitions set description = 'Every outreach attempt: leads Dripify contacted, Reddit DMs sent and cold calls made. Dripify reports each lead once, not each message, so a Dripify lead is one touch.'
where metric_key = 'outreach.touches';
update public.analytics_metric_definitions set description = 'Leads Dripify contacted (Dripify reports leads contacted, not invites).'
where metric_key = 'outreach.connection_requests';
update public.analytics_metric_definitions set description = 'Connections accepted on Dripify.'
where metric_key = 'outreach.connections_accepted';
update public.analytics_metric_definitions set description = 'Connections accepted ÷ leads Dripify contacted, as Dripify shows it. Acceptances come in after the request, so a short range can read high.'
where metric_key = 'outreach.acceptance_rate';
update public.analytics_metric_definitions set description = 'People who replied: Dripify and Reddit DM replies, and cold calls with a positive answer. Neutral and negative cold-call answers don''t count.'
where metric_key = 'outreach.replies';
update public.analytics_metric_definitions set description = 'Replies ÷ people reached, across Dripify, Reddit DMs and cold calls. Replies can come in a later period than the message they answer, so a short range can read high.'
where metric_key = 'outreach.reply_rate';
update public.analytics_metric_definitions set description = 'Replies showing interest: Dripify positive replies you log and cold calls with a positive answer. Reddit DMs don''t record this.'
where metric_key = 'outreach.positive_replies';
update public.analytics_metric_definitions set description = 'Positive replies ÷ people reached. Reddit DMs don''t record positive replies, so they lower this rate; filter by channel to compare.'
where metric_key = 'outreach.positive_reply_rate';
update public.analytics_metric_definitions set description = 'Sales calls booked from Dripify conversations, Reddit DMs and cold calls. Count a call only once Calendly confirms the booking.'
where metric_key = 'outreach.calls_booked';
update public.analytics_metric_definitions set description = 'Calls booked ÷ replies, across Dripify, Reddit DMs and cold calls.'
where metric_key = 'outreach.reply_to_call_rate';

commit;
