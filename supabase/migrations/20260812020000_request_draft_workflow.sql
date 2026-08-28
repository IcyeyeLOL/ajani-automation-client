-- Durable, capability-protected intake workflow for the public O1-O5 path.
-- The pre-authenticated draft owns AI state until one atomic promotion creates
-- the tenant-scoped build request. Provider prompts and raw provider errors are
-- intentionally never stored here.

create table public.request_draft_ai_states (
  request_draft_id uuid primary key references public.request_drafts(id) on delete cascade,
  state text not null default 'awaiting_verified_transcript' check (state in (
    'awaiting_verified_transcript', 'extraction_queued', 'extracting', 'clarification_queued',
    'awaiting_clarification', 'reflection_queued', 'awaiting_customer_confirmation',
    'ready_to_submit', 'human_review_required', 'failed_retryable', 'failed_terminal'
  )),
  transcript_fingerprint text,
  transcript_revision integer not null default 0 check (transcript_revision >= 0),
  clarification_round smallint not null default 0 check (clarification_round between 0 and 2),
  reflection_round smallint not null default 0 check (reflection_round between 0 and 2),
  active_gap_question_id uuid,
  latest_extraction jsonb not null default '{}'::jsonb,
  latest_scope jsonb not null default '{}'::jsonb,
  approved_system_definition jsonb not null default '[]'::jsonb,
  approved_plain_language_scope text,
  approved_revision integer check (approved_revision is null or approved_revision > 0),
  approved_hash text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  requires_human_review boolean not null default false,
  last_error_code text,
  last_error_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_draft_ai_approval_consistency check (
    (approved_revision is null and approved_hash is null and approved_plain_language_scope is null)
    or (approved_revision is not null and approved_hash is not null and approved_plain_language_scope is not null)
  )
);

create table public.request_draft_ai_runs (
  id uuid primary key default gen_random_uuid(),
  request_draft_id uuid not null references public.request_drafts(id) on delete cascade,
  task text not null check (task in ('extraction', 'gap_question', 'scope_reflection')),
  input_fingerprint text not null,
  idempotency_key text not null unique,
  provider text not null default 'anthropic',
  model text not null,
  prompt_version text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'retryable_failed', 'terminal_failed', 'skipped')),
  attempt smallint not null default 0 check (attempt between 0 and 2),
  max_attempts smallint not null default 2 check (max_attempts between 1 and 2),
  provider_request_id text,
  route_reasons jsonb not null default '[]'::jsonb,
  token_usage jsonb not null default '{}'::jsonb,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  result jsonb not null default '{}'::jsonb,
  redaction_count integer not null default 0 check (redaction_count >= 0),
  error_code text,
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_draft_id, task, input_fingerprint, prompt_version)
);

create table public.request_draft_gap_questions (
  id uuid primary key default gen_random_uuid(),
  request_draft_id uuid not null references public.request_drafts(id) on delete cascade,
  ai_run_id uuid references public.request_draft_ai_runs(id) on delete set null,
  question text not null,
  reason text not null,
  answer text,
  answered_at timestamptz,
  source text not null default 'ai' check (source in ('ai', 'human')),
  round smallint not null check (round between 1 and 2),
  field_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.request_draft_ai_states
  add constraint request_draft_ai_states_active_gap_question_fkey
  foreign key (active_gap_question_id) references public.request_draft_gap_questions(id) on delete set null;

create unique index request_draft_one_open_gap_question_idx
  on public.request_draft_gap_questions (request_draft_id) where answered_at is null;
create index request_draft_ai_runs_ready_idx
  on public.request_draft_ai_runs (status, next_attempt_at, created_at) where status in ('queued', 'retryable_failed');
create index request_draft_ai_runs_draft_idx
  on public.request_draft_ai_runs (request_draft_id, created_at desc);

create trigger request_draft_ai_states_set_updated_at
  before update on public.request_draft_ai_states
  for each row execute function public.set_updated_at();

alter table public.request_draft_ai_states enable row level security;
alter table public.request_draft_ai_runs enable row level security;
alter table public.request_draft_gap_questions enable row level security;

-- A submitted build has a stable back-reference to its draft. This is both an
-- idempotency key and a useful audit edge; one draft can never create two builds.
alter table public.build_requests
  add column request_draft_id uuid unique references public.request_drafts(id) on delete set null;

-- The hardened helper functions are referenced from tenant RLS policies. They
-- are not public RPCs, but authenticated policy evaluation must be able to call
-- them. Service-role access remains server-only.
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.is_build_author(uuid) to authenticated;

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
      status = case when draft_row.status = 'ready_to_submit' then 'ready_to_submit' else 'claimed' end
  where request_drafts.id = draft_row.id
  returning request_drafts.id, request_drafts.status, request_drafts.claimed_at
  into id, status, claimed_at;

  return next;
end;
$$;

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
    or jsonb_array_length(workflow_row.approved_system_definition) = 0 then
    raise exception 'draft_not_ready_to_submit' using errcode = 'P0001';
  end if;

  select * into memo_row
  from public.voice_memos
  where request_draft_id = draft_row.id
  for update;

  if not found or memo_row.status <> 'ready' or nullif(btrim(memo_row.transcript), '') is null then
    raise exception 'verified_transcript_required' using errcode = 'P0001';
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
    memo_row.transcript,
    workflow_row.latest_extraction,
    workflow_row.approved_system_definition,
    workflow_row.approved_plain_language_scope,
    null
  ) returning * into new_build_request;

  update public.voice_memos
  set build_request_id = new_build_request.id,
      request_draft_id = null
  where id = memo_row.id;

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
    jsonb_build_object('source', 'public_request_flow', 'workflow_revision', workflow_row.approved_revision)
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

revoke execute on function public.claim_request_draft(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.submit_request_draft(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_request_draft(text, text, uuid) to service_role;
grant execute on function public.submit_request_draft(uuid, text, uuid) to service_role;
