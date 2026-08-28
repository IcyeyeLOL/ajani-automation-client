-- Keep experiment exposure aligned with the exact outreach step under test.
-- Existing experiments and metrics retain their prior initial-DM semantics.

alter table public.outreach_experiments
  add column if not exists message_step text not null default 'initial_dm'
  check (message_step in ('connection_request', 'initial_dm', 'follow_up_1', 'follow_up_2', 'custom'));

alter table public.outreach_batch_metrics
  add column if not exists custom_sent integer not null default 0 check (custom_sent >= 0),
  add column if not exists attributed_replies integer not null default 0 check (attributed_replies >= 0);

update public.outreach_batch_metrics
set attributed_replies = replies;

alter table public.outreach_batch_metrics
  drop constraint if exists outreach_batch_metrics_attributed_replies_check;

alter table public.outreach_batch_metrics
  add constraint outreach_batch_metrics_attributed_replies_check
  check (attributed_replies <= replies);

drop function if exists public.create_outreach_experiment(text, text, text, text, text, text, text, jsonb);

create function public.create_outreach_experiment(
  p_title text,
  p_audience text,
  p_campaign text,
  p_channel text,
  p_method text,
  p_message_step text,
  p_primary_metric text,
  p_created_by text,
  p_variants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  experiment_id uuid;
  variant jsonb;
  variant_index integer := 0;
begin
  insert into public.outreach_experiments (
    title, audience, campaign, channel, method, message_step, primary_metric, created_by
  ) values (
    p_title, p_audience, nullif(btrim(p_campaign), ''), p_channel, p_method,
    p_message_step, p_primary_metric, p_created_by
  )
  returning id into experiment_id;

  for variant in select value from jsonb_array_elements(p_variants)
  loop
    insert into public.outreach_variants (experiment_id, label, title, sort_order)
    values (experiment_id, variant ->> 'label', variant ->> 'title', variant_index);
    variant_index := variant_index + 1;
  end loop;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (
    p_created_by,
    'created',
    'outreach_experiment',
    experiment_id::text,
    jsonb_build_object('variant_count', variant_index, 'message_step', p_message_step)
  );
  return experiment_id;
end;
$$;

drop function if exists public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb);

create function public.create_outreach_batch(
  p_activity_date date,
  p_team_member text,
  p_channel text,
  p_method text,
  p_audience text,
  p_campaign text,
  p_experiment_id uuid,
  p_notes text,
  p_metrics jsonb,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_id uuid;
  metric jsonb;
begin
  insert into public.outreach_batches (activity_date, team_member, channel, method, audience, campaign, experiment_id, notes)
  values (p_activity_date, p_team_member, p_channel, p_method, p_audience, nullif(btrim(p_campaign), ''), p_experiment_id, nullif(btrim(p_notes), ''))
  returning id into batch_id;

  for metric in select value from jsonb_array_elements(p_metrics)
  loop
    insert into public.outreach_batch_metrics (
      batch_id, variant_id, variant_label, connection_requests, connections_accepted,
      initial_dms, f1_sent, f2_sent, custom_sent, replies, attributed_replies,
      positive_replies, calls_booked
    ) values (
      batch_id,
      nullif(metric ->> 'variantId', '')::uuid,
      metric ->> 'variantLabel',
      coalesce((metric ->> 'connectionRequests')::integer, 0),
      coalesce((metric ->> 'connectionsAccepted')::integer, 0),
      coalesce((metric ->> 'initialDms')::integer, 0),
      coalesce((metric ->> 'f1Sent')::integer, 0),
      coalesce((metric ->> 'f2Sent')::integer, 0),
      coalesce((metric ->> 'customSent')::integer, 0),
      coalesce((metric ->> 'replies')::integer, 0),
      coalesce((metric ->> 'attributedReplies')::integer, 0),
      coalesce((metric ->> 'positiveReplies')::integer, 0),
      coalesce((metric ->> 'callsBooked')::integer, 0)
    );
  end loop;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (
    p_actor,
    'created',
    'outreach_batch',
    batch_id::text,
    jsonb_build_object('activity_date', p_activity_date, 'experiment_id', p_experiment_id, 'team_member', p_team_member)
  );
  return batch_id;
end;
$$;

revoke execute on function public.create_outreach_experiment(text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_outreach_experiment(text, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb, text) to service_role;
