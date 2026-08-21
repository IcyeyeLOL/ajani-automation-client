-- Clerk remains the source of identity. These columns make the Clerk-to-
-- Supabase relationship explicit and let webhook writes be safely idempotent.

alter table public.profiles
  add column if not exists email text,
  add column if not exists clerk_updated_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.organizations
  add column if not exists clerk_organization_id text,
  add column if not exists clerk_slug text,
  add column if not exists avatar_url text,
  add column if not exists archived_at timestamptz;

alter table public.organization_members
  add column if not exists clerk_membership_id text,
  add column if not exists clerk_role text;

create unique index if not exists organizations_clerk_organization_id_key
  on public.organizations (clerk_organization_id);

create unique index if not exists organization_members_clerk_membership_id_key
  on public.organization_members (clerk_membership_id);

create or replace function public.clerk_active_organization_id()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id');
$$;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members membership
    join public.organizations organization on organization.id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = public.clerk_user_id()
      and organization.archived_at is null
      and organization.clerk_organization_id = public.clerk_active_organization_id()
  );
$$;
