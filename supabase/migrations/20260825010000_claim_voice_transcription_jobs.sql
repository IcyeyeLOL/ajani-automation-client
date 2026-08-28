-- Trusted workers claim one ready transcription at a time. The lease permits a
-- later worker to recover jobs abandoned by a crashed invocation.

create or replace function public.claim_voice_memo_transcription_job(p_voice_memo_id uuid default null)
returns table (job_id uuid, voice_memo_id uuid, attempt_count smallint, max_attempts smallint, model text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.voice_memo_transcription_jobs%rowtype;
begin
  select * into claimed
  from public.voice_memo_transcription_jobs job
  where (p_voice_memo_id is null or job.voice_memo_id = p_voice_memo_id)
    and (
    job.status = 'queued'
    or (job.status = 'retryable_failed' and coalesce(job.next_attempt_at, now()) <= now())
    or (job.status = 'running' and job.updated_at <= now() - interval '10 minutes')
  )
    and job.attempt_count < job.max_attempts
  order by job.created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.voice_memo_transcription_jobs job
  set status = 'running',
      attempt_count = job.attempt_count + 1,
      started_at = now(),
      next_attempt_at = null,
      error_code = null
  where job.id = claimed.id
  returning job.id, job.voice_memo_id, job.attempt_count, job.max_attempts, job.model
  into job_id, voice_memo_id, attempt_count, max_attempts, model;

  update public.voice_memos
  set status = 'transcribing'
  where id = voice_memo_id and status in ('uploaded', 'transcribing');

  return next;
end;
$$;

revoke execute on function public.claim_voice_memo_transcription_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_voice_memo_transcription_job(uuid) to service_role;
