-- Internal Ajani operations console. These tables are intentionally service-role
-- only: the shared-key admin session is verified by the Next.js server before
-- any read or write, and no browser receives a Supabase credential.

create table public.admin_login_attempts (
  fingerprint text primary key,
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);

create table public.outreach_experiments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  audience text not null check (char_length(audience) between 2 and 120),
  campaign text,
  channel text not null default 'linkedin' check (char_length(channel) between 2 and 40),
  method text not null default 'manual' check (char_length(method) between 2 and 40),
  primary_metric text not null default 'reply_rate' check (primary_metric in ('acceptance_rate', 'reply_rate', 'positive_reply_rate', 'booking_rate')),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'completed')),
  created_by text not null check (char_length(created_by) between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_variants (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.outreach_experiments(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 30),
  title text not null check (char_length(title) between 1 and 120),
  sort_order smallint not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (experiment_id, label)
);

create table public.outreach_batches (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  team_member text not null check (char_length(team_member) between 2 and 100),
  channel text not null check (char_length(channel) between 2 and 40),
  method text not null check (char_length(method) between 2 and 40),
  audience text not null check (char_length(audience) between 2 and 120),
  campaign text,
  experiment_id uuid references public.outreach_experiments(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_batch_metrics (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.outreach_batches(id) on delete cascade,
  variant_id uuid references public.outreach_variants(id) on delete set null,
  variant_label text not null default 'No variant' check (char_length(variant_label) between 1 and 120),
  connection_requests integer not null default 0 check (connection_requests >= 0),
  connections_accepted integer not null default 0 check (connections_accepted >= 0),
  initial_dms integer not null default 0 check (initial_dms >= 0),
  f1_sent integer not null default 0 check (f1_sent >= 0),
  f2_sent integer not null default 0 check (f2_sent >= 0),
  replies integer not null default 0 check (replies >= 0),
  positive_replies integer not null default 0 check (positive_replies >= 0 and positive_replies <= replies),
  calls_booked integer not null default 0 check (calls_booked >= 0 and calls_booked <= replies),
  created_at timestamptz not null default now(),
  unique (batch_id, variant_label)
);

create table public.admin_activity_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index outreach_batches_date_idx on public.outreach_batches (activity_date desc, created_at desc);
create index outreach_batches_context_idx on public.outreach_batches (channel, method, audience, activity_date desc);
create index outreach_batch_metrics_batch_idx on public.outreach_batch_metrics (batch_id);
create index outreach_variants_experiment_idx on public.outreach_variants (experiment_id, sort_order);
create index admin_activity_log_created_idx on public.admin_activity_log (created_at desc);

create trigger outreach_experiments_set_updated_at before update on public.outreach_experiments for each row execute function public.set_updated_at();
create trigger outreach_batches_set_updated_at before update on public.outreach_batches for each row execute function public.set_updated_at();

alter table public.admin_login_attempts enable row level security;
alter table public.outreach_experiments enable row level security;
alter table public.outreach_variants enable row level security;
alter table public.outreach_batches enable row level security;
alter table public.outreach_batch_metrics enable row level security;
alter table public.admin_activity_log enable row level security;

revoke all on table public.admin_login_attempts from public, anon, authenticated;
revoke all on table public.outreach_experiments from public, anon, authenticated;
revoke all on table public.outreach_variants from public, anon, authenticated;
revoke all on table public.outreach_batches from public, anon, authenticated;
revoke all on table public.outreach_batch_metrics from public, anon, authenticated;
revoke all on table public.admin_activity_log from public, anon, authenticated;

create or replace function public.create_outreach_experiment(
  p_title text,
  p_audience text,
  p_campaign text,
  p_channel text,
  p_method text,
  p_primary_metric text,
  p_created_by text,
  p_variants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  experiment_id uuid;
  variant jsonb;
  variant_index integer := 0;
begin
  insert into public.outreach_experiments (title, audience, campaign, channel, method, primary_metric, created_by)
  values (p_title, p_audience, nullif(btrim(p_campaign), ''), p_channel, p_method, p_primary_metric, p_created_by)
  returning id into experiment_id;

  for variant in select value from jsonb_array_elements(p_variants)
  loop
    insert into public.outreach_variants (experiment_id, label, title, sort_order)
    values (experiment_id, variant ->> 'label', variant ->> 'title', variant_index);
    variant_index := variant_index + 1;
  end loop;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (p_created_by, 'created', 'outreach_experiment', experiment_id::text, jsonb_build_object('variant_count', variant_index));
  return experiment_id;
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
  p_metrics jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_id uuid;
  metric jsonb;
begin
  insert into public.outreach_batches (activity_date, team_member, channel, method, audience, campaign, experiment_id, notes)
  values (p_activity_date, p_team_member, p_channel, p_method, p_audience, nullif(btrim(p_campaign), ''), p_experiment_id, nullif(btrim(p_notes), ''))
  returning id into batch_id;

  for metric in select value from jsonb_array_elements(p_metrics)
  loop
    insert into public.outreach_batch_metrics (
      batch_id, variant_id, variant_label, connection_requests, connections_accepted,
      initial_dms, f1_sent, f2_sent, replies, positive_replies, calls_booked
    ) values (
      batch_id,
      nullif(metric ->> 'variantId', '')::uuid,
      metric ->> 'variantLabel',
      coalesce((metric ->> 'connectionRequests')::integer, 0),
      coalesce((metric ->> 'connectionsAccepted')::integer, 0),
      coalesce((metric ->> 'initialDms')::integer, 0),
      coalesce((metric ->> 'f1Sent')::integer, 0),
      coalesce((metric ->> 'f2Sent')::integer, 0),
      coalesce((metric ->> 'replies')::integer, 0),
      coalesce((metric ->> 'positiveReplies')::integer, 0),
      coalesce((metric ->> 'callsBooked')::integer, 0)
    );
  end loop;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (p_team_member, 'created', 'outreach_batch', batch_id::text, jsonb_build_object('activity_date', p_activity_date, 'experiment_id', p_experiment_id));
  return batch_id;
end;
$$;

revoke execute on function public.create_outreach_experiment(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_outreach_experiment(text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb) to service_role;
