-- Dripify connector: daily per-campaign snapshots from Dripify's Open API
-- (https://api.dripify.com/v1/open-api), written by /api/cron/sync-dripify.
--
-- * Dripify returns each campaign's current totals, not history, so every
--   count is a 'last' stock per campaign (dimension 'dripify:<campaign id>'),
--   carried forward and summed across campaigns. The store builds the history
--   from the daily snapshots.
-- * Only exact counts are stored, never Dripify's percentages (rounded to one
--   decimal, so they cannot be added up across campaigns). Rates are
--   recomputed from the counts against leads contacted, the base Dripify's
--   own percentages use: on the live account on 2026-10-16, 120 accepted and
--   30 replied of 694 contacted were reported as 17.3% and 4.3%.
-- * analytics_dimension_labels gives connector accounts a display name (the
--   campaign name) without making the name part of the key, so a renamed
--   campaign keeps one history instead of being counted twice.
begin;

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('dripify.leads_total', 'dripify', 'outreach', 'Dripify leads loaded', 'Leads loaded into launched Dripify campaigns, from the latest daily sync of each campaign.', 'count', 'last', null, null, 'connector', true, true, 34),
  ('dripify.leads_contacted', 'dripify', 'outreach', 'Dripify leads contacted', 'Unique leads that received at least one Dripify outreach step.', 'count', 'last', null, null, 'connector', true, true, 35),
  ('dripify.leads_accepted', 'dripify', 'outreach', 'Dripify connections accepted', 'Leads who accepted a Dripify connection request.', 'count', 'last', null, null, 'connector', true, true, 36),
  ('dripify.leads_replied', 'dripify', 'outreach', 'Dripify leads replied', 'Leads who replied to a Dripify campaign.', 'count', 'last', null, null, 'connector', true, true, 37);

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('dripify.acceptance_rate', 'dripify', 'outreach', 'Dripify acceptance (of contacted)', 'Leads who accepted ÷ leads contacted, over each campaign''s lifetime. Matches Dripify''s own acceptance rate.', 'ratio', 'ratio', 'dripify.leads_accepted', 'dripify.leads_contacted', 'derived', true, true, 38),
  ('dripify.reply_rate', 'dripify', 'outreach', 'Dripify reply rate (of contacted)', 'Leads who replied ÷ leads contacted, over each campaign''s lifetime. Matches Dripify''s own reply rate.', 'ratio', 'ratio', 'dripify.leads_replied', 'dripify.leads_contacted', 'derived', true, true, 39);

create table public.analytics_dimension_labels (
  dimension_key text primary key check (dimension_key ~ '^[a-z0-9@][a-z0-9_.:@/-]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120 and label = btrim(label)),
  recorded_by text not null check (char_length(recorded_by) between 1 and 200),
  updated_at timestamptz not null default now()
);
alter table public.analytics_dimension_labels enable row level security;
revoke all on public.analytics_dimension_labels from public, anon, authenticated, service_role;
grant select on public.analytics_dimension_labels to service_role;

-- Display names only: a label never changes which values a key holds.
create function public.upsert_analytics_dimension_labels(p_labels jsonb, p_actor text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  item_dimension text;
  item_label text;
  written integer := 0;
  changed integer;
begin
  if char_length(btrim(coalesce(p_actor, ''))) not between 1 and 200 then
    raise exception 'An actor is required';
  end if;
  if jsonb_typeof(p_labels) is distinct from 'array' or jsonb_array_length(p_labels) not between 1 and 500 then
    raise exception 'Provide between one and five hundred labels';
  end if;

  -- Sorted so concurrent syncs lock rows in one order.
  for item in select v.value from jsonb_array_elements(p_labels) v
    order by lower(btrim(coalesce(v.value ->> 'dimension', '')))
  loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item -> 'label') is distinct from 'string' then
      raise exception 'Each label must be text';
    end if;
    item_dimension := lower(btrim(coalesce(item ->> 'dimension', '')));
    -- Collapse line breaks, tabs and control characters into single spaces.
    item_label := btrim(left(btrim(regexp_replace(item ->> 'label', '[[:space:][:cntrl:]]+', ' ', 'g')), 120));
    if item_dimension !~ '^[a-z0-9@][a-z0-9_.:@/-]{0,79}$' then
      raise exception 'Account names may use letters, numbers, @ . _ : / and -';
    end if;
    if item_label = '' then
      raise exception 'Labels cannot be empty';
    end if;

    insert into public.analytics_dimension_labels as existing (dimension_key, label, recorded_by)
    values (item_dimension, item_label, btrim(p_actor))
    on conflict (dimension_key) do update
      set label = excluded.label, recorded_by = excluded.recorded_by, updated_at = now()
      where existing.label is distinct from excluded.label;
    get diagnostics changed = row_count;
    written := written + changed;
  end loop;
  return written;
end;
$$;

-- Same catalog, plus display labels. Account lists now keep the 50 most
-- recently recorded accounts per metric (previously the first 50 by name), so
-- new campaigns and handles always stay selectable. One pass over the table
-- feeds coverage dates, account lists and labels.
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
    select distinct public.analytics_dimension_slug(b.channel, 39) || '/' || public.analytics_dimension_slug(b.method, 40) as dimension_key
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

revoke all on function public.upsert_analytics_dimension_labels(jsonb, text) from public, anon, authenticated;
revoke all on function public.load_analytics_catalog() from public, anon, authenticated;
grant execute on function public.upsert_analytics_dimension_labels(jsonb, text) to service_role;
grant execute on function public.load_analytics_catalog() to service_role;

commit;
