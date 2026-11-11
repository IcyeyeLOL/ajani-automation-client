-- Growth goals, and metric definitions aligned with how the owner measures
-- the business (review of the owner's notes, 2026-10-16).
--
-- * analytics_goals holds dated targets. The seed rows come from the owner's
--   Growth Goal Sheet (Jul 12, 2026 to Jan 1, 2027): 5 signed clients, $5,000
--   collected, $2,000 a month in retainers and 4,000 LinkedIn followers, which
--   the sheet tracks separately ("both have to hit target"), plus the LinkedIn
--   post system's 3-4 posts a week.
-- * load_analytics_goals() measures every goal with load_analytics_series(),
--   so a goal always agrees with the Trends chart of the same metric:
--     total  = sum of a 'sum' metric from the start date to today (or the due date)
--     latest = the latest value of a 'last' metric, with its value the day
--              before the goal began as the baseline
--     weekly = sum of a 'sum' metric this ISO week, plus last week's total
--   Nothing recorded stays null (unknown), never zero.
-- * Definitions that said something different from the owner's notes are
--   corrected, the numbers the notes rely on are added, and X is retired: no
--   note shows X in use. Deactivated metrics keep their data.
begin;

-------------------------------------------------------------------------------
-- 1. Definitions the owner's notes define differently.
-------------------------------------------------------------------------------
update public.analytics_metric_definitions set label = 'Clients signed',
  description = 'Clients who signed and paid their first invoice (the setup fee), on the day they paid.'
where metric_key = 'sales.deals_won';
update public.analytics_metric_definitions set description = 'Clients signed ÷ sales calls held.'
where metric_key = 'sales.close_rate';
update public.analytics_metric_definitions set description = 'Booked calls the prospect showed up to.'
where metric_key = 'sales.calls_held';
update public.analytics_metric_definitions set description = 'Sales calls booked from logged outreach. Count a call only once Calendly confirms the booking.'
where metric_key = 'outreach.calls_booked';
update public.analytics_metric_definitions set description = 'Money received during the recorded day or period, setup fees and retainers together.'
where metric_key = 'revenue.cash_collected';
update public.analytics_metric_definitions set description = 'Monthly retainer fees from clients paying right now. Setup fees and pilots without a retainer do not count.'
where metric_key = 'revenue.mrr';
update public.analytics_metric_definitions set description = 'Clients paying you right now. Not the same as total clients signed, which the growth goal counts.'
where metric_key = 'revenue.active_clients';
update public.analytics_metric_definitions set description = 'LinkedIn''s social engagements during the recorded day or period: reactions, comments, reposts, sends and saves.'
where metric_key = 'linkedin.engagements';
update public.analytics_metric_definitions set label = 'Reply base',
  description = 'What replies are measured against: first messages sent, or for an A/B test the sends at the tested step.'
where metric_key = 'outreach.reply_base';
update public.analytics_metric_definitions set description = 'Leads that received at least one Dripify step, added up across campaigns (a lead in two campaigns counts twice).'
where metric_key = 'dripify.leads_contacted';
update public.analytics_metric_definitions set label = 'Dripify acceptance rate (lifetime)',
  description = 'Leads who accepted ÷ leads contacted, over each campaign''s whole life so far, so it moves slowly. Matches Dripify''s own acceptance rate.'
where metric_key = 'dripify.acceptance_rate';
update public.analytics_metric_definitions set label = 'Dripify reply rate (lifetime)',
  description = 'Leads who replied ÷ leads contacted (replies per 100 people reached), over each campaign''s whole life so far. Matches Dripify''s own reply rate.'
where metric_key = 'dripify.reply_rate';

-------------------------------------------------------------------------------
-- 2. Numbers the notes rely on that were missing, and X retired.
-------------------------------------------------------------------------------
insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('instagram.saves', 'instagram', 'content', 'Instagram saves', 'Saves during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 66),
  ('instagram.shares', 'instagram', 'content', 'Instagram shares', 'Shares during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 67),
  ('linkedin.reactions', 'linkedin', 'content', 'LinkedIn reactions', 'Reactions on your posts during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 75),
  ('linkedin.comments', 'linkedin', 'content', 'LinkedIn comments', 'Comments on your posts during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 76),
  ('reddit.views', 'reddit', 'content', 'Reddit views', 'Views on your Reddit posts during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 84),
  ('reddit.posts_published', 'reddit', 'content', 'Reddit posts published', 'Posts published.', 'count', 'sum', null, null, 'manual', true, true, 85),
  ('sales.content_leads', 'sales', 'revenue', 'Leads from content', 'Qualified DMs or conversations that started from your posts or videos, on any platform. Count each person once, on the day they reached out.', 'count', 'sum', null, null, 'manual', true, true, 89);

update public.analytics_metric_definitions set active = false where source = 'x';

-------------------------------------------------------------------------------
-- 3. Growth goals.
-------------------------------------------------------------------------------
create table public.analytics_goals (
  goal_key text primary key check (goal_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  metric_key text not null references public.analytics_metric_definitions(metric_key),
  label text not null check (char_length(label) between 2 and 80),
  description text not null check (char_length(description) between 2 and 300),
  measure text not null check (measure in ('total', 'latest', 'weekly')),
  target numeric not null check (target > 0),
  -- The series function rejects dates before 2000; one bad row must not hide every goal.
  start_date date not null check (start_date >= date '2000-01-01'),
  -- Weekly goals repeat every week; the others have a deadline at most two years out.
  due_date date check (due_date > start_date and due_date - start_date <= 730),
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((measure = 'weekly') = (due_date is null))
);
alter table public.analytics_goals enable row level security;
revoke all on public.analytics_goals from public, anon, authenticated, service_role;
grant select on public.analytics_goals to service_role;

-- A running total needs a metric that adds up; a latest value needs a stock.
create function public.check_analytics_goal_metric() returns trigger
language plpgsql set search_path = '' as $$
declare
  metric_aggregation text;
begin
  select d.aggregation into metric_aggregation from public.analytics_metric_definitions d where d.metric_key = new.metric_key;
  if (new.measure in ('total', 'weekly') and metric_aggregation <> 'sum') or (new.measure = 'latest' and metric_aggregation <> 'last') then
    raise exception 'Goal % measures % but % aggregates as %', new.goal_key, new.measure, new.metric_key, metric_aggregation;
  end if;
  return new;
end;
$$;
create trigger analytics_goals_metric_check before insert or update of metric_key, measure on public.analytics_goals
for each row execute function public.check_analytics_goal_metric();
revoke all on function public.check_analytics_goal_metric() from public, anon, authenticated;

-- The same rule from the other side: a metric a goal measures keeps its aggregation.
create function public.protect_goal_metric_aggregation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.analytics_goals g where g.metric_key = new.metric_key) then
    raise exception 'Metric % is measured by a goal; change or remove the goal before changing its aggregation', new.metric_key;
  end if;
  return new;
end;
$$;
create trigger analytics_metric_definitions_goal_aggregation before update of aggregation on public.analytics_metric_definitions
for each row when (old.aggregation is distinct from new.aggregation)
execute function public.protect_goal_metric_aggregation();
revoke all on function public.protect_goal_metric_aggregation() from public, anon, authenticated;

insert into public.analytics_goals (goal_key, metric_key, label, description, measure, target, start_date, due_date, sort_order) values
  ('clients_signed', 'sales.deals_won', 'Clients signed',
    'Growth Goal Sheet: 5 signed clients by Jan 1, 2027, counted from Jul 12, 2026. A client counts once they sign and pay the first invoice.',
    'total', 5, date '2026-07-12', date '2027-01-01', 10),
  ('revenue_collected', 'revenue.cash_collected', 'Revenue collected',
    'Growth Goal Sheet: $5,000+ collected between Jul 12, 2026 and Jan 1, 2027. Tracked separately from monthly recurring revenue; both have to hit target.',
    'total', 500000, date '2026-07-12', date '2027-01-01', 20),
  ('monthly_recurring_revenue', 'revenue.mrr', 'Monthly recurring revenue',
    'Growth Goal Sheet: $2,000+ a month in active retainers by Jan 1, 2027. Setup fees and pilots without a retainer do not count.',
    'latest', 200000, date '2026-07-12', date '2027-01-01', 30),
  ('linkedin_followers', 'linkedin.followers', 'LinkedIn followers',
    'Growth Goal Sheet: 4,000 LinkedIn followers by Jan 1, 2027. Every LinkedIn account you log is added together.',
    'latest', 4000, date '2026-07-12', date '2027-01-01', 40),
  ('linkedin_posts_weekly', 'linkedin.posts_published', 'LinkedIn posts this week',
    'LinkedIn post system: 3-4 posts a week. Judge the week, not the single post. Weeks run Monday to Sunday (UTC).',
    'weekly', 3, date '2026-07-12', null, 50);

create function public.load_analytics_goals()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  this_week date := date_trunc('week', today::timestamp)::date;
  goal record;
  measured jsonb;
  previous_week jsonb;
  goals jsonb := '[]'::jsonb;
begin
  for goal in
    select g.goal_key, g.metric_key, g.label, g.description, g.measure, g.target, g.start_date, g.due_date,
      d.unit, d.entry_mode,
      -- Within the goal's window: a running total only counts days from its start.
      (select max(f.metric_date) from public.analytics_metric_daily f
        where f.metric_key = g.metric_key and f.metric_date <= least(today, coalesce(g.due_date, today))
          and (g.measure <> 'total' or f.metric_date >= g.start_date)) as last_recorded
    from public.analytics_goals g
    join public.analytics_metric_definitions d on d.metric_key = g.metric_key and d.active
    where g.active
    order by g.sort_order, g.goal_key
  loop
    measured := null;
    previous_week := null;
    if goal.start_date > today then
      null; -- Not started: no progress yet.
    elsif goal.measure = 'weekly' then
      measured := public.load_analytics_series(array[goal.metric_key], 'week', this_week, today) #> '{series,0}';
      previous_week := public.load_analytics_series(array[goal.metric_key], 'week', this_week - 7, this_week - 1) #> '{series,0}';
    else
      -- Day grain keeps the range exactly at the start date (no rounding to a month).
      measured := public.load_analytics_series(array[goal.metric_key], 'day', goal.start_date, least(today, goal.due_date)) #> '{series,0}';
    end if;
    goals := goals || jsonb_build_array(jsonb_build_object(
      'goal_key', goal.goal_key,
      'metric_key', goal.metric_key,
      'label', goal.label,
      'description', goal.description,
      'measure', goal.measure,
      'unit', goal.unit,
      'entry_mode', goal.entry_mode,
      'target', goal.target,
      'start_date', goal.start_date,
      'due_date', goal.due_date,
      'current', measured->'current',
      -- The previous window ends the day before the goal began.
      'baseline', case when goal.measure = 'latest' then measured->'previous' end,
      'last_week', previous_week->'current',
      'last_recorded', goal.last_recorded
    ));
  end loop;
  return jsonb_build_object('today', today, 'week_start', this_week, 'goals', goals);
end;
$$;
revoke all on function public.load_analytics_goals() from public, anon, authenticated;
grant execute on function public.load_analytics_goals() to service_role;

commit;
