-- Server-only Claude workflow state. Do not store prompts, raw provider errors,
-- credentials, or API keys in these tables.

create table public.build_request_ai_states (
  build_request_id uuid primary key references public.build_requests(id) on delete cascade,
  state text not null default 'awaiting_verified_transcript' check (state in (
    'awaiting_verified_transcript', 'extraction_queued', 'extracting', 'awaiting_clarification',
    'reflection_queued', 'awaiting_customer_confirmation', 'ready_for_human_review',
    'human_review_required', 'failed_retryable', 'failed_terminal'
  )),
  transcript_fingerprint text,
  transcript_revision integer not null default 0 check (transcript_revision >= 0),
  clarification_round smallint not null default 0 check (clarification_round between 0 and 2),
  reflection_round smallint not null default 0 check (reflection_round between 0 and 2),
  active_gap_question_id uuid references public.gap_questions(id) on delete set null,
  latest_extraction jsonb not null default '{}'::jsonb,
  latest_scope jsonb not null default '{}'::jsonb,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  requires_human_review boolean not null default false,
  last_error_code text,
  last_error_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  build_request_id uuid not null references public.build_requests(id) on delete cascade,
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
  estimated_cost_usd numeric(12, 8) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  result jsonb not null default '{}'::jsonb,
  redaction_count integer not null default 0 check (redaction_count >= 0),
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (build_request_id, task, input_fingerprint, prompt_version)
);

alter table public.gap_questions add column source text not null default 'human' check (source in ('ai', 'human'));
alter table public.gap_questions add column round smallint check (round between 1 and 2);
alter table public.gap_questions add column field_keys jsonb not null default '[]'::jsonb;
alter table public.gap_questions add column ai_run_id uuid references public.ai_workflow_runs(id) on delete set null;

create unique index one_open_gap_question_per_build_request on public.gap_questions (build_request_id) where answered_at is null;
create index ai_workflow_runs_ready_idx on public.ai_workflow_runs (status, created_at) where status in ('queued', 'retryable_failed');
create index ai_workflow_runs_build_request_idx on public.ai_workflow_runs (build_request_id, created_at desc);

create trigger build_request_ai_states_set_updated_at before update on public.build_request_ai_states for each row execute function public.set_updated_at();

alter table public.build_request_ai_states enable row level security;
alter table public.ai_workflow_runs enable row level security;

-- These records are internal workflow state. Request data remains exposed through
-- the existing tenant-scoped build request and gap question policies only.
