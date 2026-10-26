-- Synthetic, rollback-only cases for build conversations. Root harness runs
-- only in isolated local Postgres.
begin;

create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin if value is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;

insert into public.profiles(id) values ('talk-client'),('talk-teammate'),('talk-stranger');
insert into public.organizations(id,owner_id,business_name,clerk_organization_id) values
  ('20000000-0000-4000-8000-000000000001','talk-client','Synthetic client workspace','org_talk'),
  ('20000000-0000-4000-8000-000000000002','talk-stranger','Synthetic other workspace','org_other');
insert into public.organization_members(organization_id,user_id,role)
  values('20000000-0000-4000-8000-000000000001','talk-teammate','member');
insert into public.build_requests(id,organization_id,created_by,title,status) values
  ('21000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','talk-client','Synthetic intake build','in_review'),
  ('21000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','talk-stranger','Synthetic other build','in_review'),
  ('21000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','talk-client','Synthetic state build','in_progress'),
  ('21000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','talk-client','Synthetic quiet build','in_review'),
  ('21000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','talk-client','Synthetic needs input build','in_progress'),
  ('21000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','talk-client','Synthetic same moment build','in_progress'),
  ('21000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','talk-client','Synthetic older flagged build','needs_attention');

do $$
declare
  build uuid := '21000000-0000-4000-8000-000000000001';
  other_build uuid := '21000000-0000-4000-8000-000000000002';
  workspace uuid := '20000000-0000-4000-8000-000000000001';
  state_build uuid := '21000000-0000-4000-8000-000000000003';
  quiet_build uuid := '21000000-0000-4000-8000-000000000004';
  flag_build uuid := '21000000-0000-4000-8000-000000000005';
  same_moment_build uuid := '21000000-0000-4000-8000-000000000006';
  legacy_build uuid := '21000000-0000-4000-8000-000000000007';
  result record; conversation record; message uuid; failed boolean; index integer;
