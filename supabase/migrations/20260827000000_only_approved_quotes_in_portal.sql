-- Client workspaces must never see a draft or rejected price. Reviewers can
-- prepare quotes privately; the client-facing RLS edge opens only on approval.

drop policy if exists "organization members can read their reviewed quotes"
  on public.build_request_quotes;

create policy "organization members can read their approved quotes"
  on public.build_request_quotes
  for select to authenticated
  using (
    review_status = 'approved'
    and exists (
      select 1
      from public.build_requests request
      where request.id = build_request_id
        and public.is_org_member(request.organization_id)
    )
  );
