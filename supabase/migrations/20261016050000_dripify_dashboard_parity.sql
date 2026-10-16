-- Dripify dashboard parity (2026-10-16).
--
-- Dripify's own dashboard shows what happened in a period (leads contacted,
-- invites accepted, replies) beside lifetime rates, how many leads each
-- campaign has left, lead statuses, and unread inbox messages. All of it comes
-- from the official Open API as counts: no lead names, profiles or messages
-- are read into the store.
--
-- * New-activity metrics are the change in each campaign's running totals
--   since its previous sync, recorded on the sync day. A campaign's first sync
--   has no earlier total, so its first day stays unknown.
-- * load_analytics_latest_values gives trusted server code the latest value per
--   account for a few metrics (with the account's display name), for those
--   differences and for the control desk's "running low" warnings.
begin;

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('dripify.new_contacted', 'dripify', 'outreach', 'Dripify leads contacted (new)', 'Leads Dripify contacted for the first time since the previous sync, recorded on the sync day.', 'count', 'sum', null, null, 'connector', true, true, 40),
  ('dripify.new_accepted', 'dripify', 'outreach', 'Dripify connections accepted (new)', 'Leads who accepted a Dripify connection request since the previous sync, recorded on the sync day.', 'count', 'sum', null, null, 'connector', true, true, 40),
  ('dripify.new_replies', 'dripify', 'outreach', 'Dripify replies (new)', 'Leads who replied to a Dripify campaign for the first time since the previous sync, recorded on the sync day.', 'count', 'sum', null, null, 'connector', true, true, 40),
  ('dripify.leads_remaining', 'dripify', 'outreach', 'Dripify leads not yet contacted', 'Leads loaded into a campaign that Dripify has not contacted yet. When this runs low, add leads or the campaign stops sending.', 'count', 'last', null, null, 'connector', true, true, 41),
  ('dripify.leads_in_progress', 'dripify', 'outreach', 'Dripify leads in a sequence', 'Leads moving through a campaign''s steps right now (Dripify''s "In progress").', 'count', 'last', null, null, 'connector', true, true, 41),
  ('dripify.leads_finished', 'dripify', 'outreach', 'Dripify leads finished', 'Leads that went through every step of a campaign (Dripify''s "Finished").', 'count', 'last', null, null, 'connector', true, true, 41),
  ('dripify.leads_failed', 'dripify', 'outreach', 'Dripify leads failed', 'Leads Dripify could not process, for example when LinkedIn refused an action (Dripify''s "Failed").', 'count', 'last', null, null, 'connector', false, true, 41),
  ('dripify.unread_messages', 'dripify', 'outreach', 'Unread Dripify messages', 'Conversations in the Dripify inbox with replies nobody has read yet, on the recorded day.', 'count', 'last', null, null, 'connector', false, true, 42),
  ('dripify.active_campaigns', 'dripify', 'outreach', 'Active Dripify campaigns', 'Campaigns sending right now, on the recorded day.', 'count', 'last', null, null, 'connector', true, true, 42);

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('dripify.period_acceptance_rate', 'dripify', 'outreach', 'Dripify acceptance (this period)', 'New connections accepted ÷ new leads contacted in the chosen range. Acceptances arrive days after invites, so a short range can read high or low; compare with the lifetime rate.', 'ratio', 'ratio', 'dripify.new_accepted', 'dripify.new_contacted', 'derived', true, true, 40),
  ('dripify.period_reply_rate', 'dripify', 'outreach', 'Dripify reply rate (this period)', 'New replies ÷ new leads contacted in the chosen range. Replies arrive after the outreach, so a short range can read high or low; compare with the lifetime rate.', 'ratio', 'ratio', 'dripify.new_replies', 'dripify.new_contacted', 'derived', true, true, 40);

create function public.load_analytics_latest_values(p_keys text[], p_before date)
returns table (metric_key text, dimension_key text, metric_date date, value numeric, label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_keys is null or cardinality(p_keys) not between 1 and 20 or p_before is null then
    raise exception 'Provide between one and twenty metric keys and a date';
  end if;
  return query
  select distinct on (d.metric_key, d.dimension_key) d.metric_key, d.dimension_key, d.metric_date, d.value::numeric, l.label
  from public.analytics_metric_daily d
  left join public.analytics_dimension_labels l on l.dimension_key = d.dimension_key
  where d.metric_key = any(p_keys) and d.metric_date < p_before
  order by d.metric_key, d.dimension_key, d.metric_date desc;
end;
$$;

revoke all on function public.load_analytics_latest_values(text[], date) from public, anon, authenticated;
grant execute on function public.load_analytics_latest_values(text[], date) to service_role;

commit;
