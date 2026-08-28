-- Clarify asks a compact batch in one AI call, then advances through each
-- customer answer without another model call. The prior partial unique index
-- allowed only one unanswered question per draft.

alter table public.request_draft_gap_questions
  add column if not exists answer_format text not null default 'free_text'
    check (answer_format in ('free_text', 'single_select')),
  add column if not exists options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array'),
  add column if not exists position smallint not null default 1
    check (position between 1 and 4);

drop index if exists public.request_draft_one_open_gap_question_idx;

create index if not exists request_draft_open_gap_questions_idx
  on public.request_draft_gap_questions (request_draft_id, position, created_at)
  where answered_at is null;
