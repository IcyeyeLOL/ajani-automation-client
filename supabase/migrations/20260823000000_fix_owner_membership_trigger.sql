-- Service-role provisioning inserts organizations on behalf of a verified Clerk
-- user. Owner membership must therefore use the row's owner, not the service
-- token (which intentionally has no Clerk subject claim).

create or replace function public.create_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (organization_id, user_id) do update set role = excluded.role;
  return new;
end;
$$;

revoke execute on function public.create_owner_membership() from public, anon, authenticated, service_role;

-- Build lifecycle and pricing fields are trusted-server state. Customers submit
-- through submit_request_draft; they cannot insert or promote rows directly.
drop policy if exists "organization members can create build requests" on public.build_requests;
drop policy if exists "build author can update a draft" on public.build_requests;
