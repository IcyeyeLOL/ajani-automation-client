-- Synthetic, transactional fixtures for growth goals and the 2026-10-16
-- metric definition review. Root harness runs only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  this_week date := date_trunc('week', today::timestamp)::date;
  payload jsonb; item jsonb; catalog jsonb; failed boolean;
begin
  ---------------------------------------------------------------------------
  -- The owner's Growth Goal Sheet is seeded exactly.
  ---------------------------------------------------------------------------
  if (select count(*) from public.analytics_goals where active) <> 5
    or not exists (select 1 from public.analytics_goals where goal_key = 'clients_signed' and metric_key = 'sales.deals_won' and measure = 'total' and target = 5 and start_date = date '2026-07-12' and due_date = date '2027-01-01')
    or not exists (select 1 from public.analytics_goals where goal_key = 'revenue_collected' and metric_key = 'revenue.cash_collected' and measure = 'total' and target = 500000)
    or not exists (select 1 from public.analytics_goals where goal_key = 'monthly_recurring_revenue' and metric_key = 'revenue.mrr' and measure = 'latest' and target = 200000)
    or not exists (select 1 from public.analytics_goals where goal_key = 'linkedin_followers' and metric_key = 'linkedin.followers' and measure = 'latest' and target = 4000)
    or not exists (select 1 from public.analytics_goals where goal_key = 'linkedin_posts_weekly' and metric_key = 'linkedin.posts_published' and measure = 'weekly' and target = 3 and due_date is null) then
    raise exception 'growth goals must match the Growth Goal Sheet';
  end if;

  -- A goal must measure its metric the way the metric adds up.
  begin
    insert into public.analytics_goals (goal_key, metric_key, label, description, measure, target, start_date, due_date)
    values ('audit_wrong', 'sales.deals_won', 'Wrong', 'Wrong measure', 'latest', 1, today - 1, today + 10);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'a latest-value goal on a summed metric must be rejected'; end if;
  begin
    insert into public.analytics_goals (goal_key, metric_key, label, description, measure, target, start_date, due_date)
    values ('audit_open', 'sales.deals_won', 'Open', 'No deadline', 'total', 1, today - 1, null);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'only weekly goals may omit a deadline'; end if;
  begin
    insert into public.analytics_goals (goal_key, metric_key, label, description, measure, target, start_date, due_date)
    values ('audit_ancient', 'sales.deals_won', 'Ancient', 'Too early', 'total', 1, date '1999-12-31', date '2000-06-01');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'a start date the series function rejects must be refused up front'; end if;
  -- ...and from the metric's side: a measured metric keeps its aggregation.
  begin
    update public.analytics_metric_definitions set aggregation = 'sum' where metric_key = 'revenue.mrr';
    failed := false;
  exception when others then failed := sqlerrm like '%measured by a goal%';
  end;
  if not failed then raise exception 'changing the aggregation of a metric a goal measures must be rejected'; end if;

  ---------------------------------------------------------------------------
  -- Measurement, with relative dates so the fixture never ages out.
  ---------------------------------------------------------------------------
  update public.analytics_goals set active = false;
  insert into public.analytics_goals (goal_key, metric_key, label, description, measure, target, start_date, due_date, sort_order) values
    ('audit_total', 'sales.deals_won', 'Total', 'Running total', 'total', 5, today - 10, today + 100, 1),
    ('audit_latest', 'linkedin.followers', 'Latest', 'Latest value', 'latest', 4000, today - 10, today + 100, 2),
    ('audit_weekly', 'linkedin.posts_published', 'Weekly', 'Per week', 'weekly', 3, today - 30, null, 3),
    ('audit_unknown', 'revenue.cash_collected', 'Unknown', 'Nothing recorded', 'total', 500000, today - 10, today + 100, 4),
    ('audit_future', 'revenue.mrr', 'Future', 'Not started', 'latest', 200000, today + 5, today + 100, 5),
    ('audit_retired', 'x.followers', 'Retired', 'Inactive metric', 'latest', 10, today - 10, today + 100, 6),
    ('audit_weekly_future', 'linkedin.posts_published', 'Weekly later', 'Starts soon', 'weekly', 3, today + 3, null, 7);

  perform public.upsert_analytics_metric_values(jsonb_build_array(
    -- One deal the day before the goal began must not count.
    jsonb_build_object('metricKey', 'sales.deals_won', 'date', today - 11, 'value', 1),
    jsonb_build_object('metricKey', 'sales.deals_won', 'date', today - 10, 'value', 2),
    jsonb_build_object('metricKey', 'sales.deals_won', 'date', today, 'value', 1),
    -- Followers before the goal are its baseline; two accounts add together.
    jsonb_build_object('metricKey', 'linkedin.followers', 'date', today - 20, 'value', 100),
    jsonb_build_object('metricKey', 'linkedin.followers', 'date', today - 5, 'value', 150),
    jsonb_build_object('metricKey', 'linkedin.followers', 'date', today - 3, 'dimension', '@company', 'value', 50),
    -- Two posts this week, two last week, one the week before.
    jsonb_build_object('metricKey', 'linkedin.posts_published', 'date', today, 'value', 2),
    jsonb_build_object('metricKey', 'linkedin.posts_published', 'date', this_week - 7, 'value', 1),
    jsonb_build_object('metricKey', 'linkedin.posts_published', 'date', this_week - 1, 'value', 1),
    jsonb_build_object('metricKey', 'linkedin.posts_published', 'date', this_week - 8, 'value', 1),
    -- Cash from before a running total began is neither progress nor its "last logged" day.
    jsonb_build_object('metricKey', 'revenue.cash_collected', 'date', today - 11, 'value', 90000)
  ), 'manual', 'audit_goals');

  payload := public.load_analytics_goals();
  if (payload->>'today')::date <> today or (payload->>'week_start')::date <> this_week then
    raise exception 'goal payload must state its UTC day and week: %', payload;
  end if;
  if jsonb_array_length(payload->'goals') <> 6 or exists (
    select 1 from jsonb_array_elements(payload->'goals') g where g->>'goal_key' in ('audit_retired', 'clients_signed')
  ) then
    raise exception 'inactive goals and goals on retired metrics must be left out: %', payload->'goals';
  end if;

  select value into item from jsonb_array_elements(payload->'goals') where value->>'goal_key' = 'audit_total';
  if (item->>'current')::numeric <> 3 or item->'baseline' <> 'null'::jsonb or (item->>'last_recorded')::date <> today
    or item->>'unit' <> 'count' or item->>'entry_mode' <> 'manual' then
    raise exception 'a running total must count from the start date only: %', item;
  end if;

  select value into item from jsonb_array_elements(payload->'goals') where value->>'goal_key' = 'audit_latest';
  if (item->>'current')::numeric <> 200 or (item->>'baseline')::numeric <> 100 then
    raise exception 'a latest-value goal must sum accounts and report the value before it began: %', item;
  end if;

  select value into item from jsonb_array_elements(payload->'goals') where value->>'goal_key' = 'audit_weekly';
  if (item->>'current')::numeric <> 2 or (item->>'last_week')::numeric <> 2 then
    raise exception 'a weekly goal must count this week and report last week: %', item;
  end if;

  select value into item from jsonb_array_elements(payload->'goals') where value->>'goal_key' = 'audit_unknown';
  if item->'current' <> 'null'::jsonb or item->'last_recorded' <> 'null'::jsonb then
    raise exception 'nothing recorded must stay unknown, never zero: %', item;
  end if;

  select value into item from jsonb_array_elements(payload->'goals') where value->>'goal_key' = 'audit_future';
  if item->'current' <> 'null'::jsonb then
    raise exception 'a goal that has not started has no progress yet: %', item;
  end if;
  select value into item from jsonb_array_elements(payload->'goals') where value->>'goal_key' = 'audit_weekly_future';
  if item->'current' <> 'null'::jsonb or item->'last_week' <> 'null'::jsonb then
    raise exception 'a weekly goal that has not started has no progress yet: %', item;
  end if;

  -- Retiring a goal is a plain update; only metric and measure changes are re-checked.
  update public.analytics_goals set active = false where goal_key = 'audit_future';

  -- A goal agrees with a daily Trends chart of the same metric and range
  -- (week and month charts round the start back to the period start).
  if (public.load_analytics_series(array['sales.deals_won'], 'day', today - 10, today) #>> '{series,0,current}')::numeric <> 3 then
    raise exception 'goal and trend totals must agree';
  end if;

  ---------------------------------------------------------------------------
  -- Definition review: X retired, new numbers recordable, labels corrected.
  ---------------------------------------------------------------------------
  catalog := public.load_analytics_catalog();
  if exists (select 1 from jsonb_array_elements(catalog->'metrics') m where m->>'source' = 'x') then
    raise exception 'retired X metrics must leave the catalog';
  end if;
  if (select count(*) from jsonb_array_elements(catalog->'metrics') m
      where m->>'metric_key' in ('instagram.saves', 'instagram.shares', 'linkedin.reactions', 'linkedin.comments', 'reddit.views', 'reddit.posts_published', 'sales.content_leads')
        and m->>'entry_mode' = 'manual') <> 7 then
    raise exception 'the numbers the owner relies on must be recordable';
  end if;
  if not exists (select 1 from jsonb_array_elements(catalog->'metrics') m where m->>'metric_key' = 'sales.deals_won' and m->>'label' = 'Clients signed')
    or not exists (select 1 from jsonb_array_elements(catalog->'metrics') m where m->>'metric_key' = 'dripify.reply_rate' and m->>'label' like '%(lifetime)') then
    raise exception 'labels must say what is counted';
  end if;
  begin
    perform public.load_analytics_series(array['x.followers'], 'day', today - 1, today);
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'retired metrics must not be charted'; end if;

  ---------------------------------------------------------------------------
  -- Goals are internal: trusted server code reads them through the RPC.
  ---------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.load_analytics_goals()', 'execute')
    or has_function_privilege('authenticated', 'public.load_analytics_goals()', 'execute')
    or has_table_privilege('authenticated', 'public.analytics_goals', 'select')
    or has_table_privilege('service_role', 'public.analytics_goals', 'insert') then
    raise exception 'goals must remain internal';
  end if;
  if not has_function_privilege('service_role', 'public.load_analytics_goals()', 'execute') then
    raise exception 'trusted server code must read goals';
  end if;

  raise notice 'goal regressions passed: seed, measure checks, totals from start, baselines, weeks, unknowns, retired metrics, permissions';
end;
$$;
rollback;
