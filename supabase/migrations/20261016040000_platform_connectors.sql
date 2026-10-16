-- Platform connectors (YouTube, Instagram), Reddit tracking, and shared plumbing.
--
-- * analytics_connector_runs: one row per sync with a fixed status and reason
--   token, never provider text, so the control desk can say "Instagram's token
--   expired" without storing anything sensitive. Old rows are pruned.
-- * analytics_connector_credentials: rotating tokens (Instagram's refresh every
--   60 days) sealed with AES-256-GCM by the server. The key is only in the
--   server environment, so these rows are useless on their own. No role can
--   read the table directly; two service-role RPCs load and save one row.
-- * Metric definitions for what the platform APIs expose (below).
begin;

create table public.analytics_connector_runs (
  id bigint generated always as identity primary key,
  connector text not null check (connector in ('youtube', 'instagram')),
  status text not null check (status in ('synced', 'partial', 'not_configured', 'rejected')),
  reason text check (reason is null or reason ~ '^[a-z_]{2,40}$'),
  values_written integer not null default 0 check (values_written >= 0),
  ran_at timestamptz not null default now()
);
create index analytics_connector_runs_latest_idx on public.analytics_connector_runs (connector, ran_at desc);
alter table public.analytics_connector_runs enable row level security;
revoke all on public.analytics_connector_runs from public, anon, authenticated, service_role;

