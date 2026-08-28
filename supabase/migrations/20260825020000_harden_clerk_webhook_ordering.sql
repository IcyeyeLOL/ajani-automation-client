-- Make Clerk delivery idempotent and prevent older provider events from
-- resurrecting identities, organizations, or memberships deleted by newer ones.

alter table public.clerk_webhook_events
  add column if not exists processing_started_at timestamptz;

alter table public.organizations
  add column if not exists clerk_updated_at timestamptz;

alter table public.organization_members
  add column if not exists clerk_updated_at timestamptz,
  add column if not exists deleted_at timestamptz;

create or replace function public.claim_clerk_webhook_event(p_event_id text, p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id text;
begin
  insert into public.clerk_webhook_events (id, event_type, attempts, processing_started_at)
  values (p_event_id, p_event_type, 1, now())
  on conflict (id) do update
  set attempts = public.clerk_webhook_events.attempts + 1,
      processing_started_at = now(),
      last_error = null
  where public.clerk_webhook_events.processed_at is null
    and (
      public.clerk_webhook_events.processing_started_at is null
      or public.clerk_webhook_events.processing_started_at <= now() - interval '10 minutes'
    )
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

create or replace function public.finish_clerk_webhook_event(p_event_id text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clerk_webhook_events
  set processed_at = case when p_error is null then now() else processed_at end,
      processing_started_at = null,
      last_error = left(p_error, 500)
  where id = p_event_id;
$$;

create or replace function public.sync_clerk_profile(
  p_id text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_avatar_url text,
  p_event_at timestamptz,
  p_deleted boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone, avatar_url, clerk_updated_at, deleted_at)
  values (
    p_id,
    case when p_deleted then null else p_full_name end,
    case when p_deleted then null else p_email end,
    case when p_deleted then null else p_phone end,
    case when p_deleted then null else p_avatar_url end,
    p_event_at,
    case when p_deleted then p_event_at else null end
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      avatar_url = excluded.avatar_url,
      clerk_updated_at = excluded.clerk_updated_at,
      deleted_at = excluded.deleted_at
  where coalesce(public.profiles.clerk_updated_at, '-infinity'::timestamptz) <= excluded.clerk_updated_at;
end;
$$;

create or replace function public.sync_clerk_organization(
  p_clerk_organization_id text,
  p_owner_id text,
  p_business_name text,
  p_clerk_slug text,
  p_avatar_url text,
  p_event_at timestamptz,
  p_archived boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid;
begin
  if p_owner_id is not null then
    insert into public.profiles (id) values (p_owner_id) on conflict (id) do nothing;
  end if;

  if p_archived then
    update public.organizations
    set archived_at = p_event_at,
        clerk_updated_at = p_event_at
    where clerk_organization_id = p_clerk_organization_id
      and coalesce(clerk_updated_at, '-infinity'::timestamptz) <= p_event_at
    returning id into organization_id;
    return organization_id;
  end if;

  if p_owner_id is null then
    return null;
  end if;

  insert into public.organizations (
    owner_id, business_name, clerk_organization_id, clerk_slug, avatar_url, clerk_updated_at, archived_at
  ) values (
    p_owner_id, p_business_name, p_clerk_organization_id, p_clerk_slug, p_avatar_url, p_event_at, null
  )
  on conflict (clerk_organization_id) do update
  set owner_id = excluded.owner_id,
      business_name = excluded.business_name,
      clerk_slug = excluded.clerk_slug,
      avatar_url = excluded.avatar_url,
      clerk_updated_at = excluded.clerk_updated_at,
      archived_at = null
  where coalesce(public.organizations.clerk_updated_at, '-infinity'::timestamptz) <= excluded.clerk_updated_at
  returning id into organization_id;

  if organization_id is null then
    select id into organization_id from public.organizations
    where clerk_organization_id = p_clerk_organization_id;
  end if;
  return organization_id;
end;
$$;

create or replace function public.sync_clerk_membership(
  p_organization_id uuid,
  p_user_id text,
  p_role public.organization_role,
  p_clerk_membership_id text,
  p_clerk_role text,
  p_event_at timestamptz,
  p_deleted boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;

  insert into public.organization_members (
    organization_id, user_id, role, clerk_membership_id, clerk_role, clerk_updated_at, deleted_at
  ) values (
    p_organization_id, p_user_id, p_role, p_clerk_membership_id, p_clerk_role, p_event_at,
    case when p_deleted then p_event_at else null end
  )
  on conflict (organization_id, user_id) do update
  set role = excluded.role,
      clerk_membership_id = excluded.clerk_membership_id,
      clerk_role = excluded.clerk_role,
      clerk_updated_at = excluded.clerk_updated_at,
      deleted_at = excluded.deleted_at
  where coalesce(public.organization_members.clerk_updated_at, '-infinity'::timestamptz) <= excluded.clerk_updated_at;
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
      and membership.deleted_at is null
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
      and membership.deleted_at is null
      and organization.archived_at is null
      and organization.clerk_organization_id = public.clerk_active_organization_id()
  );
$$;

revoke execute on function public.claim_clerk_webhook_event(text, text) from public, anon, authenticated;
revoke execute on function public.finish_clerk_webhook_event(text, text) from public, anon, authenticated;
revoke execute on function public.sync_clerk_profile(text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.sync_clerk_organization(text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.sync_clerk_membership(uuid, text, public.organization_role, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.claim_clerk_webhook_event(text, text) to service_role;
grant execute on function public.finish_clerk_webhook_event(text, text) to service_role;
grant execute on function public.sync_clerk_profile(text, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.sync_clerk_organization(text, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.sync_clerk_membership(uuid, text, public.organization_role, text, text, timestamptz, boolean) to service_role;
