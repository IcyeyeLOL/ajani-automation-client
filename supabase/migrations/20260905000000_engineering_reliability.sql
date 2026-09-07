-- Forward-only reliability contracts. Apply after the September 2 acceptance
-- migration. No browser role may invoke these operational functions.
alter table public.request_drafts add column deletion_reserved_at timestamptz;
create index request_draft_cleanup_idx on public.request_drafts(deletion_reserved_at nulls first,expires_at,id)
  where claimed_by is null and status in ('draft','ready_to_submit','expired');
create index voice_transcription_stale_lease_idx on public.voice_memo_transcription_jobs(updated_at)
  where status='running';

-- Signed upload capabilities remain usable for two hours. Deleting content
-- cannot revoke one, so retain only object paths for a second removal after
-- that window plus a conservative 15-minute in-flight upload grace period.
-- There is deliberately no FK: deleting the draft must not delete this outbox.
create table public.request_draft_upload_purges(
  draft_id uuid primary key, storage_paths jsonb not null,
  purge_after timestamptz not null, next_attempt_at timestamptz not null,
  attempt_count integer not null default 0, last_error text,
  check(jsonb_typeof(storage_paths)='array')
);
alter table public.request_draft_upload_purges enable row level security;
revoke all on public.request_draft_upload_purges from public,anon,authenticated;
create index request_draft_upload_purges_due_idx on public.request_draft_upload_purges(next_attempt_at,draft_id);

create function public.reserve_request_draft_deletion(p_draft_id uuid, p_token_hash text default null, p_expired_only boolean default false)
returns table (storage_paths jsonb)
language plpgsql security definer set search_path = '' as $$
declare d public.request_drafts%rowtype; paths jsonb;
begin
  select * into d from public.request_drafts where id = p_draft_id for update;
  if not found then return; end if;
  if d.claimed_by is not null or d.submitted_build_request_id is not null
    or (p_expired_only and d.expires_at > now() and d.deletion_reserved_at is null)
    or (not p_expired_only and (p_token_hash is null or d.token_hash <> p_token_hash)) then
    raise exception 'draft_unavailable' using errcode = 'P0001';
  end if;
  update public.request_drafts set deletion_reserved_at = now(),
    status = 'expired', expires_at = least(expires_at, now()) where id = d.id;
  select coalesce(jsonb_agg(m.storage_path), '[]'::jsonb) into paths
    from public.voice_memos m where m.request_draft_id = d.id;
  if jsonb_array_length(paths)>0 then
    insert into public.request_draft_upload_purges(draft_id,storage_paths,purge_after,next_attempt_at)
      values(d.id,paths,now()+interval '2 hours 15 minutes',now()+interval '2 hours 15 minutes')
      on conflict(draft_id) do nothing;
  end if;
  return query select paths;
end;
$$;

create function public.claim_request_draft_upload_purges(p_limit integer default 100)
returns table(draft_id uuid,storage_paths jsonb,attempt_count integer)
language sql security definer set search_path = '' as $$
  with due as (
    select q.draft_id from public.request_draft_upload_purges q
      where q.purge_after<=now() and q.next_attempt_at<=now()
      order by q.next_attempt_at,q.draft_id for update skip locked limit greatest(1,least(p_limit,100))
  ) update public.request_draft_upload_purges q
    set attempt_count=q.attempt_count+1,next_attempt_at=now()+interval '15 minutes',last_error=null
    from due where q.draft_id=due.draft_id returning q.draft_id,q.storage_paths,q.attempt_count;
$$;