create table public.analytics_connector_credentials (
  connector text primary key check (connector in ('youtube', 'instagram')),
  sealed text not null check (sealed ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and char_length(sealed) <= 4000),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.analytics_connector_credentials enable row level security;
revoke all on public.analytics_connector_credentials from public, anon, authenticated, service_role;

create function public.record_analytics_connector_run(p_connector text, p_status text, p_reason text, p_values_written integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.analytics_connector_runs (connector, status, reason, values_written)
  values (p_connector, p_status, nullif(p_reason, ''), greatest(coalesce(p_values_written, 0), 0));
  -- Keep a quarter of history: enough to spot a pattern, never a growing log.
  delete from public.analytics_connector_runs
  where connector = p_connector and ran_at < now() - interval '90 days';
end;
$$;

create function public.load_analytics_connector_credential(p_connector text)
returns table (sealed text, expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.sealed, c.expires_at, c.updated_at from public.analytics_connector_credentials c where c.connector = p_connector;
$$;

create function public.save_analytics_connector_credential(p_connector text, p_sealed text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.analytics_connector_credentials (connector, sealed, expires_at, updated_at)
  values (p_connector, p_sealed, p_expires_at, now())
  on conflict (connector) do update set sealed = excluded.sealed, expires_at = excluded.expires_at, updated_at = now();
end;
$$;

-- Latest run and latest successful sync per connector, for the control desk.
create function public.load_analytics_connector_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.connector, jsonb_build_object(
    'last_run_at', latest.ran_at,
    'last_status', latest.status,
    'last_reason', latest.reason,
    'last_synced_at', (select max(r.ran_at) from public.analytics_connector_runs r where r.connector = c.connector and r.status in ('synced', 'partial'))
  )), '{}'::jsonb)
  from (values ('youtube'), ('instagram')) c(connector)
  join lateral (
    select r.ran_at, r.status, r.reason from public.analytics_connector_runs r
    where r.connector = c.connector order by r.ran_at desc limit 1
  ) latest on true;
$$;

revoke all on function public.record_analytics_connector_run(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.load_analytics_connector_credential(text) from public, anon, authenticated;
revoke all on function public.save_analytics_connector_credential(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.load_analytics_connector_status() from public, anon, authenticated;
grant execute on function public.record_analytics_connector_run(text, text, text, integer) to service_role;
grant execute on function public.load_analytics_connector_credential(text) to service_role;
grant execute on function public.save_analytics_connector_credential(text, text, timestamptz) to service_role;
grant execute on function public.load_analytics_connector_status() to service_role;

-------------------------------------------------------------------------------
-- Metric definitions (provider research 2026-10-16). Connectors write the owner's
-- main account (dimension ''), the same account the manual form logs, so a synced
-- day replaces a typed one instead of adding to it.
-------------------------------------------------------------------------------
update public.analytics_metric_definitions set description = 'Channel subscribers on the recorded day. When synced, YouTube rounds this to three significant figures.'
where metric_key = 'youtube.subscribers';
update public.analytics_metric_definitions set description = 'Accounts reached during the recorded day or period. Added up across days, so an account reached on two days counts twice.'
where metric_key = 'instagram.reach';
update public.analytics_metric_definitions set description = 'Likes, comments, shares, saves and replies during the recorded day or period.'
where metric_key = 'instagram.interactions';
update public.analytics_metric_definitions set description = 'Profile visits during the recorded day or period. Instagram''s API stopped reporting this in 2025, so log it from the app.'
where metric_key = 'instagram.profile_visits';

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('youtube.total_views', 'youtube', 'content', 'YouTube views, all time', 'Channel views since it was created, on the recorded day (synced from YouTube).', 'count', 'last', null, null, 'connector', true, true, 40),
  ('youtube.shorts_views', 'youtube', 'content', 'YouTube Shorts views', 'Views of Shorts during the recorded day or period. Included in YouTube views.', 'count', 'sum', null, null, 'manual', true, true, 46),
  ('youtube.shares', 'youtube', 'content', 'YouTube shares', 'Shares during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 47),
  ('youtube.subscribers_gained', 'youtube', 'content', 'YouTube subscribers gained', 'New subscribers during the recorded day (synced from YouTube Analytics).', 'count', 'sum', null, null, 'connector', true, true, 48),
  ('youtube.subscribers_lost', 'youtube', 'content', 'YouTube subscribers lost', 'Unsubscribes during the recorded day (synced from YouTube Analytics).', 'count', 'sum', null, null, 'connector', false, true, 49),
  ('instagram.likes', 'instagram', 'content', 'Instagram likes', 'Likes during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 64),
  ('instagram.comments', 'instagram', 'content', 'Instagram comments', 'Comments during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 64),
  ('instagram.profile_link_taps', 'instagram', 'content', 'Instagram link taps', 'Taps on the links and contact buttons on your profile during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 68),
  ('reddit.karma', 'reddit', 'content', 'Reddit karma', 'Post and comment karma together, on the recorded day.', 'count', 'last', null, null, 'manual', true, true, 84),
  ('reddit.upvotes', 'reddit', 'content', 'Reddit upvotes', 'Upvotes on your posts during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 86),
  ('reddit.comments', 'reddit', 'content', 'Reddit comments', 'Comments on your posts during the recorded day or period.', 'count', 'sum', null, null, 'manual', true, true, 86),
  ('reddit.dms_sent', 'reddit', 'outreach', 'Reddit DMs sent', 'People messaged on Reddit for outreach. Count each person once, on the day of the first message.', 'count', 'sum', null, null, 'manual', true, true, 39),
  ('reddit.dm_replies', 'reddit', 'outreach', 'Reddit DM replies', 'People who replied to a Reddit outreach message, on the day they replied.', 'count', 'sum', null, null, 'manual', true, true, 39),
  ('reddit.dm_calls_booked', 'reddit', 'outreach', 'Calls booked from Reddit DMs', 'Calls set up from Reddit conversations. Count a call only once Calendly confirms the booking.', 'count', 'sum', null, null, 'manual', true, true, 39);

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('reddit.dm_reply_rate', 'reddit', 'outreach', 'Reddit DM reply rate', 'Replies ÷ DMs sent. Replies come in after the DM, so a short range can read high or low.', 'ratio', 'ratio', 'reddit.dm_replies', 'reddit.dms_sent', 'derived', true, true, 39);

commit;