begin
  ---------------------------------------------------------------------------
  -- A stage change, its timeline event and the update land together.
  ---------------------------------------------------------------------------
  select * into result from public.post_build_update(build, 'admin-user', 'in_progress', 'update', '  Connected the booking calendar.  ', 'https://www.loom.com/share/abc', 'Loom walkthrough');
  perform pg_temp.assert_true(result.previous_status = 'in_review' and result.current_status = 'in_progress', 'update reports both stages');
  perform pg_temp.assert_true((select status from public.build_requests where id = build) = 'in_progress', 'stage moved');
  perform pg_temp.assert_true((select count(*) from public.build_events where build_request_id = build and event_type = 'status_changed'
    and payload ->> 'from' = 'in_review' and payload ->> 'to' = 'in_progress') = 1, 'stage change is on the timeline');
  perform pg_temp.assert_true((select body from public.build_messages where id = result.message_id) = 'Connected the booking calendar.', 'update body is trimmed');
  perform pg_temp.assert_true((select author_role = 'ajani' and kind = 'update' and link_label = 'Loom walkthrough' from public.build_messages where id = result.message_id), 'update keeps its author, kind and link');

  -- A question with no stage change adds no timeline event.
  select * into result from public.post_build_update(build, 'admin-user', null, 'question', 'Which calendar should new bookings go to?', null, null);
  perform pg_temp.assert_true(result.current_status = 'in_progress', 'question keeps the stage');
  perform pg_temp.assert_true((select count(*) from public.build_events where build_request_id = build and event_type = 'status_changed') = 1, 'no event without a stage change');

  -- A stage change alone needs no message.
  select * into result from public.post_build_update(build, 'admin-user', 'needs_attention', null, null, null, null);
  perform pg_temp.assert_true(result.message_id is null and result.current_status = 'needs_attention', 'stage-only change works');

  -- Nothing to post, a draft-only stage, an unknown kind or a bad link all refuse.
  begin perform public.post_build_update(build, 'admin-user', 'needs_attention', null, null, null, null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'same stage with no message is refused');
  begin perform public.post_build_update(build, 'admin-user', 'paid', null, null, null, null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'payment stages are not set by hand');
  begin perform public.post_build_update(build, 'admin-user', null, 'message', 'Hi', null, null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'Ajani posts updates or questions, not client messages');
  begin perform public.post_build_update(build, 'admin-user', null, 'update', 'See this', 'javascript:alert(1)', null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'links must be https');
  begin perform public.post_build_update(build, 'admin-user', null, 'update', 'See this', 'http://example.com', null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'plain http links are refused');
  begin perform public.post_build_update(build, 'admin-user', null, 'update', 'See this', null, 'Orphan label'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a label needs a link');
  begin perform public.post_build_update(build, 'admin-user', null, 'update', repeat('x', 4001), null, null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'over-long updates are refused');
  begin perform public.post_build_update(build, 'admin-user', null, 'update', '   ', null, null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'blank updates are refused');
  begin perform public.post_build_update('21000000-0000-4000-8000-0000000000ff', 'admin-user', 'live', null, null, null, null); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'unknown builds are refused');

  ---------------------------------------------------------------------------
  -- Clients write only on their own organization's builds.
  ---------------------------------------------------------------------------
  message := public.post_client_build_message(build, 'talk-client', workspace, '  Use the front desk calendar.  ');
  perform pg_temp.assert_true((select author_role = 'client' and kind = 'message' and body = 'Use the front desk calendar.' from public.build_messages where id = message), 'client message saved and trimmed');
  message := public.post_client_build_message(build, 'talk-teammate', workspace, 'Adding: Saturdays too.');
  perform pg_temp.assert_true(message is not null, 'a teammate in the same workspace can write');
  begin perform public.post_client_build_message(build, 'talk-stranger', workspace, 'Let me in'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a non-member cannot write');
  begin perform public.post_client_build_message(other_build, 'talk-client', workspace, 'Wrong build'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a build from another workspace is refused');
  begin perform public.post_client_build_message(build, 'talk-client', '20000000-0000-4000-8000-000000000002', 'Wrong pairing'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a mismatched workspace is refused');

  -- One person can post 20 messages in ten minutes; the 21st waits.
  for index in 1..19 loop
    perform public.post_client_build_message(build, 'talk-client', workspace, 'Follow-up ' || index);
  end loop;
  begin perform public.post_client_build_message(build, 'talk-client', workspace, 'One too many'); failed := false; exception when others then failed := sqlerrm = 'message_rate_limited'; end;
  perform pg_temp.assert_true(failed, 'message rate is capped');

  update public.organizations set archived_at = now() where id = workspace;
  begin perform public.post_client_build_message(build, 'talk-teammate', workspace, 'After archive'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'an archived workspace cannot write');
  update public.organizations set archived_at = null where id = workspace;

  update public.organization_members set deleted_at = now() where organization_id = workspace and user_id = 'talk-teammate';
  begin perform public.post_client_build_message(build, 'talk-teammate', workspace, 'After removal'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a removed member cannot write');
  update public.organization_members set deleted_at = null where organization_id = workspace and user_id = 'talk-teammate';

  ---------------------------------------------------------------------------
  -- Who a build waits on comes from its whole thread. Rows are written with
  -- their own times, since everything in one transaction shares now().
  ---------------------------------------------------------------------------
  insert into public.build_messages(build_request_id,author_role,author_user_id,kind,body,created_at) values
    (state_build,'ajani','admin-user','question','First question',now() - interval '3 hours'),
    (state_build,'client','talk-client','message','Answer',now() - interval '2 hours'),
    (state_build,'ajani','admin-user','question','Second question',now() - interval '1 hour'),
    (state_build,'ajani','admin-user','update','Still building',now() - interval '30 minutes');
  select * into conversation from public.build_conversation_state where build_request_id = state_build;
  perform pg_temp.assert_true(conversation.open_questions = 1 and conversation.waiting_on = 'client' and conversation.post_count = 4, 'a question asked after the last reply stays open through later updates');
  perform pg_temp.assert_true(conversation.last_author = 'ajani' and conversation.last_body = 'Still building', 'the latest post is reported');
  perform pg_temp.assert_true(conversation.open_question_body = 'Second question', 'the open question is reported however long the thread');
  insert into public.build_messages(build_request_id,author_role,author_user_id,kind,body,created_at)
    values(state_build,'client','talk-client','message','Second answer',now() - interval '10 minutes');
  select * into conversation from public.build_conversation_state where build_request_id = state_build;
  perform pg_temp.assert_true(conversation.open_questions = 0 and conversation.waiting_on = 'ajani', 'a client reply answers every open question and waits on Ajani');
  insert into public.build_messages(build_request_id,author_role,author_user_id,kind,body,created_at)
    values(state_build,'ajani','admin-user','update','Got it',now() - interval '5 minutes');
  perform pg_temp.assert_true((select waiting_on is null from public.build_conversation_state where build_request_id = state_build), 'an Ajani post after the reply waits on nobody');
  select * into conversation from public.build_conversation_state where build_request_id = quiet_build;
  perform pg_temp.assert_true(conversation.post_count = 0 and conversation.waiting_on is null and conversation.waiting_rank = 2
    and conversation.title = 'Synthetic quiet build', 'a build with no posts still has a state row');

  -- Putting a build at "Needs input" asks the client, even with no message, and their next reply answers it.
  perform public.post_client_build_message(flag_build, 'talk-teammate', workspace, 'Any news?');
  perform pg_temp.assert_true((select waiting_on = 'ajani' from public.build_conversation_state where build_request_id = flag_build), 'a client message waits on Ajani');
  perform public.post_build_update(flag_build, 'admin-user', 'needs_attention', null, null, null, null);
  select * into conversation from public.build_conversation_state where build_request_id = flag_build;
  perform pg_temp.assert_true(conversation.waiting_on = 'client' and conversation.open_questions = 0 and conversation.waiting_rank = 1, 'a stage-only move to Needs input waits on the client');
  perform public.post_client_build_message(flag_build, 'talk-teammate', workspace, 'Here is the login.');
  perform pg_temp.assert_true((select waiting_on = 'ajani' from public.build_conversation_state where build_request_id = flag_build), 'the reply hands it back to Ajani');
  perform public.post_build_update(flag_build, 'admin-user', null, 'update', 'Thanks, testing it now.', null, null);
  perform pg_temp.assert_true((select waiting_on is null from public.build_conversation_state where build_request_id = flag_build), 'a later update does not ask the client again');

  -- Posts written at the same moment keep their write order.
  insert into public.build_messages(build_request_id,author_role,author_user_id,kind,body,created_at) values
    (same_moment_build,'ajani','admin-user','question','Which calendar?',now()),
    (same_moment_build,'client','talk-client','message','The front desk one.',now());
  select * into conversation from public.build_conversation_state where build_request_id = same_moment_build;
  perform pg_temp.assert_true(conversation.open_questions = 0 and conversation.waiting_on = 'ajani' and conversation.last_body = 'The front desk one.', 'a reply in the same moment still follows the question');

  -- A build put at "Needs input" before stage moves were logged still asks the client.
  perform pg_temp.assert_true((select waiting_on = 'client' from public.build_conversation_state where build_request_id = legacy_build), 'an older Needs input build waits on the client');
  insert into public.build_messages(build_request_id,author_role,author_user_id,kind,body) values(legacy_build,'client','talk-client','message','Done.');
  perform pg_temp.assert_true((select waiting_on = 'ajani' from public.build_conversation_state where build_request_id = legacy_build), 'and the client reply hands it back');

  -- The table itself refuses mismatched authors and blank bodies.
  begin insert into public.build_messages(build_request_id,author_role,kind,body) values(state_build,'ajani','message','Hi'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'Ajani cannot write a client message');
  begin insert into public.build_messages(build_request_id,author_role,kind,body) values(state_build,'client','update','Hi'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a client cannot post an update');
  begin perform public.post_client_build_message(build, 'talk-teammate', workspace, E'\n\t \r\n'); failed := false; exception when others then failed := true; end;
  perform pg_temp.assert_true(failed, 'a message of only newlines and tabs is refused');
  message := public.post_client_build_message(build, 'talk-teammate', workspace, E'\n Saturdays too.\t\n');
  perform pg_temp.assert_true((select body from public.build_messages where id = message) = 'Saturdays too.', 'newlines and tabs are trimmed');

  ---------------------------------------------------------------------------
  -- Browser sessions read only their own threads and can write nothing.
  ---------------------------------------------------------------------------
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.build_messages', 'insert')
    and not has_table_privilege('authenticated', 'public.build_messages', 'update')
    and not has_table_privilege('authenticated', 'public.build_messages', 'delete'), 'browser roles cannot write messages');
  perform pg_temp.assert_true(not has_function_privilege('authenticated', 'public.post_build_update(uuid,text,public.build_request_status,text,text,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.post_client_build_message(uuid,text,uuid,text)', 'execute'), 'browser roles cannot call the write functions');
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.build_conversation_state', 'select')
    and not has_table_privilege('anon', 'public.build_conversation_state', 'select')
    and has_table_privilege('service_role', 'public.build_conversation_state', 'select'), 'only trusted server code reads conversation state');
end;
$$;

-- Supabase grants select to signed-in sessions; RLS decides which rows.
grant select on public.build_messages, public.build_requests to authenticated;
insert into public.build_messages(build_request_id,author_role,author_user_id,kind,body)
  values('21000000-0000-4000-8000-000000000002','client','talk-stranger','message','Synthetic other thread');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"talk-teammate","org_id":"org_talk"}', true);
select pg_temp.assert_true((select count(*) from public.build_messages) > 0
  and (select count(*) from public.build_messages where build_request_id = '21000000-0000-4000-8000-000000000002') = 0, 'a member never reads another workspace''s thread');
select set_config('request.jwt.claims', '{"sub":"talk-teammate","org_id":"org_other"}', true);
select pg_temp.assert_true((select count(*) from public.build_messages where build_request_id = '21000000-0000-4000-8000-000000000001') = 0, 'the wrong active workspace reads nothing');
reset role;

rollback;
