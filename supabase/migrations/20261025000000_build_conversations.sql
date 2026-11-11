-- Build conversations: Ajani posts progress updates and questions on a build,
-- and the client replies, all kept on that build. Organization members read
-- their own threads through RLS; every write goes through the trusted server
-- functions below, never a browser session.

create table public.build_messages (
  id uuid primary key default gen_random_uuid(),
  -- Write order. Each build's writes are serialized by a row lock on the build,
  -- so this orders a thread even when two posts share a timestamp.
  seq bigint generated always as identity unique,
  build_request_id uuid not null references public.build_requests(id) on delete cascade,
  author_role text not null check (author_role in ('ajani', 'client')),
  author_user_id text,
  kind text not null check (kind in ('update', 'question', 'message')),
  -- Newlines and tabs count as blank too, not only spaces.
  body text not null check (char_length(regexp_replace(body, '^[[:space:]]+|[[:space:]]+$', '', 'g')) between 1 and 4000),
  link_url text check (link_url is null or (char_length(link_url) <= 2000 and link_url ~ '^https://[^[:space:]<>"]+$')),
  link_label text check (link_label is null or char_length(btrim(link_label)) between 1 and 80),
  email_status text not null default 'not_sent' check (email_status in ('not_sent', 'sent', 'failed')),
  -- The moment of the write, not the start of its transaction.
  created_at timestamptz not null default clock_timestamp(),
  -- Ajani posts updates and questions; a client always writes a message.
  constraint build_messages_kind_matches_author check (
    (author_role = 'ajani' and kind in ('update', 'question')) or (author_role = 'client' and kind = 'message')
  ),
  constraint build_messages_label_needs_link check (link_url is not null or link_label is null)
);

create index build_messages_build_seq_idx on public.build_messages (build_request_id, seq desc);
create index build_messages_author_created_idx on public.build_messages (author_user_id, created_at desc);

alter table public.build_messages enable row level security;
create policy "organization members can read build messages" on public.build_messages for select to authenticated
  using (exists (select 1 from public.build_requests as request where request.id = build_request_id and public.is_org_member(request.organization_id)));
revoke insert, update, delete on table public.build_messages from public, anon, authenticated;

-- Who each build is waiting on, one row per build, from its whole thread and
-- stage history, so a long thread or a long build list never hides it.
-- The client owes an answer while a question is open (asked after their last
-- message) or while the build sits at "Needs input" and they have not written
-- since it was put there. Otherwise a client message waits on Ajani until
-- Ajani posts after it. Trusted server code reads it.
create view public.build_conversation_state with (security_invoker = true) as
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
  questions.open_questions,
  questions.open_question_body,
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
    when questions.open_questions > 0 then 'client'
    when request.status = 'needs_attention' and (
      stats.last_client_seq is null
      or (flag.flagged_at is not null and stats.last_client_at < flag.flagged_at)
      -- Older builds put at "Needs input" before stage moves were logged.
      or (flag.flagged_at is null and stats.last_client_seq < coalesce(stats.last_ajani_seq, 0))
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

-- Ajani's side: move a build to a delivery stage, post an update or a question,
-- or both at once. The stage change, its timeline event and the message land
-- together or not at all.
create or replace function public.post_build_update(
  p_build_request_id uuid,
  p_actor text,
  p_status public.build_request_status,
  p_kind text,
  p_body text,
  p_link_url text,
  p_link_label text
)
returns table (message_id uuid, previous_status public.build_request_status, current_status public.build_request_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_status public.build_request_status;
  new_message_id uuid;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('in_review', 'in_progress', 'needs_attention', 'live', 'cancelled') then
    raise exception 'status_not_settable' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('update', 'question') then
    raise exception 'kind_not_allowed' using errcode = '22023';
  end if;

  select request.status into old_status
  from public.build_requests as request
  where request.id = p_build_request_id
  for update;
  if not found then
    raise exception 'build_request_not_found' using errcode = 'P0002';
  end if;

  if p_kind is null and (p_status is null or p_status = old_status) then
    raise exception 'nothing_to_post' using errcode = '22023';
  end if;

  if p_status is not null and p_status <> old_status then
    update public.build_requests set status = p_status where id = p_build_request_id;
    -- Timed after the lock, so it compares correctly with client messages.
    insert into public.build_events (build_request_id, event_type, payload, created_at)
    values (p_build_request_id, 'status_changed', jsonb_build_object('from', old_status, 'to', p_status, 'actor', p_actor), clock_timestamp());
  else
    -- A post with no stage change is still activity: lists sort by it.
    update public.build_requests set updated_at = now() where id = p_build_request_id;
  end if;

  if p_kind is not null then
    insert into public.build_messages (build_request_id, author_role, author_user_id, kind, body, link_url, link_label)
    values (p_build_request_id, 'ajani', p_actor, p_kind, regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), nullif(btrim(p_link_url), ''), nullif(btrim(p_link_label), ''))
    returning id into new_message_id;
  end if;

  message_id := new_message_id;
  previous_status := old_status;
  current_status := coalesce(p_status, old_status);
  return next;
end;
$$;

revoke execute on function public.post_build_update(uuid, text, public.build_request_status, text, text, text, text) from public, anon, authenticated;
grant execute on function public.post_build_update(uuid, text, public.build_request_status, text, text, text, text) to service_role;

-- The client's side: a member of the build's organization writes a message.
-- The server resolves the organization from the signed-in Clerk session; this
-- function checks it again so a wrong pairing can never reach another client's
-- build, and caps how fast one person can post.
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
