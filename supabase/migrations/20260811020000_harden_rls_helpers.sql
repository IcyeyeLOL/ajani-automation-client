-- Harden RLS helper functions. These are evaluated by policies and must not be
-- available as public RPC endpoints or depend on a caller-controlled search path.

create or replace function public.clerk_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() ->> 'sub';
$$;

create or replace function public.clerk_active_organization_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id');
$$;

create or replace function public.create_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, public.clerk_user_id(), 'owner')
  on conflict (organization_id, user_id) do update set role = excluded.role;
  return new;
end;
$$;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    join public.organizations as organization on organization.id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = public.clerk_user_id()
      and organization.archived_at is null
      and organization.clerk_organization_id = public.clerk_active_organization_id()
  );
$$;

create or replace function public.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    join public.organizations as organization on organization.id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = public.clerk_user_id()
      and membership.role = 'owner'
      and organization.archived_at is null
      and organization.clerk_organization_id = public.clerk_active_organization_id()
  );
$$;

create or replace function public.is_build_author(target_build_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.build_requests as request
    join public.organizations as organization on organization.id = request.organization_id
    where request.id = target_build_request_id
      and request.created_by = public.clerk_user_id()
      and organization.archived_at is null
      and organization.clerk_organization_id = public.clerk_active_organization_id()
  );
$$;

revoke execute on function public.create_owner_membership() from public, anon, authenticated, service_role;
revoke execute on function public.is_org_member(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.is_org_owner(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.is_build_author(uuid) from public, anon, authenticated, service_role;
