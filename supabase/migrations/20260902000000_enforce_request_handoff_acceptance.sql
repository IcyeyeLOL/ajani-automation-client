-- Make the legal handoff acceptance part of the same transaction that creates
-- a build. Route-level checks remain useful UX, but they are not the security
-- boundary: every trusted caller of submit_request_draft must satisfy this
-- database invariant.

create or replace function public.is_current_handoff_acceptance(p_acceptance jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_acceptance) = 'object'
    and p_acceptance @> jsonb_build_object(
      'acknowledged', true,
      'action', 'request_handoff',
      'method', 'affirmative_checkbox',
      'noticeVersion', 'handoff-notice-2026-09-02',
      'acceptableUseVersion', '2026-09-02',
      'privacyVersion', '2026-09-02',
      'termsVersion', '2026-09-02'
    )
    and coalesce(p_acceptance ->> 'acceptedAt', '') ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$',
    false
  );
$$;

revoke execute on function public.is_current_handoff_acceptance(jsonb) from public, anon, authenticated;

-- Capability holders may replace only the legalAcceptance member. jsonb_set
-- avoids the stale read/merge/write race that could otherwise erase voice or
-- workflow metadata written by another request at the same time.
create or replace function public.acknowledge_request_draft(
  p_draft_id uuid,
  p_token_hash text,
  p_acceptance jsonb
)
returns table (draft_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_acceptance jsonb;
begin
  if jsonb_typeof(p_acceptance) is distinct from 'object' then
    raise exception 'handoff_acceptance_invalid' using errcode = 'P0001';
  end if;

  recorded_acceptance := jsonb_set(
    p_acceptance,
    '{acceptedAt}',
    to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  );

  if not public.is_current_handoff_acceptance(recorded_acceptance) then
    raise exception 'handoff_acceptance_invalid' using errcode = 'P0001';
  end if;

  return query
  update public.request_drafts as draft
  set payload = case
    when public.is_current_handoff_acceptance(draft.payload -> 'legalAcceptance') then draft.payload
    else jsonb_set(coalesce(draft.payload, '{}'::jsonb), '{legalAcceptance}', recorded_acceptance, true)
  end
  where draft.id = p_draft_id
    and draft.token_hash = p_token_hash
    and draft.expires_at > now()
    and draft.submitted_build_request_id is null
    and draft.status in ('draft', 'ready_to_submit', 'claimed')
  returning draft.id;
end;
$$;

revoke execute on function public.acknowledge_request_draft(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.acknowledge_request_draft(uuid, text, jsonb) to service_role;

-- Voice finalization also changes one payload member. Keep it narrow so a
-- concurrent acceptance write cannot be lost to a stale object replacement.
create or replace function public.update_request_draft_voice_memo_metadata(
  p_draft_id uuid,
  p_token_hash text,
  p_voice_memo jsonb
)
returns table (draft_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_voice_memo) is distinct from 'object' then
    raise exception 'voice_memo_metadata_invalid' using errcode = 'P0001';
  end if;

  return query
  update public.request_drafts as draft
  set payload = jsonb_set(coalesce(draft.payload, '{}'::jsonb), '{voiceMemo}', p_voice_memo, true)
  where draft.id = p_draft_id
    and draft.token_hash = p_token_hash
    and draft.expires_at > now()
    and draft.submitted_build_request_id is null
    and draft.status in ('draft', 'ready_to_submit', 'claimed')
  returning draft.id;
end;
$$;

revoke execute on function public.update_request_draft_voice_memo_metadata(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.update_request_draft_voice_memo_metadata(uuid, text, jsonb) to service_role;

create or replace function public.submit_request_draft(
  p_draft_id uuid,
  p_user_id text,
  p_organization_id uuid
)
returns table (build_request_id uuid, build_request_status public.build_request_status, build_request_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row public.request_drafts%rowtype;
  workflow_row public.request_draft_ai_states%rowtype;
  memo_row public.voice_memos%rowtype;
  new_build_request public.build_requests%rowtype;
  legal_acceptance jsonb;
  legal_accepted_at timestamptz;
  written_brief text;
  memo_transcript text;
  intake_text text;
  intake_source text;
begin
  select * into draft_row
  from public.request_drafts
  where id = p_draft_id
  for update;

  if not found
    or draft_row.expires_at <= now()
    or draft_row.claimed_at is null
    or draft_row.claimed_by is distinct from p_user_id
    or draft_row.organization_id is distinct from p_organization_id
    or draft_row.submitted_build_request_id is not null then
    raise exception 'draft_unavailable' using errcode = 'P0001';
  end if;

  legal_acceptance := draft_row.payload -> 'legalAcceptance';
  if not public.is_current_handoff_acceptance(legal_acceptance) then
    raise exception 'handoff_acceptance_required' using errcode = 'P0001';
  end if;
  begin
    legal_accepted_at := (legal_acceptance ->> 'acceptedAt')::timestamptz;
  exception when others then
    raise exception 'handoff_acceptance_required' using errcode = 'P0001';
  end;
  if legal_accepted_at < draft_row.created_at - interval '5 minutes'
    or legal_accepted_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'handoff_acceptance_required' using errcode = 'P0001';
  end if;

  select * into workflow_row
  from public.request_draft_ai_states
  where request_draft_id = draft_row.id
  for update;

  if not found
    or draft_row.status <> 'ready_to_submit'
    or workflow_row.state <> 'ready_to_submit'
    or workflow_row.approved_revision is null
    or workflow_row.approved_hash is null
    or workflow_row.transcript_fingerprint is null
    or jsonb_array_length(workflow_row.approved_system_definition) = 0 then
    raise exception 'draft_not_ready_to_submit' using errcode = 'P0001';
  end if;

  select * into memo_row
  from public.voice_memos
  where request_draft_id = draft_row.id
  for update;

  written_brief := nullif(regexp_replace(
    draft_row.payload #>> '{extractedContext,writtenBrief}',
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  ), '');
  memo_transcript := nullif(regexp_replace(
    memo_row.transcript,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  ), '');

  if memo_row.id is not null
    and memo_row.status = 'ready'
    and memo_transcript is not null
    and encode(extensions.digest(memo_transcript, 'sha256'), 'hex') = workflow_row.transcript_fingerprint then
    intake_text := memo_transcript;
    intake_source := 'deepgram_verified_voice';
  elsif written_brief is not null
    and encode(extensions.digest(written_brief, 'sha256'), 'hex') = workflow_row.transcript_fingerprint then
    intake_text := written_brief;
    intake_source := 'saved_written_brief';
  else
    raise exception 'approved_intake_revision_missing' using errcode = 'P0001';
  end if;

  insert into public.build_requests (
    request_draft_id,
    organization_id,
    created_by,
    title,
    status,
    transcript,
    extracted_context,
    system_definition,
    plain_language_scope,
    quoted_amount_cents
  ) values (
    draft_row.id,
    p_organization_id,
    p_user_id,
    coalesce(nullif(btrim(draft_row.payload ->> 'title'), ''), 'New automation request'),
    'in_review',
    intake_text,
    workflow_row.latest_extraction,
    workflow_row.approved_system_definition,
    workflow_row.approved_plain_language_scope,
    null
  ) returning * into new_build_request;

  -- Always retain the original source recording with the submitted build. If
  -- transcription is still queued, the existing worker may complete it as a
  -- supplementary artifact instead of the submit path cancelling it.
  if memo_row.id is not null then
    update public.voice_memos
    set build_request_id = new_build_request.id,
        request_draft_id = null
    where id = memo_row.id;
  end if;

  insert into public.build_request_ai_states (
    build_request_id,
    state,
    transcript_fingerprint,
    transcript_revision,
    clarification_round,
    reflection_round,
    latest_extraction,
    latest_scope,
    confidence,
    requires_human_review
  ) values (
    new_build_request.id,
    'ready_for_human_review',
    workflow_row.transcript_fingerprint,
    workflow_row.transcript_revision,
    workflow_row.clarification_round,
    workflow_row.reflection_round,
    workflow_row.latest_extraction,
    workflow_row.latest_scope,
    workflow_row.confidence,
    workflow_row.requires_human_review
  );

  insert into public.build_events (build_request_id, event_type, payload)
  values (
    new_build_request.id,
    'request_submitted',
    jsonb_build_object(
      'source', 'public_request_flow',
      'request_draft_id', draft_row.id,
      'submitted_by_user_id', p_user_id,
      'submitted_for_organization_id', p_organization_id,
      'legal_acceptance', legal_acceptance,
      'intake_source', intake_source,
      'workflow_revision', workflow_row.approved_revision,
      'approved_hash', workflow_row.approved_hash,
      'intake_fingerprint', workflow_row.transcript_fingerprint,
      'requires_human_review', workflow_row.requires_human_review,
      'voice_memo_attached', memo_row.id is not null
    )
  );

  update public.request_drafts
  set status = 'submitted',
      submitted_build_request_id = new_build_request.id
  where id = draft_row.id;

  build_request_id := new_build_request.id;
  build_request_status := new_build_request.status;
  build_request_created_at := new_build_request.created_at;
  return next;
end;
$$;

revoke execute on function public.submit_request_draft(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_request_draft(uuid, text, uuid) to service_role;

-- All current draft mutations travel through capability-protected server
-- routes or narrow security-definer functions. Remove the earlier broad
-- browser update path so a claimed user cannot rewrite acceptance JSON.
drop policy if exists "users can update their claimed draft" on public.request_drafts;
revoke insert, update, delete on table public.request_drafts from public, anon, authenticated;

-- Be explicit that browser roles may read authorized lifecycle records but may
-- not rewrite or erase submission evidence.
revoke update, delete on table public.build_events from public, anon, authenticated;
