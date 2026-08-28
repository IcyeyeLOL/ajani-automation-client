-- Public request drafts are capability-protected at the application boundary.
-- Only a SHA-256 hash of the random draft capability is retained in Postgres.

create type public.request_draft_status as enum ('draft', 'ready_to_submit', 'claimed', 'submitted', 'expired');

create table public.request_drafts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  status public.request_draft_status not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  claimed_by text references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  claimed_at timestamptz,
  submitted_build_request_id uuid references public.build_requests(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_drafts_claim_consistency check (
    (claimed_by is null and organization_id is null and claimed_at is null)
    or (claimed_by is not null and organization_id is not null and claimed_at is not null)
  )
);

create index request_drafts_claimed_by_idx on public.request_drafts (claimed_by, organization_id, updated_at desc);
create index request_drafts_expiry_idx on public.request_drafts (expires_at) where status <> 'submitted';

create table public.clerk_webhook_events (
  id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create trigger request_drafts_set_updated_at before update on public.request_drafts for each row execute function public.set_updated_at();

alter table public.request_drafts enable row level security;
alter table public.clerk_webhook_events enable row level security;

create policy "users can read their claimed drafts" on public.request_drafts
  for select to authenticated
  using (claimed_by = public.clerk_user_id() and public.is_org_member(organization_id));

create policy "users can update their claimed draft" on public.request_drafts
  for update to authenticated
  using (claimed_by = public.clerk_user_id() and public.is_org_member(organization_id) and status in ('claimed', 'ready_to_submit'))
  with check (claimed_by = public.clerk_user_id() and public.is_org_member(organization_id));

create policy "build authors can create request events" on public.build_events
  for insert to authenticated
  with check (public.is_build_author(build_request_id));

-- A Clerk user may belong to several organizations. RLS therefore requires both
-- the Clerk subject and the active Clerk organization claim, not just membership.
create or replace function public.is_build_author(target_build_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.build_requests request
    join public.organizations organization on organization.id = request.organization_id
    where request.id = target_build_request_id
      and request.created_by = public.clerk_user_id()
      and organization.clerk_organization_id = public.clerk_active_organization_id()
      and public.is_org_member(organization.id)
  );
$$;
