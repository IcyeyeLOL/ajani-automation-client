-- Ajani portal foundation: accounts, build requests, active systems, and billing.
-- Client data is scoped through an organization even when an account has one owner.

create extension if not exists pgcrypto;

create type public.organization_role as enum ('owner', 'member');
create type public.contact_preference as enum ('sms', 'email');
create type public.build_request_status as enum ('draft', 'clarifying', 'quoted', 'paid', 'in_review', 'in_progress', 'live', 'needs_attention', 'cancelled');
create type public.voice_memo_status as enum ('pending_upload', 'uploaded', 'transcribing', 'ready', 'failed');
create type public.automation_health as enum ('healthy', 'warning', 'error', 'paused');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'paused', 'cancelled');

create table public.profiles (
  id text primary key,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.profiles(id) on delete restrict,
  business_name text not null,
  industry text,
  budget_tier text,
  preferred_contact_method public.contact_preference not null default 'email',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.build_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by text not null references public.profiles(id) on delete restrict,
  title text not null,
  status public.build_request_status not null default 'draft',
  transcript text,
  extracted_context jsonb not null default '{}'::jsonb,
  system_definition jsonb not null default '[]'::jsonb,
  plain_language_scope text,
  quoted_amount_cents integer check (quoted_amount_cents is null or quoted_amount_cents > 0),
  currency text not null default 'usd',
  stripe_checkout_session_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.voice_memos (
  id uuid primary key default gen_random_uuid(),
  build_request_id uuid not null references public.build_requests(id) on delete cascade,
  storage_path text not null unique,
  status public.voice_memo_status not null default 'pending_upload',
  provider text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  transcript text,
  transcript_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.gap_questions (
  id uuid primary key default gen_random_uuid(),
  build_request_id uuid not null references public.build_requests(id) on delete cascade,
  question text not null,
  reason text not null,
  answer text,
  delivery_channel public.contact_preference,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.automation_systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  build_request_id uuid unique references public.build_requests(id) on delete set null,
  name text not null,
  status public.build_request_status not null default 'in_review',
  health public.automation_health not null default 'paused',
  definition jsonb not null default '[]'::jsonb,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_system_id uuid not null references public.automation_systems(id) on delete cascade,
  status public.automation_health not null,
  source_event text,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_subscription_id text not null unique,
  status public.subscription_status not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  interval text not null default 'month',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_invoice_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null,
  hosted_invoice_url text,
  issued_at timestamptz not null default now()
);

create table public.build_events (
  id uuid primary key default gen_random_uuid(),
  build_request_id uuid not null references public.build_requests(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index build_requests_organization_status_idx on public.build_requests (organization_id, status, created_at desc);
create index voice_memos_build_request_idx on public.voice_memos (build_request_id, created_at desc);
create index gap_questions_build_request_idx on public.gap_questions (build_request_id, created_at desc);
create index automation_systems_organization_idx on public.automation_systems (organization_id, status);
create index automation_runs_system_started_idx on public.automation_runs (automation_system_id, started_at desc);
create index invoices_organization_issued_idx on public.invoices (organization_id, issued_at desc);
create index build_events_request_created_idx on public.build_events (build_request_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger build_requests_set_updated_at before update on public.build_requests for each row execute function public.set_updated_at();
create trigger voice_memos_set_updated_at before update on public.voice_memos for each row execute function public.set_updated_at();
create trigger automation_systems_set_updated_at before update on public.automation_systems for each row execute function public.set_updated_at();
create trigger billing_subscriptions_set_updated_at before update on public.billing_subscriptions for each row execute function public.set_updated_at();

create or replace function public.clerk_user_id()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'sub';
$$;

create or replace function public.create_owner_membership()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_owner_membership after insert on public.organizations for each row execute function public.create_owner_membership();

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and user_id = public.clerk_user_id()
  );
$$;

create or replace function public.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations
    where id = target_organization_id and owner_id = public.clerk_user_id()
  );
$$;

create or replace function public.is_build_author(target_build_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.build_requests
    where id = target_build_request_id and created_by = public.clerk_user_id()
  );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.build_requests enable row level security;
alter table public.voice_memos enable row level security;
alter table public.gap_questions enable row level security;
alter table public.automation_systems enable row level security;
alter table public.automation_runs enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.build_events enable row level security;

create policy "profile owner can read" on public.profiles for select to authenticated using (id = public.clerk_user_id());
create policy "profile owner can create" on public.profiles for insert to authenticated with check (id = public.clerk_user_id());
create policy "profile owner can update" on public.profiles for update to authenticated using (id = public.clerk_user_id()) with check (id = public.clerk_user_id());

create policy "organization members can read" on public.organizations for select to authenticated using (public.is_org_member(id));
create policy "authenticated users can create an organization" on public.organizations for insert to authenticated with check (owner_id = public.clerk_user_id());
create policy "organization owner can update" on public.organizations for update to authenticated using (owner_id = public.clerk_user_id()) with check (owner_id = public.clerk_user_id());

create policy "organization members can read members" on public.organization_members for select to authenticated using (public.is_org_member(organization_id));
create policy "organization owners can add members" on public.organization_members for insert to authenticated with check (public.is_org_owner(organization_id));
create policy "organization owners can remove members" on public.organization_members for delete to authenticated using (public.is_org_owner(organization_id));

create policy "organization members can read build requests" on public.build_requests for select to authenticated using (public.is_org_member(organization_id));
create policy "organization members can create build requests" on public.build_requests for insert to authenticated with check (public.is_org_member(organization_id) and created_by = public.clerk_user_id());
create policy "build author can update a draft" on public.build_requests for update to authenticated using (created_by = public.clerk_user_id() and status in ('draft', 'clarifying', 'quoted')) with check (created_by = public.clerk_user_id());

create policy "organization members can read voice memos" on public.voice_memos for select to authenticated using (exists (select 1 from public.build_requests where id = build_request_id and public.is_org_member(organization_id)));
create policy "organization members can read gap questions" on public.gap_questions for select to authenticated using (exists (select 1 from public.build_requests where id = build_request_id and public.is_org_member(organization_id)));
create policy "build author can answer gap questions" on public.gap_questions for update to authenticated using (public.is_build_author(build_request_id)) with check (public.is_build_author(build_request_id));

create policy "organization members can read systems" on public.automation_systems for select to authenticated using (public.is_org_member(organization_id));
create policy "organization members can read runs" on public.automation_runs for select to authenticated using (exists (select 1 from public.automation_systems where id = automation_system_id and public.is_org_member(organization_id)));
create policy "organization members can read subscriptions" on public.billing_subscriptions for select to authenticated using (public.is_org_member(organization_id));
create policy "organization members can read invoices" on public.invoices for select to authenticated using (public.is_org_member(organization_id));
create policy "organization members can read build events" on public.build_events for select to authenticated using (exists (select 1 from public.build_requests where id = build_request_id and public.is_org_member(organization_id)));

-- Raw audio stays private. The Next.js server creates signed uploads and signed reads
-- with the service role; browser users never receive broad Storage object access.
insert into storage.buckets (id, name, public) values ('voice-memos', 'voice-memos', false)
on conflict (id) do nothing;
