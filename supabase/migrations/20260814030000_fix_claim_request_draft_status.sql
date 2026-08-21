create or replace function public.claim_request_draft(
  p_token_hash text,
  p_user_id text,
  p_organization_id uuid
)
returns table (id uuid, status public.request_draft_status, claimed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row public.request_drafts%rowtype;
begin
  select * into draft_row
  from public.request_drafts
  where token_hash = p_token_hash
  for update;

  if not found or draft_row.expires_at <= now() or draft_row.submitted_build_request_id is not null then
    raise exception 'draft_unavailable' using errcode = 'P0001';
  end if;

  if draft_row.claimed_by is not null and (draft_row.claimed_by <> p_user_id or draft_row.organization_id <> p_organization_id) then
    raise exception 'draft_owned_elsewhere' using errcode = 'P0001';
  end if;

  update public.request_drafts
  set claimed_by = p_user_id,
      organization_id = p_organization_id,
      claimed_at = coalesce(draft_row.claimed_at, now()),
      status = case
        when draft_row.status = 'ready_to_submit'::public.request_draft_status
          then 'ready_to_submit'::public.request_draft_status
        else 'claimed'::public.request_draft_status
      end
  where request_drafts.id = draft_row.id
  returning request_drafts.id, request_drafts.status, request_drafts.claimed_at
  into id, status, claimed_at;

  return next;
end;
$$;

revoke execute on function public.claim_request_draft(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_request_draft(text, text, uuid) to service_role;
