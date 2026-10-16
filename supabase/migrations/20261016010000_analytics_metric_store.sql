-- Business metric store: one daily grain for every number the business runs on,
-- rolled up on read to day, week, month, quarter or year.
--
-- * analytics_metric_definitions is the catalog. Its aggregation decides how a
--   metric rolls up: flows ('sum': views, touches) add up; stocks ('last':
--   followers, MRR) take each account's latest value, carried forward until a
--   newer one is recorded, then summed across accounts; rates ('ratio') are
--   always recomputed from their components, never averaged.
-- * analytics_metric_daily holds manual and connector values. Writes are
--   idempotent upserts keyed by (metric, day, account), so re-entering or
--   re-syncing a day replaces it instead of double counting.
-- * Ajani's own numbers (drafts, builds, workspaces, outreach) are derived live
--   from their source tables, so corrections and voids flow through with no
--   sync job and no copies to drift.
-- Weeks start on Monday (ISO). Days are UTC calendar days, matching the
-- existing cohort and outreach analytics.
begin;

create table public.analytics_metric_definitions (
  metric_key text primary key check (metric_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  category text not null check (category in ('business', 'outreach', 'content', 'revenue')),
  label text not null check (char_length(label) between 2 and 80),
  description text not null check (char_length(description) between 2 and 300),
  unit text not null check (unit in ('count', 'currency_cents', 'hours', 'ratio')),
  aggregation text not null check (aggregation in ('sum', 'last', 'ratio')),
  numerator_key text references public.analytics_metric_definitions(metric_key),
  denominator_key text references public.analytics_metric_definitions(metric_key),
  entry_mode text not null check (entry_mode in ('derived', 'manual', 'connector')),
  higher_is_better boolean not null default true,
  chartable boolean not null default true,
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (split_part(metric_key, '.', 1) = source),
  check ((aggregation = 'ratio') = (numerator_key is not null and denominator_key is not null)),
  check ((aggregation = 'ratio') = (unit = 'ratio'))
);

create table public.analytics_metric_daily (
  metric_key text not null references public.analytics_metric_definitions(metric_key),
  metric_date date not null check (metric_date >= date '2000-01-01'),
  -- '' is the primary account. Named accounts/campaigns use a normalized key.
  dimension_key text not null default '' check (dimension_key = '' or dimension_key ~ '^[a-z0-9@][a-z0-9_.:@/-]{0,79}$'),
  value numeric(20, 4) not null check (value >= 0 and value < 1e15),
  origin text not null check (origin in ('manual', 'connector')),
  recorded_by text not null check (char_length(recorded_by) between 1 and 200),
  recorded_at timestamptz not null default now(),
  primary key (metric_key, metric_date, dimension_key)
);
create index analytics_metric_daily_recorded_idx on public.analytics_metric_daily (recorded_at desc) where origin = 'manual';
create index outreach_batches_live_activity_idx on public.outreach_batches (activity_date) where voided_at is null;
create index organizations_created_idx on public.organizations (created_at);

alter table public.analytics_metric_definitions enable row level security;
alter table public.analytics_metric_daily enable row level security;
revoke all on public.analytics_metric_definitions, public.analytics_metric_daily from public, anon, authenticated, service_role;
-- Trusted server code reads directly but writes only through validating RPCs.
grant select on public.analytics_metric_definitions, public.analytics_metric_daily to service_role;

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('ajani.drafts_saved', 'ajani', 'business', 'Briefs saved', 'Website requests saved, by UTC day saved. Survives draft retention.', 'count', 'sum', null, null, 'derived', true, true, 10),
  ('ajani.cohort_submitted', 'ajani', 'business', 'Saved briefs later submitted', 'Briefs saved in the period that have since been submitted as builds.', 'count', 'sum', null, null, 'derived', true, false, 11),
  ('ajani.builds_submitted', 'ajani', 'business', 'Builds submitted', 'Approved build requests entering the delivery pipeline, by UTC day submitted.', 'count', 'sum', null, null, 'derived', true, true, 12),
  ('ajani.new_workspaces', 'ajani', 'business', 'New client workspaces', 'Business workspaces created when a client signs in to submit.', 'count', 'sum', null, null, 'derived', true, true, 13),

  ('outreach.touches', 'outreach', 'outreach', 'Outreach touches', 'Connection requests, first messages and follow-ups sent. Voided entries excluded.', 'count', 'sum', null, null, 'derived', true, true, 20),
  ('outreach.connection_requests', 'outreach', 'outreach', 'Connection requests', 'Connection requests sent.', 'count', 'sum', null, null, 'derived', true, true, 21),
  ('outreach.connections_accepted', 'outreach', 'outreach', 'Connections accepted', 'Connection requests accepted.', 'count', 'sum', null, null, 'derived', true, true, 22),
  ('outreach.initial_dms', 'outreach', 'outreach', 'First messages', 'Unique first messages sent.', 'count', 'sum', null, null, 'derived', true, true, 23),
  ('outreach.follow_ups', 'outreach', 'outreach', 'Follow-ups', 'First, second and custom follow-ups sent.', 'count', 'sum', null, null, 'derived', true, true, 24),
  ('outreach.replies', 'outreach', 'outreach', 'Replies', 'Unique replies received.', 'count', 'sum', null, null, 'derived', true, true, 25),
  ('outreach.reply_base', 'outreach', 'outreach', 'People messaged', 'Exposure replies are measured against: first messages, or sends at an experiment''s tested step.', 'count', 'sum', null, null, 'derived', true, false, 26),
  ('outreach.positive_replies', 'outreach', 'outreach', 'Positive replies', 'Replies showing interest.', 'count', 'sum', null, null, 'derived', true, true, 27),
  ('outreach.calls_booked', 'outreach', 'outreach', 'Calls booked', 'Sales calls booked from outreach.', 'count', 'sum', null, null, 'derived', true, true, 28),

  ('youtube.subscribers', 'youtube', 'content', 'YouTube subscribers', 'Channel subscribers on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 40),
  ('youtube.views', 'youtube', 'content', 'YouTube views', 'Video views during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 41),
  ('youtube.watch_hours', 'youtube', 'content', 'YouTube watch hours', 'Hours watched during the recorded day or period.', 'hours', 'sum', null, null, 'manual', true, true, 42),
  ('youtube.likes', 'youtube', 'content', 'YouTube likes', 'Likes received during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 43),
  ('youtube.comments', 'youtube', 'content', 'YouTube comments', 'Comments received during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 44),
  ('youtube.videos_published', 'youtube', 'content', 'YouTube videos published', 'Videos and Shorts published.', 'count', 'sum', null, null, 'manual', true, true, 45),

  ('tiktok.followers', 'tiktok', 'content', 'TikTok followers', 'Account followers on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 50),
  ('tiktok.views', 'tiktok', 'content', 'TikTok views', 'Video views during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 51),
  ('tiktok.likes', 'tiktok', 'content', 'TikTok likes', 'Likes received during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 52),
  ('tiktok.comments', 'tiktok', 'content', 'TikTok comments', 'Comments received during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 53),
  ('tiktok.shares', 'tiktok', 'content', 'TikTok shares', 'Shares during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 54),
  ('tiktok.profile_views', 'tiktok', 'content', 'TikTok profile views', 'Profile views during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 55),
  ('tiktok.videos_published', 'tiktok', 'content', 'TikTok videos published', 'Videos published.', 'count', 'sum', null, null, 'manual', true, true, 56),

  ('instagram.followers', 'instagram', 'content', 'Instagram followers', 'Account followers on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 60),
  ('instagram.reach', 'instagram', 'content', 'Instagram reach', 'Accounts reached during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 61),
  ('instagram.views', 'instagram', 'content', 'Instagram views', 'Views during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 62),
  ('instagram.interactions', 'instagram', 'content', 'Instagram interactions', 'Likes, comments, shares and saves during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 63),
  ('instagram.profile_visits', 'instagram', 'content', 'Instagram profile visits', 'Profile visits during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 64),
  ('instagram.posts_published', 'instagram', 'content', 'Instagram posts published', 'Posts and Reels published.', 'count', 'sum', null, null, 'manual', true, true, 65),

  ('linkedin.followers', 'linkedin', 'content', 'LinkedIn followers', 'Profile or page followers on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 70),
  ('linkedin.impressions', 'linkedin', 'content', 'LinkedIn impressions', 'Post impressions during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 71),
  ('linkedin.engagements', 'linkedin', 'content', 'LinkedIn engagements', 'Reactions, comments and reposts during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 72),
  ('linkedin.profile_views', 'linkedin', 'content', 'LinkedIn profile views', 'Profile views during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 73),
  ('linkedin.posts_published', 'linkedin', 'content', 'LinkedIn posts published', 'Posts published.', 'count', 'sum', null, null, 'manual', true, true, 74),

  ('x.followers', 'x', 'content', 'X followers', 'Account followers on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 80),
  ('x.impressions', 'x', 'content', 'X impressions', 'Post impressions during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 81),
  ('x.engagements', 'x', 'content', 'X engagements', 'Likes, replies, reposts and clicks during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 82),
  ('x.posts_published', 'x', 'content', 'X posts published', 'Posts published.', 'count', 'sum', null, null, 'manual', true, true, 83),

  ('sales.calls_held', 'sales', 'revenue', 'Sales calls held', 'Discovery and sales calls that took place.', 'count', 'sum', null, null, 'manual', true, true, 90),
  ('sales.proposals_sent', 'sales', 'revenue', 'Proposals sent', 'Quotes or proposals sent to prospects.', 'count', 'sum', null, null, 'manual', true, true, 91),
  ('sales.deals_won', 'sales', 'revenue', 'Deals won', 'Prospects who became paying clients.', 'count', 'sum', null, null, 'manual', true, true, 92),
  ('revenue.cash_collected', 'revenue', 'revenue', 'Cash collected', 'Payments received during the recorded day or period.', 'currency_cents', 'sum', null, null, 'manual', true, true, 95),
  ('revenue.mrr', 'revenue', 'revenue', 'Monthly recurring revenue', 'Active monthly retainers on the recorded day.', 'currency_cents', 'last', null, null, 'manual', true, true, 96),
  ('revenue.active_clients', 'revenue', 'revenue', 'Active clients', 'Paying clients on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 97);

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('ajani.brief_to_build_rate', 'ajani', 'business', 'Brief → build conversion', 'Share of briefs saved in the period that became submitted builds (cohort).', 'ratio', 'ratio', 'ajani.cohort_submitted', 'ajani.drafts_saved', 'derived', true, true, 14),
  ('outreach.acceptance_rate', 'outreach', 'outreach', 'Connection acceptance', 'Connections accepted ÷ connection requests.', 'ratio', 'ratio', 'outreach.connections_accepted', 'outreach.connection_requests', 'derived', true, true, 30),
  ('outreach.reply_rate', 'outreach', 'outreach', 'Reply rate', 'Replies ÷ people messaged at the measured step.', 'ratio', 'ratio', 'outreach.replies', 'outreach.reply_base', 'derived', true, true, 31),
  ('outreach.positive_reply_rate', 'outreach', 'outreach', 'Positive reply rate', 'Positive replies ÷ people messaged at the measured step.', 'ratio', 'ratio', 'outreach.positive_replies', 'outreach.reply_base', 'derived', true, true, 32),
  ('outreach.reply_to_call_rate', 'outreach', 'outreach', 'Replies → calls', 'Calls booked ÷ replies.', 'ratio', 'ratio', 'outreach.calls_booked', 'outreach.replies', 'derived', true, true, 33),
  ('sales.close_rate', 'sales', 'revenue', 'Close rate', 'Deals won ÷ sales calls held.', 'ratio', 'ratio', 'sales.deals_won', 'sales.calls_held', 'derived', true, true, 93);

-- Internal: one row per metric, UTC day and account. Derived blocks run only
-- when one of their keys is requested (constant one-time filters).
create function public.analytics_daily_values(p_keys text[], p_from date, p_to date, p_dimension text)
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
    select b.activity_date, lower(b.channel) || '/' || lower(b.method) as dimension_key,
      sum(m.connection_requests)::numeric as connection_requests,
      sum(m.connections_accepted)::numeric as connections_accepted,
      sum(m.initial_dms)::numeric as initial_dms,
      sum(m.f1_sent::bigint + m.f2_sent + m.custom_sent)::numeric as follow_ups,
      sum(m.replies)::numeric as replies,
      sum(m.reply_base)::numeric as reply_base,
      sum(m.positive_replies)::numeric as positive_replies,
      sum(m.calls_booked)::numeric as calls_booked
    from public.outreach_batches b
    join public.outreach_batch_metrics m on m.batch_id = b.id
    where b.voided_at is null and b.activity_date between p_from and p_to
      and p_keys && array['outreach.touches', 'outreach.connection_requests', 'outreach.connections_accepted',
        'outreach.initial_dms', 'outreach.follow_ups', 'outreach.replies', 'outreach.reply_base',
        'outreach.positive_replies', 'outreach.calls_booked']
      and (p_dimension is null or lower(b.channel) || '/' || lower(b.method) = p_dimension)
    group by 1, 2
  ) o
  cross join lateral (values
    ('outreach.touches', o.connection_requests + o.initial_dms + o.follow_ups),
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

create function public.load_analytics_series(
  p_metric_keys text[],
  p_grain text,
  p_from date,
  p_to date,
  p_dimension text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  step interval;
  range_from date;
  range_to date;
  previous_from date;
  previous_to date;
  bucket_count integer;
  requested text[];
  components text[];
  missing_key text;
  dimension text := nullif(lower(btrim(p_dimension)), '');
begin
  if p_grain is null or p_grain not in ('day', 'week', 'month', 'quarter', 'year') then
    raise exception 'Unsupported grain';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_from < date '2000-01-01' or p_to > today + 1 then
    raise exception 'Invalid date range';
  end if;
  if dimension is not null and dimension !~ '^[a-z0-9@][a-z0-9_.:@/-]{0,79}$' then
    raise exception 'Invalid dimension';
  end if;

  select array_agg(distinct key) into requested from unnest(p_metric_keys) key where key is not null;
  if coalesce(cardinality(requested), 0) not between 1 and 12 then
    raise exception 'Request between one and twelve metrics';
  end if;
  select key into missing_key from unnest(requested) key
  where not exists (select 1 from public.analytics_metric_definitions d where d.metric_key = key and d.active)
  limit 1;
  if missing_key is not null then
    raise exception 'Unknown metric %', missing_key;
  end if;

  step := case when p_grain = 'quarter' then interval '3 months' else ('1 ' || p_grain)::interval end;
  range_from := date_trunc(p_grain, p_from::timestamp)::date;
  range_to := p_to;
  select count(*) into bucket_count from generate_series(range_from::timestamp, range_to::timestamp, step);
  if bucket_count > 732 then
    raise exception 'Too many periods; choose a larger grain';
  end if;
  -- Equal-length comparison window immediately before the selected range.
  previous_to := range_from - 1;
  previous_from := range_from - (range_to - range_from + 1);

  select array_agg(distinct component) into components from (
    select d.metric_key as component from public.analytics_metric_definitions d
    where d.metric_key = any(requested) and d.aggregation <> 'ratio'
    union select d.numerator_key from public.analytics_metric_definitions d
    where d.metric_key = any(requested) and d.aggregation = 'ratio'
    union select d.denominator_key from public.analytics_metric_definitions d
    where d.metric_key = any(requested) and d.aggregation = 'ratio'
  ) parts;

  return (
    with defs as materialized (
      select d.metric_key, d.aggregation, d.entry_mode from public.analytics_metric_definitions d
      where d.metric_key = any(components)
    ), facts as materialized (
      select v.metric_key, v.metric_date, v.dimension_key, v.value, d.aggregation, d.entry_mode,
        v.metric_date >= range_from as is_current,
        date_trunc(p_grain, v.metric_date::timestamp)::date as bucket_start
      from public.analytics_daily_values(components, previous_from, range_to, dimension) v
      join defs d on d.metric_key = v.metric_key
    ), buckets as (
      select (row_number() over (order by b) - 1)::integer as idx, b::date as bucket_start,
        least((b + step)::date - 1, range_to) as bucket_end,
        (b + step)::date - 1 > range_to as partial
      from generate_series(range_from::timestamp, range_to::timestamp, step) b
    ), stock_seed as materialized (
      -- Stocks carry forward: each account's last value before the window
      -- still counts until a newer value replaces it.
      select distinct on (f.metric_key, f.dimension_key) f.metric_key, f.dimension_key, f.metric_date, f.value::numeric as value
      from public.analytics_metric_daily f
      join defs d on d.metric_key = f.metric_key and d.aggregation = 'last'
      where f.metric_date < previous_from and (dimension is null or f.dimension_key = dimension)
      order by f.metric_key, f.dimension_key, f.metric_date desc
    ), stock_observations as materialized (
      select f.metric_key, f.dimension_key, f.metric_date, f.value from facts f where f.aggregation = 'last'
      union all
      select s.metric_key, s.dimension_key, s.metric_date, s.value from stock_seed s
    ), stock_buckets as (
      -- Value at the end of each bucket: latest value per account, summed.
      select b.bucket_start, latest.metric_key, sum(latest.value) as value
      from buckets b
      cross join lateral (
        select distinct on (o.metric_key, o.dimension_key) o.metric_key, o.value
        from stock_observations o where o.metric_date <= b.bucket_end
        order by o.metric_key, o.dimension_key, o.metric_date desc
      ) latest
      group by b.bucket_start, latest.metric_key
    ), component_buckets as (
      select f.metric_key, f.bucket_start, sum(f.value) as value
      from facts f where f.is_current and f.aggregation = 'sum'
      group by f.metric_key, f.bucket_start
      union all
      select s.metric_key, s.bucket_start, s.value from stock_buckets s
    ), stock_totals as (
      select latest.metric_key, latest.is_current, sum(latest.value) as value
      from (
        select distinct on (o.metric_key, o.dimension_key) o.metric_key, true as is_current, o.value
        from stock_observations o where o.metric_date <= range_to
        order by o.metric_key, o.dimension_key, o.metric_date desc
      ) latest
      group by latest.metric_key, latest.is_current
      union all
      select latest.metric_key, latest.is_current, sum(latest.value)
      from (
        select distinct on (o.metric_key, o.dimension_key) o.metric_key, false as is_current, o.value
        from stock_observations o where o.metric_date <= previous_to
        order by o.metric_key, o.dimension_key, o.metric_date desc
      ) latest
      group by latest.metric_key, latest.is_current
    ), component_totals as (
      select f.metric_key,
        sum(f.value) filter (where f.is_current) as current_value,
        sum(f.value) filter (where not f.is_current) as previous_value
      from facts f where f.aggregation = 'sum'
      group by f.metric_key
      union all
      select s.metric_key,
        sum(s.value) filter (where s.is_current),
        sum(s.value) filter (where not s.is_current)
      from stock_totals s
      group by s.metric_key
    ), filled as (
      -- Derived flows are true zeros on quiet days; recorded metrics without a
      -- value stay null (unknown), never zero.
      select d.metric_key, b.idx, b.bucket_start,
        case when cb.value is not null then cb.value
          when d.entry_mode = 'derived' and d.aggregation = 'sum' then 0 end as value
      from defs d cross join buckets b
      left join component_buckets cb on cb.metric_key = d.metric_key and cb.bucket_start = b.bucket_start
    ), totals as (
      select d.metric_key,
        case when ct.current_value is not null then ct.current_value
          when d.entry_mode = 'derived' and d.aggregation = 'sum' then 0 end as current_value,
        case when ct.previous_value is not null then ct.previous_value
          when d.entry_mode = 'derived' and d.aggregation = 'sum' then 0 end as previous_value
      from defs d left join component_totals ct on ct.metric_key = d.metric_key
    ), series as (
      select r.metric_key,
        jsonb_build_object(
          'metric_key', r.metric_key,
          'values', jsonb_agg(
            case when r.aggregation = 'ratio' then
              case when den.value > 0 and num.value is not null then round(num.value / den.value, 6) end
            else own.value end
            order by own.idx),
          'numerators', case when r.aggregation = 'ratio' then jsonb_agg(num.value order by own.idx) end,
          'denominators', case when r.aggregation = 'ratio' then jsonb_agg(den.value order by own.idx) end
        ) as payload
      from public.analytics_metric_definitions r
      join filled own on own.metric_key = case when r.aggregation = 'ratio' then r.denominator_key else r.metric_key end
      left join filled num on num.metric_key = r.numerator_key and num.idx = own.idx
      left join filled den on den.metric_key = r.denominator_key and den.idx = own.idx
      where r.metric_key = any(requested)
      group by r.metric_key, r.aggregation
    ), summaries as (
      select r.metric_key,
        jsonb_build_object(
          'current', case when r.aggregation = 'ratio' then
              case when dt.current_value > 0 and nt.current_value is not null then round(nt.current_value / dt.current_value, 6) end
            else ot.current_value end,
          'previous', case when r.aggregation = 'ratio' then
              case when dt.previous_value > 0 and nt.previous_value is not null then round(nt.previous_value / dt.previous_value, 6) end
            else ot.previous_value end,
          'current_numerator', nt.current_value,
          'current_denominator', dt.current_value,
          'previous_numerator', nt.previous_value,
          'previous_denominator', dt.previous_value
        ) as payload
      from public.analytics_metric_definitions r
      left join totals ot on ot.metric_key = r.metric_key
      left join totals nt on nt.metric_key = r.numerator_key
      left join totals dt on dt.metric_key = r.denominator_key
      where r.metric_key = any(requested)
    )
    select jsonb_build_object(
      'grain', p_grain,
      'from', range_from,
      'to', range_to,
      'previous_from', previous_from,
      'previous_to', previous_to,
      'today', today,
      'dimension', dimension,
      'buckets', (select jsonb_agg(jsonb_build_object('start', b.bucket_start, 'end', b.bucket_end, 'partial', b.partial) order by b.idx) from buckets b),
      'series', coalesce((select jsonb_agg(s.payload || m.payload order by s.metric_key)
        from series s join summaries m on m.metric_key = s.metric_key), '[]'::jsonb)
    )
  );
end;
$$;

create function public.load_analytics_catalog()
returns jsonb language sql stable security definer set search_path = '' as $$
with stored as (
  select f.metric_key, min(f.metric_date) as first_date, max(f.metric_date) as last_date
  from public.analytics_metric_daily f group by f.metric_key
), stored_dimensions as (
  select ranked.metric_key, jsonb_agg(ranked.dimension_key order by ranked.dimension_key) as dimensions
  from (
    select distinct_dimensions.metric_key, distinct_dimensions.dimension_key,
      row_number() over (partition by distinct_dimensions.metric_key order by distinct_dimensions.dimension_key) as position
    from (select distinct f.metric_key, f.dimension_key from public.analytics_metric_daily f where f.dimension_key <> '') distinct_dimensions
  ) ranked
  where ranked.position <= 50
  group by ranked.metric_key
), outreach_dimensions as (
  select coalesce(jsonb_agg(d.dimension_key order by d.dimension_key), '[]'::jsonb) as dimensions
  from (
    select distinct lower(b.channel) || '/' || lower(b.method) as dimension_key
    from public.outreach_batches b where b.voided_at is null
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

create function public.upsert_analytics_metric_values(p_values jsonb, p_origin text, p_actor text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  definition public.analytics_metric_definitions%rowtype;
  item_key text;
  item_date date;
  item_dimension text;
  item_value numeric;
  written integer := 0;
  changed integer;
  today date := (now() at time zone 'UTC')::date;
begin
  if p_origin is null or p_origin not in ('manual', 'connector') then
    raise exception 'Unsupported metric origin';
  end if;
  if char_length(btrim(coalesce(p_actor, ''))) not between 1 and 200 then
    raise exception 'An actor is required';
  end if;
  if jsonb_typeof(p_values) is distinct from 'array' or jsonb_array_length(p_values) not between 1 and 500 then
    raise exception 'Provide between one and five hundred metric values';
  end if;

  for item in select value from jsonb_array_elements(p_values)
  loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item -> 'value') is distinct from 'number' then
      raise exception 'Each metric value must be a number';
    end if;
    item_key := item ->> 'metricKey';
    item_date := (item ->> 'date')::date;
    item_dimension := lower(btrim(coalesce(item ->> 'dimension', '')));
    item_value := (item ->> 'value')::numeric;

    select * into definition from public.analytics_metric_definitions where metric_key = item_key and active;
    if not found then
      raise exception 'Unknown metric %', item_key;
    end if;
    if definition.aggregation = 'ratio' or definition.entry_mode = 'derived' then
      raise exception 'Metric % is calculated automatically', item_key;
    end if;
    if p_origin = 'manual' and definition.entry_mode <> 'manual' then
      raise exception 'Metric % is only written by its integration', item_key;
    end if;
    if item_date is null or item_date < date '2000-01-01' or item_date > today + 1 then
      raise exception 'Metric dates must be between 2000-01-01 and today';
    end if;
    if item_value is null or item_value < 0 or item_value >= 1e15 then
      raise exception 'Metric values must be zero or positive';
    end if;
    if definition.unit in ('count', 'currency_cents') and item_value <> trunc(item_value) then
      raise exception 'Metric % must be a whole number', item_key;
    end if;
    if item_dimension <> '' and item_dimension !~ '^[a-z0-9@][a-z0-9_.:@/-]{0,79}$' then
      raise exception 'Account names may use letters, numbers, @ . _ : / and -';
    end if;

    insert into public.analytics_metric_daily as existing (metric_key, metric_date, dimension_key, value, origin, recorded_by)
    values (item_key, item_date, item_dimension, round(item_value, 4), p_origin, btrim(p_actor))
    on conflict (metric_key, metric_date, dimension_key) do update
      set value = excluded.value, origin = excluded.origin, recorded_by = excluded.recorded_by, recorded_at = now()
      where existing.value is distinct from excluded.value or existing.origin is distinct from excluded.origin;
    get diagnostics changed = row_count;
    written := written + changed;
  end loop;

  if written > 0 then
    insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
    values (btrim(p_actor), 'recorded', 'analytics_metric_values', null, jsonb_build_object(
      'origin', p_origin,
      'written', written,
      'metric_keys', (select jsonb_agg(distinct v ->> 'metricKey') from jsonb_array_elements(p_values) v)
    ));
  end if;
  return written;
end;
$$;

create function public.delete_analytics_metric_value(p_metric_key text, p_metric_date date, p_dimension_key text, p_actor text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  deleted_value numeric;
begin
  if char_length(btrim(coalesce(p_actor, ''))) not between 1 and 200 then
    raise exception 'An actor is required';
  end if;
  delete from public.analytics_metric_daily
  where metric_key = p_metric_key and metric_date = p_metric_date
    and dimension_key = lower(btrim(coalesce(p_dimension_key, ''))) and origin = 'manual'
  returning value into deleted_value;
  if deleted_value is null then return false; end if;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (btrim(p_actor), 'deleted', 'analytics_metric_value', p_metric_key, jsonb_build_object(
    'metric_date', p_metric_date, 'dimension_key', lower(btrim(coalesce(p_dimension_key, ''))), 'value', deleted_value
  ));
  return true;
end;
$$;

revoke all on function public.analytics_daily_values(text[], date, date, text) from public, anon, authenticated, service_role;
revoke all on function public.load_analytics_series(text[], text, date, date, text) from public, anon, authenticated;
revoke all on function public.load_analytics_catalog() from public, anon, authenticated;
revoke all on function public.upsert_analytics_metric_values(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.delete_analytics_metric_value(text, date, text, text) from public, anon, authenticated;
grant execute on function public.load_analytics_series(text[], text, date, date, text) to service_role;
grant execute on function public.load_analytics_catalog() to service_role;
grant execute on function public.upsert_analytics_metric_values(jsonb, text, text) to service_role;
grant execute on function public.delete_analytics_metric_value(text, date, text, text) to service_role;

commit;
