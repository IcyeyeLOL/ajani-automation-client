-- Every accepted build request creates a durable internal-email job in the
-- same database transaction. The request route attempts delivery immediately;
-- the trusted worker can reclaim retryable or abandoned jobs later.

create table public.build_request_notification_jobs (
  build_request_id uuid primary key references public.build_requests(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sending', 'retryable_failed', 'sent', 'terminal_failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index build_request_notification_jobs_ready_idx
  on public.build_request_notification_jobs (status, next_attempt_at, created_at)
  where status in ('queued', 'retryable_failed', 'sending');

alter table public.build_request_notification_jobs enable row level security;
revoke all on table public.build_request_notification_jobs from public, anon, authenticated;

create trigger set_build_request_notification_jobs_updated_at
before update on public.build_request_notification_jobs
for each row execute function public.set_updated_at();

create or replace function public.enqueue_build_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.build_request_notification_jobs (build_request_id)
  values (new.id)
  on conflict (build_request_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.enqueue_build_request_notification() from public, anon, authenticated;
grant execute on function public.enqueue_build_request_notification() to service_role;

create trigger enqueue_build_request_notification_after_insert
after insert on public.build_requests
for each row execute function public.enqueue_build_request_notification();

create or replace function public.claim_build_request_notification(p_build_request_id uuid default null)
returns table (build_request_id uuid, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.build_request_notification_jobs%rowtype;
begin
  select * into claimed
  from public.build_request_notification_jobs job
  where (p_build_request_id is null or job.build_request_id = p_build_request_id)
    and (
      job.status = 'queued'
      or (job.status = 'retryable_failed' and coalesce(job.next_attempt_at, now()) <= now())
      or (job.status = 'sending' and job.updated_at <= now() - interval '10 minutes')
    )
  order by job.created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.build_request_notification_jobs job
  set status = 'sending',
      attempt_count = job.attempt_count + 1,
      next_attempt_at = null,
      last_error = null
  where job.build_request_id = claimed.build_request_id
  returning job.build_request_id, job.attempt_count
  into build_request_id, attempt_count;

  return next;
end;
$$;

revoke execute on function public.claim_build_request_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_build_request_notification(uuid) to service_role;
