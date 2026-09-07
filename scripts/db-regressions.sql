-- Synthetic, rollback-only integration cases. ONLY run against the isolated
-- disposable database created by the local regression harness, never a linked
-- Supabase project. psql must use ON_ERROR_STOP so any failed assertion exits.
begin;

create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;

insert into public.profiles(id) values ('audit-user'),('audit-other-user');
insert into public.organizations(id,owner_id,business_name,clerk_organization_id)
  values('10000000-0000-4000-8000-000000000001','audit-user','Synthetic regression workspace','org_audit');

create function pg_temp.ready_draft(token text) returns uuid language plpgsql as $$
declare d uuid; brief text := 'Synthetic request for routing customer messages';
begin
  insert into public.request_drafts(token_hash,status,payload) values(token,'ready_to_submit',jsonb_build_object(
    'title','Synthetic regression','extractedContext',jsonb_build_object('writtenBrief',brief),
    'legalAcceptance',jsonb_build_object('acknowledged',true,'acceptedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action','request_handoff','method','affirmative_checkbox','noticeVersion','handoff-notice-2026-09-02',
      'acceptableUseVersion','2026-09-02','privacyVersion','2026-09-02','termsVersion','2026-09-02')))
    returning id into d;
  insert into public.request_draft_ai_states(request_draft_id,state,transcript_fingerprint,transcript_revision,
    approved_revision,approved_hash,approved_system_definition,approved_plain_language_scope)
    values(d,'ready_to_submit',encode(extensions.digest(brief,'sha256'),'hex'),1,1,'synthetic-hash',
      '[{"id":"one","kind":"handoff","title":"Route to owner","detail":"Owner reviews"}]','Route to owner');
  return d;
end;
$$;

