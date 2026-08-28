-- Submit the exact intake revision that was analyzed and approved. A final
-- Deepgram transcript is preferred when it owns that fingerprint; otherwise a
-- persisted written brief can be the canonical source. This keeps typed-only
-- requests from reaching a dead end while preventing late audio from replacing
-- an already approved written intake.

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
  written_brief text;
  memo_transcript text;
  intake_text text;
  intake_source text;
  use_voice_memo boolean := false;
begin
  select * into draft_row
  from public.request_drafts
  where id = p_draft_id
  for update;

  if not found
    or draft_row.expires_at <= now()
    or draft_row.claimed_by <> p_user_id
    or draft_row.organization_id <> p_organization_id
    or draft_row.submitted_build_request_id is not null then
    raise exception 'draft_unavailable' using errcode = 'P0001';
  end if;

  select * into workflow_row
  from public.request_draft_ai_states
  where request_draft_id = draft_row.id
  for update;

  if not found
    or draft_row.status <> 'ready_to_submit'
    or workflow_row.state <> 'ready_to_submit'
    or workflow_row.requires_human_review
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
    use_voice_memo := true;
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

  if use_voice_memo then
    update public.voice_memos
    set build_request_id = new_build_request.id,
        request_draft_id = null
    where id = memo_row.id;
  elsif memo_row.id is not null then
    -- A queued or in-flight recording no longer owns this approved request.
    -- The worker checks this status after its provider call and discards late
    -- output instead of overwriting the written intake.
    update public.voice_memo_transcription_jobs
    set status = 'terminal_failed',
        error_code = 'superseded_by_written_brief',
        next_attempt_at = null,
        completed_at = now()
    where voice_memo_id = memo_row.id
      and status in ('queued', 'running', 'retryable_failed');

    update public.voice_memos
    set status = 'failed'
    where id = memo_row.id
      and status <> 'ready';
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
    false
  );

  insert into public.build_events (build_request_id, event_type, payload)
  values (
    new_build_request.id,
    'request_submitted',
    jsonb_build_object(
      'source', 'public_request_flow',
      'intake_source', intake_source,
      'workflow_revision', workflow_row.approved_revision,
      'intake_fingerprint', workflow_row.transcript_fingerprint
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