create function public.finish_request_draft_upload_purge(p_draft_id uuid,p_attempt integer,p_succeeded boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_succeeded then
    delete from public.request_draft_upload_purges where draft_id=p_draft_id and attempt_count=p_attempt
      and attempt_count>0 and purge_after<=now();
  else
    update public.request_draft_upload_purges set last_error='storage_remove_failed'
      where draft_id=p_draft_id and attempt_count=p_attempt and attempt_count>0 and purge_after<=now();
  end if;
  return found;
end;
$$;

create function public.finish_request_draft_deletion(p_draft_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.request_drafts where id = p_draft_id
    and deletion_reserved_at is not null and claimed_by is null and submitted_build_request_id is null;
end;
$$;

-- Keep the acceptance-validated implementation private and add replay handling
-- before its expiry check. An existing authorized receipt does not expire.
alter function public.submit_request_draft(uuid, text, uuid) rename to submit_request_draft_validated;
revoke all on function public.submit_request_draft_validated(uuid, text, uuid) from public, anon, authenticated, service_role;
create function public.submit_request_draft(p_draft_id uuid, p_user_id text, p_organization_id uuid)
returns table (build_request_id uuid, build_request_status public.build_request_status, build_request_created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare d public.request_drafts%rowtype;
begin
  select * into d from public.request_drafts where id = p_draft_id for update;
  if not found or d.deletion_reserved_at is not null or p_user_id is null or p_organization_id is null
    or d.claimed_by is distinct from p_user_id or d.organization_id is distinct from p_organization_id then
    raise exception 'draft_unavailable' using errcode = 'P0001';
  end if;
  if d.submitted_build_request_id is not null then
    return query select b.id,b.status,b.created_at from public.build_requests b
      where b.id = d.submitted_build_request_id and b.created_by = p_user_id and b.organization_id = p_organization_id;
    return;
  end if;
  return query select * from public.submit_request_draft_validated(p_draft_id,p_user_id,p_organization_id);
end;
$$;

create or replace function public.claim_request_draft(p_token_hash text, p_user_id text, p_organization_id uuid)
returns table (id uuid, status public.request_draft_status, claimed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare d public.request_drafts%rowtype;
begin
  select * into d from public.request_drafts where token_hash = p_token_hash for update;
  if not found or p_user_id is null or p_organization_id is null or d.deletion_reserved_at is not null
    or (d.expires_at <= now() and d.submitted_build_request_id is null) then
    raise exception 'draft_unavailable' using errcode = 'P0001';
  end if;
  if d.claimed_by is not null and (d.claimed_by <> p_user_id or d.organization_id is distinct from p_organization_id) then
    raise exception 'draft_owned_elsewhere' using errcode = 'P0001';
  end if;
  if d.submitted_build_request_id is not null then
    return query select d.id,d.status,d.claimed_at; return;
  end if;
  return query update public.request_drafts r set claimed_by=p_user_id, organization_id=p_organization_id,
    claimed_at=coalesce(d.claimed_at,now()),
    status=case when d.status='ready_to_submit' then 'ready_to_submit'::public.request_draft_status else 'claimed'::public.request_draft_status end
    where r.id=d.id returning r.id,r.status,r.claimed_at;
end;
$$;

-- Validation of the actual object happens in the trusted route. The final
-- transition, metadata and outbox insertion share this draft/memo transaction.
create function public.complete_request_draft_voice_memo(p_draft_id uuid,p_token_hash text,p_voice_memo_id uuid,p_byte_length integer,p_mime_type text)
returns table (voice_memo_id uuid, voice_status text)
language plpgsql security definer set search_path = '' as $$
declare d public.request_drafts%rowtype; m public.voice_memos%rowtype;
begin
  select * into d from public.request_drafts where id=p_draft_id for update;
  if not found or d.token_hash is distinct from p_token_hash or d.deletion_reserved_at is not null
    or d.expires_at<=now() or d.submitted_build_request_id is not null then
    raise exception 'draft_unavailable' using errcode='P0001';
  end if;
  -- Use the worker's job-before-memo lock order for an existing job.
  perform 1 from public.voice_memo_transcription_jobs q where q.voice_memo_id=p_voice_memo_id for update;
  select * into m from public.voice_memos where id=p_voice_memo_id and request_draft_id=d.id for update;
  if not found then raise exception 'voice_memo_missing' using errcode='P0001'; end if;
  if m.status='pending_upload' then
    update public.voice_memos set status='uploaded',byte_length=p_byte_length,mime_type=p_mime_type where id=m.id;
    m.status := 'uploaded';
  end if;
  insert into public.voice_memo_transcription_jobs(voice_memo_id,status,next_attempt_at)
    values(m.id,case when m.status='ready' then 'succeeded' else 'queued' end,now())
    on conflict on constraint voice_memo_transcription_jobs_voice_memo_id_key do nothing;
  update public.request_drafts set payload=jsonb_set(payload,'{voiceMemo}',
    coalesce(payload->'voiceMemo','{}'::jsonb) || jsonb_build_object('storagePath',m.storage_path,'status',m.status,
      'fileName',m.original_filename,'mimeType',p_mime_type,'byteLength',p_byte_length),true) where request_drafts.id=d.id;
  return query select m.id,m.status::text;
end;
$$;

-- A per-attempt fence prevents a late worker from overwriting a recovered job.
create function public.finish_voice_memo_transcription(p_job_id uuid,p_attempt integer,p_status text,p_result jsonb default '{}'::jsonb,p_error text default null,p_next_attempt_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.voice_memo_transcription_jobs%rowtype;
begin
  select * into j from public.voice_memo_transcription_jobs where id=p_job_id for update;
  if not found or j.status<>'running' or j.attempt_count<>p_attempt then return false; end if;
  if p_status not in ('succeeded','retryable_failed','terminal_failed') then raise exception 'invalid_job_status'; end if;
  update public.voice_memo_transcription_jobs set status=p_status,error_code=p_error,next_attempt_at=p_next_attempt_at,
    completed_at=case when p_status='retryable_failed' then null else now() end,
    provider_request_id=p_result->>'requestId', language=p_result->>'language', confidence=(p_result->>'confidence')::numeric
    where id=j.id;
  if p_status='succeeded' then
    update public.voice_memos set status='ready',provider='deepgram',transcript=p_result->>'text',
      duration_seconds=greatest(round((p_result->>'durationSeconds')::numeric),0),
      transcript_metadata=p_result-'text'-'durationSeconds' where id=j.voice_memo_id;
  elsif p_status='terminal_failed' then
    update public.voice_memos set status='failed' where id=j.voice_memo_id;
  end if;
  return true;
end;
$$;

create or replace function public.claim_voice_memo_transcription_job(p_voice_memo_id uuid default null)
returns table(job_id uuid,voice_memo_id uuid,attempt_count smallint,max_attempts smallint,model text)
language plpgsql security definer set search_path = '' as $$
declare j public.voice_memo_transcription_jobs%rowtype;
begin
  with exhausted as (
    update public.voice_memo_transcription_jobs q set status='terminal_failed',error_code='attempts_exhausted_after_crash',completed_at=now()
    where q.status='running' and q.updated_at<=now()-interval '10 minutes' and q.attempt_count>=q.max_attempts
    returning q.voice_memo_id
  ) update public.voice_memos m set status='failed' from exhausted e where m.id=e.voice_memo_id;
  select * into j from public.voice_memo_transcription_jobs q
    where (p_voice_memo_id is null or q.voice_memo_id=p_voice_memo_id) and q.attempt_count<q.max_attempts
      and (q.status='queued' or (q.status='retryable_failed' and coalesce(q.next_attempt_at,now())<=now())
        or (q.status='running' and q.updated_at<=now()-interval '10 minutes'))
    order by q.created_at,q.id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.voice_memo_transcription_jobs q set status='running',attempt_count=q.attempt_count+1,
    started_at=now(),next_attempt_at=null,error_code=null where q.id=j.id
    returning q.id,q.voice_memo_id,q.attempt_count,q.max_attempts,q.model;
  update public.voice_memos set status='transcribing' where id=j.voice_memo_id and status in ('uploaded','transcribing');
end;
$$;

create or replace function public.claim_build_request_notification(p_build_request_id uuid default null)
returns table(build_request_id uuid,attempt_count integer)
language plpgsql security definer set search_path = '' as $$
declare j public.build_request_notification_jobs%rowtype;
begin
  update public.build_request_notification_jobs q set status='terminal_failed',last_error='attempts_exhausted_after_crash',next_attempt_at=null
    where q.attempt_count>=5 and (q.status in ('queued','retryable_failed')
      or (q.status='sending' and q.updated_at<=now()-interval '10 minutes'));
  select * into j from public.build_request_notification_jobs q
    where (p_build_request_id is null or q.build_request_id=p_build_request_id) and q.attempt_count<5
      and (q.status='queued' or (q.status='retryable_failed' and coalesce(q.next_attempt_at,now())<=now())
        or (q.status='sending' and q.updated_at<=now()-interval '10 minutes'))
    order by q.created_at,q.build_request_id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.build_request_notification_jobs q set status='sending',attempt_count=q.attempt_count+1,
    next_attempt_at=null,last_error=null where q.build_request_id=j.build_request_id returning q.build_request_id,q.attempt_count;
end;
$$;

create function public.claim_clerk_webhook_delivery(p_event_id text,p_event_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare e public.clerk_webhook_events%rowtype;
begin
  insert into public.clerk_webhook_events(id,event_type) values(p_event_id,p_event_type) on conflict(id) do nothing;
  select * into e from public.clerk_webhook_events where id=p_event_id for update;
  if e.processed_at is not null then return 'completed'; end if;
  if e.processing_started_at>now()-interval '10 minutes' then return 'busy'; end if;
  update public.clerk_webhook_events set attempts=attempts+1,processing_started_at=now(),last_error=null where id=p_event_id;
  return 'claimed';
end;
$$;

create table public.clerk_deletion_tombstones(
  entity_kind text not null check(entity_kind in ('organization','membership')),
  provider_id text not null,event_at timestamptz not null,primary key(entity_kind,provider_id)
);
alter table public.clerk_deletion_tombstones enable row level security;
revoke all on public.clerk_deletion_tombstones from public,anon,authenticated;

create function public.record_clerk_deletion(p_entity_kind text,p_provider_id text,p_event_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Synchronizers and deleters take the same entity advisory lock, including
  -- before an entity exists. This closes the tombstone-check/insert race.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_entity_kind||':'||p_provider_id,0));
  insert into public.clerk_deletion_tombstones values(p_entity_kind,p_provider_id,p_event_at)
    on conflict(entity_kind,provider_id) do update set event_at=greatest(clerk_deletion_tombstones.event_at,excluded.event_at);
  if p_entity_kind='organization' then
    update public.organizations set archived_at=p_event_at,clerk_updated_at=p_event_at
      where clerk_organization_id=p_provider_id and coalesce(clerk_updated_at,'-infinity')<=p_event_at;
  elsif p_entity_kind='membership' then
    update public.organization_members set deleted_at=p_event_at,clerk_updated_at=p_event_at
      where clerk_membership_id=p_provider_id and coalesce(clerk_updated_at,'-infinity')<=p_event_at;
  end if;
end;
$$;

alter function public.sync_clerk_organization(text,text,text,text,text,timestamptz,boolean) rename to sync_clerk_organization_ordered;
revoke all on function public.sync_clerk_organization_ordered(text,text,text,text,text,timestamptz,boolean) from public,anon,authenticated,service_role;
create function public.sync_clerk_organization(p_clerk_organization_id text,p_owner_id text,p_business_name text,p_clerk_slug text,p_avatar_url text,p_event_at timestamptz,p_archived boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organization:'||p_clerk_organization_id,0));
  if p_archived then perform public.record_clerk_deletion('organization',p_clerk_organization_id,p_event_at); return null; end if;
  if exists(select 1 from public.clerk_deletion_tombstones where entity_kind='organization' and provider_id=p_clerk_organization_id and event_at>=p_event_at) then return null; end if;
  return public.sync_clerk_organization_ordered(p_clerk_organization_id,p_owner_id,p_business_name,p_clerk_slug,p_avatar_url,p_event_at,false);
end;
$$;

alter function public.sync_clerk_membership(uuid,text,public.organization_role,text,text,timestamptz,boolean) rename to sync_clerk_membership_ordered;
revoke all on function public.sync_clerk_membership_ordered(uuid,text,public.organization_role,text,text,timestamptz,boolean) from public,anon,authenticated,service_role;
create function public.sync_clerk_membership(p_organization_id uuid,p_user_id text,p_role public.organization_role,p_clerk_membership_id text,p_clerk_role text,p_event_at timestamptz,p_deleted boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership:'||p_clerk_membership_id,0));
  if p_deleted then perform public.record_clerk_deletion('membership',p_clerk_membership_id,p_event_at); return; end if;
  if exists(select 1 from public.clerk_deletion_tombstones where entity_kind='membership' and provider_id=p_clerk_membership_id and event_at>=p_event_at) then return; end if;
  perform public.sync_clerk_membership_ordered(p_organization_id,p_user_id,p_role,p_clerk_membership_id,p_clerk_role,p_event_at,false);
end;
$$;

create function public.queue_recovery_health()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'uploadPurges', (select jsonb_build_object('pending',count(*),
      'due',count(*) filter(where purge_after<=now()),'oldestDueAt',min(purge_after) filter(where purge_after<=now()),
      'failed',count(*) filter(where last_error is not null)) from public.request_draft_upload_purges),
    'transcription', (select jsonb_build_object(
      'ready',count(*) filter(where status='queued' or (status='retryable_failed' and next_attempt_at<=now())),
      'oldestReadyAt',min(created_at) filter(where status='queued' or (status='retryable_failed' and next_attempt_at<=now())),
      'staleLeases',count(*) filter(where status='running' and updated_at<=now()-interval '10 minutes'),
      'terminalFailures',count(*) filter(where status='terminal_failed')) from public.voice_memo_transcription_jobs),
    'notification', (select jsonb_build_object(
      'ready',count(*) filter(where status='queued' or (status='retryable_failed' and next_attempt_at<=now())),
      'oldestReadyAt',min(created_at) filter(where status='queued' or (status='retryable_failed' and next_attempt_at<=now())),
      'staleLeases',count(*) filter(where status='sending' and updated_at<=now()-interval '10 minutes'),
      'terminalFailures',count(*) filter(where status='terminal_failed')) from public.build_request_notification_jobs));
$$;

-- Explicit grants: function creation defaults must never expose service RPCs.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('reserve_request_draft_deletion','finish_request_draft_deletion',
      'claim_request_draft_upload_purges','finish_request_draft_upload_purge',
      'submit_request_draft','claim_request_draft','complete_request_draft_voice_memo','finish_voice_memo_transcription',
      'claim_voice_memo_transcription_job','claim_build_request_notification','claim_clerk_webhook_delivery','record_clerk_deletion','sync_clerk_organization','sync_clerk_membership','queue_recovery_health')
  loop execute format('revoke all on function %s from public,anon,authenticated',f);
       execute format('grant execute on function %s to service_role',f); end loop;
end $$;
notify pgrst,'reload schema';