do $$ declare d uuid; receipt uuid; replay uuid; m uuid; reservation jsonb;
begin
  -- Deletion wins: reservation is reentrant; no claim/submission is possible.
  d := pg_temp.ready_draft('audit-delete');
  insert into public.voice_memos(request_draft_id,storage_path,status) values(d,'synthetic/delete.webm','pending_upload');
  select storage_paths into reservation from public.reserve_request_draft_deletion(d,'audit-delete',false);
  perform pg_temp.assert_true(reservation='["synthetic/delete.webm"]'::jsonb,'deletion exposes only reserved paths');
  perform public.reserve_request_draft_deletion(d,'audit-delete',false);
  begin
    perform public.claim_request_draft('audit-delete','audit-user','10000000-0000-4000-8000-000000000001');
    raise exception 'claim unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_unavailable' then raise; end if;
  end;
  perform public.finish_request_draft_deletion(d);
  perform public.finish_request_draft_deletion(d);
  perform pg_temp.assert_true(not exists(select 1 from public.request_drafts where id=d),'finish deletion idempotent');
  perform pg_temp.assert_true((select storage_paths='["synthetic/delete.webm"]'::jsonb and purge_after>=now()+interval '2 hours'
    from public.request_draft_upload_purges where draft_id=d),'path-only purge receipt survives immediate content deletion');
  perform pg_temp.assert_true(not public.finish_request_draft_upload_purge(d,0,true),'cannot finalize purge before upload capability expires');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_request_draft_upload_purges()),'signed-upload grace is not claimed early');
  update public.request_draft_upload_purges set purge_after=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where draft_id=d;
  perform pg_temp.assert_true((select count(*)=1 from public.claim_request_draft_upload_purges()),'expired upload capability schedules second removal');
  perform pg_temp.assert_true(not public.finish_request_draft_upload_purge(d,0,true),'stale delayed-purge attempt cannot finalize');
  perform pg_temp.assert_true(public.finish_request_draft_upload_purge(d,1,false),'failed delayed purge remains observable and retryable');
  perform pg_temp.assert_true((select last_error='storage_remove_failed' from public.request_draft_upload_purges where draft_id=d),'failed purge retains path receipt');
  update public.request_draft_upload_purges set next_attempt_at=now()-interval '1 minute' where draft_id=d;
  perform public.claim_request_draft_upload_purges();
  perform pg_temp.assert_true(public.finish_request_draft_upload_purge(d,2,true),'successful delayed removal deletes path receipt');
  perform pg_temp.assert_true(not exists(select 1 from public.request_draft_upload_purges where draft_id=d),'no path receipt remains after final purge');

  -- Submission wins: source recording survives and expired retries return the
  -- original receipt, without duplicating builds or notification jobs.
  d := pg_temp.ready_draft('audit-submit');
  insert into public.voice_memos(request_draft_id,storage_path,status) values(d,'synthetic/retained.webm','uploaded') returning id into m;
  perform public.claim_request_draft('audit-submit','audit-user','10000000-0000-4000-8000-000000000001');
  select build_request_id into receipt from public.submit_request_draft(d,'audit-user','10000000-0000-4000-8000-000000000001');
  update public.request_drafts set expires_at=now()-interval '1 day' where id=d;
  perform public.claim_request_draft('audit-submit','audit-user','10000000-0000-4000-8000-000000000001');
  select build_request_id into replay from public.submit_request_draft(d,'audit-user','10000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_true(receipt=replay,'authorized replay returns same build');
  perform pg_temp.assert_true((select count(*)=1 from public.build_requests where request_draft_id=d),'one draft one build');
  perform pg_temp.assert_true((select count(*)=1 from public.build_request_notification_jobs where build_request_id=receipt),'one notification outbox record');
  perform pg_temp.assert_true((select build_request_id=receipt and request_draft_id is null from public.voice_memos where id=m),'recording moves to submitted build');
  begin
    perform public.reserve_request_draft_deletion(d,'audit-submit',false);
    raise exception 'submitted draft deletion unexpectedly reserved';
  exception when sqlstate 'P0001' then if sqlerrm<>'draft_unavailable' then raise; end if; end;
  begin
    perform public.submit_request_draft(d,'audit-other-user','10000000-0000-4000-8000-000000000001');
    raise exception 'foreign receipt unexpectedly returned';
  exception when sqlstate 'P0001' then if sqlerrm<>'draft_unavailable' then raise; end if; end;
end $$;

do $$ declare d uuid; m uuid; j record; first_attempt integer; finished boolean; memo_status text;
begin
  d := pg_temp.ready_draft('audit-voice');
  insert into public.voice_memos(request_draft_id,storage_path,status,mime_type,byte_length)
    values(d,'synthetic/voice.webm','pending_upload','audio/webm',32) returning id into m;
  perform public.complete_request_draft_voice_memo(d,'audit-voice',m,32,'audio/webm');
  perform public.complete_request_draft_voice_memo(d,'audit-voice',m,32,'audio/webm');
  perform pg_temp.assert_true((select count(*)=1 from public.voice_memo_transcription_jobs where voice_memo_id=m),'completion enqueues once');
  select * into j from public.claim_voice_memo_transcription_job(m);
  first_attempt := j.attempt_count;
  finished := public.finish_voice_memo_transcription(j.job_id,first_attempt-1,'succeeded','{"text":"stale","durationSeconds":1}');
  perform pg_temp.assert_true(not finished,'stale attempt cannot write memo or job');
  finished := public.finish_voice_memo_transcription(j.job_id,first_attempt,'succeeded','{"text":"Approved transcript","durationSeconds":3,"confidence":0.95,"model":"synthetic"}');
  perform pg_temp.assert_true(finished,'current attempt finishes atomically');
  select voice_status into memo_status from public.complete_request_draft_voice_memo(d,'audit-voice',m,32,'audio/webm');
  perform pg_temp.assert_true(memo_status='ready','completion replay never downgrades ready memo');
  perform pg_temp.assert_true((select transcript='Approved transcript' from public.voice_memos where id=m),'stale worker did not overwrite transcript');
  perform pg_temp.assert_true(not public.finish_voice_memo_transcription(j.job_id,first_attempt,'terminal_failed','{}','late-error'), 'late failure cannot regress success');
end $$;

-- Simulate process death at the final attempt. Disable only the fixture table's
-- timestamp trigger briefly because production updates normally reset it.
alter table public.voice_memo_transcription_jobs disable trigger voice_memo_transcription_jobs_set_updated_at;
do $$ declare d uuid; m uuid;
begin
  d := pg_temp.ready_draft('audit-crash');
  insert into public.voice_memos(request_draft_id,storage_path,status) values(d,'synthetic/crash.webm','transcribing') returning id into m;
  insert into public.voice_memo_transcription_jobs(voice_memo_id,status,attempt_count,max_attempts,updated_at)
    values(m,'running',3,3,now()-interval '20 minutes');
  perform public.claim_voice_memo_transcription_job(m);
  perform pg_temp.assert_true((select status='terminal_failed' from public.voice_memo_transcription_jobs where voice_memo_id=m),'expired final lease becomes terminal');
  perform pg_temp.assert_true((select status='failed' from public.voice_memos where id=m),'expired final lease updates memo status');
end $$;
alter table public.voice_memo_transcription_jobs enable trigger voice_memo_transcription_jobs_set_updated_at;

alter table public.build_request_notification_jobs disable trigger set_build_request_notification_jobs_updated_at;
do $$ declare b uuid;
begin
  select id into b from public.build_requests where created_by='audit-user' limit 1;
  update public.build_request_notification_jobs set status='sending',attempt_count=5,updated_at=now()-interval '20 minutes'
    where build_request_id=b;
  perform public.claim_build_request_notification(b);
  perform pg_temp.assert_true((select status='terminal_failed' from public.build_request_notification_jobs where build_request_id=b),'expired notification final lease becomes terminal');
end $$;
alter table public.build_request_notification_jobs enable trigger set_build_request_notification_jobs_updated_at;

do $$ declare organization_id uuid;
begin
  perform pg_temp.assert_true(public.claim_clerk_webhook_delivery('audit-event','user.updated')='claimed','first delivery claimed');
  perform pg_temp.assert_true(public.claim_clerk_webhook_delivery('audit-event','user.updated')='busy','unfinished delivery remains retryable');
  perform public.finish_clerk_webhook_event('audit-event',null);
  perform pg_temp.assert_true(public.claim_clerk_webhook_delivery('audit-event','user.updated')='completed','completed delivery acknowledged');

  perform public.record_clerk_deletion('organization','org_deleted_first',now());
  organization_id := public.sync_clerk_organization('org_deleted_first','audit-user','Deleted','deleted',null,now()-interval '1 day',false);
  perform pg_temp.assert_true(organization_id is null,'older organization creation cannot resurrect deletion');
  perform pg_temp.assert_true(not exists(select 1 from public.organizations where clerk_organization_id='org_deleted_first'),'deleted org stays absent');

  perform public.record_clerk_deletion('membership','membership_deleted_first',now());
  perform public.sync_clerk_membership('10000000-0000-4000-8000-000000000001','audit-other-user','member','membership_deleted_first','org:member',now()-interval '1 day',false);
  perform pg_temp.assert_true(not exists(select 1 from public.organization_members where clerk_membership_id='membership_deleted_first'),'older membership creation cannot resurrect deletion');
  organization_id := public.sync_clerk_organization('org_atomic','audit-user','Atomic','atomic',null,now(),false);
  perform pg_temp.assert_true(organization_id=public.sync_clerk_organization('org_atomic','audit-user','Atomic','atomic',null,now(),false),'organization upsert resolves one identity');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.reserve_request_draft_deletion(uuid,text,boolean)','execute'),'browser cannot reserve deletion');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.request_draft_upload_purges','select'),'browser cannot read retained object paths');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.submit_request_draft_validated(uuid,text,uuid)','execute'),'private submit implementation not browser callable');
  perform pg_temp.assert_true(not has_function_privilege('service_role','public.submit_request_draft_validated(uuid,text,uuid)','execute'),'private implementation not a service bypass');
  perform pg_temp.assert_true(public.queue_recovery_health() ? 'transcription','queue health RPC returns safe operational counts');
end $$;

rollback;
select 'Database reliability regression assertions passed; synthetic transaction rolled back.' as result;
