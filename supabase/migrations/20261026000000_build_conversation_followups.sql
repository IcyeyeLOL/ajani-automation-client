-- Follow-ups to 20261025000000_build_conversations from a review:
-- 1. A closed build waits on nobody and has no open questions.
-- 2. A build put at "Needs input" without a logged stage move (older builds, or
--    a hand edit in the dashboard) asks the client only until they first write,
--    instead of asking again after every Ajani post.
-- 3. One person's messages are counted one at a time across all builds, so two
--    posts on two builds at once cannot pass the rate cap together.
-- 4. Browser roles keep only the read RLS allows on build_messages.

create or replace view public.build_conversation_state with (security_invoker = true) as
select
  request.id as build_request_id,
  request.organization_id,
  request.created_by,
  request.title,
  request.status,
  request.updated_at,
  stats.post_count,
  stats.last_client_at,
  stats.last_ajani_at,
  flag.flagged_at,
  case when request.status = 'cancelled' then 0 else questions.open_questions end as open_questions,
  case when request.status = 'cancelled' then null else questions.open_question_body end as open_question_body,
  waiting.waiting_on,
  case waiting.waiting_on when 'ajani' then 0 when 'client' then 1 else 2 end as waiting_rank,
  last_post.author_role as last_author,
  last_post.body as last_body,
  last_post.created_at as last_post_at
from public.build_requests as request
cross join lateral (
  select
    count(*) as post_count,
    max(message.seq) filter (where message.author_role = 'client') as last_client_seq,
    max(message.seq) filter (where message.author_role = 'ajani') as last_ajani_seq,
    max(message.created_at) filter (where message.author_role = 'client') as last_client_at,
    max(message.created_at) filter (where message.author_role = 'ajani') as last_ajani_at
  from public.build_messages as message
  where message.build_request_id = request.id
) as stats
cross join lateral (
  -- When the build was last put at "Needs input" (stage moves are logged by post_build_update).
  select max(event.created_at) as flagged_at
  from public.build_events as event
  where event.build_request_id = request.id
    and event.event_type = 'status_changed'
    and event.payload ->> 'to' = 'needs_attention'
) as flag
cross join lateral (
  select
    count(*) as open_questions,
    (array_agg(question.body order by question.seq desc))[1] as open_question_body
  from public.build_messages as question
  where question.build_request_id = request.id
    and question.author_role = 'ajani'
    and question.kind = 'question'
    and question.seq > coalesce(stats.last_client_seq, 0)
) as questions
cross join lateral (
  select case
    -- A closed build is finished business on both sides.
    when request.status = 'cancelled' then null
    when questions.open_questions > 0 then 'client'
    when request.status = 'needs_attention' and (
      stats.last_client_seq is null
      or (flag.flagged_at is not null and stats.last_client_at < flag.flagged_at)
    ) then 'client'
    when stats.last_client_seq > coalesce(stats.last_ajani_seq, 0) then 'ajani'
  end as waiting_on
) as waiting
left join lateral (
  select recent.author_role, recent.body, recent.created_at
  from public.build_messages as recent
  where recent.build_request_id = request.id
  order by recent.seq desc
  limit 1
) as last_post on true;

revoke all on table public.build_conversation_state from public, anon, authenticated;
grant select on table public.build_conversation_state to service_role;

create or replace function public.post_client_build_message(
  p_build_request_id uuid,
  p_user_id text,
  p_organization_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_message_id uuid;
begin
  perform 1
  from public.build_requests as request
  join public.organizations as organization on organization.id = request.organization_id
  join public.organization_members as membership on membership.organization_id = request.organization_id
  where request.id = p_build_request_id
    and request.organization_id = p_organization_id
    and organization.archived_at is null
    and membership.user_id = p_user_id
    -- A removed member keeps a row with deleted_at set; they can no longer write.
    and membership.deleted_at is null
  for update of request;
  if not found then
    raise exception 'build_request_not_found' using errcode = 'P0002';
  end if;

  -- The build lock above only lines up posts on one build; this lines up one person's posts everywhere.
  perform pg_advisory_xact_lock(hashtextextended('build_msg_rate:' || p_user_id, 0));
  if (
    select count(*) from public.build_messages as message
    where message.author_user_id = p_user_id
      and message.author_role = 'client'
      and message.created_at > now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'message_rate_limited' using errcode = '54000';
  end if;

  insert into public.build_messages (build_request_id, author_role, author_user_id, kind, body)
  values (p_build_request_id, 'client', p_user_id, 'message', regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  returning id into new_message_id;

  update public.build_requests set updated_at = now() where id = p_build_request_id;
  return new_message_id;
end;
$$;

revoke execute on function public.post_client_build_message(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.post_client_build_message(uuid, text, uuid, text) to service_role;

-- Supabase's default grants give browser roles every table right; keep only the read RLS filters.
revoke all on table public.build_messages from public, anon, authenticated;
grant select on table public.build_messages to authenticated;
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.build_messages', 'seq'));
end
$$;
