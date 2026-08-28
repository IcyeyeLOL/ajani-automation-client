-- Let an admin record a complete experiment snapshot without duplicating the
-- selected experiment's audience, campaign, channel, method, or message step
-- in the browser. The RPC derives those values and validates variant ownership
-- atomically before writing the regular outreach batch tables.

create or replace function public.create_experiment_metric_snapshot(
  p_experiment_id uuid,
  p_activity_date date,
  p_team_member text,
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
  experiment_record public.outreach_experiments%rowtype;
  variant_record public.outreach_variants%rowtype;
  batch_id uuid;
  metric jsonb;
  metric_variant_id uuid;
  sent integer;
  replies integer;
  positive_replies integer;
  calls_booked integer;
  connection_requests integer;
  connections_accepted integer;
  activity_total bigint := 0;
begin
  if jsonb_typeof(p_metrics) is distinct from 'array'
    or jsonb_array_length(p_metrics) not between 1 and 12 then
    raise exception 'An experiment entry requires between one and twelve metric rows';
  end if;

  select * into experiment_record
  from public.outreach_experiments
  where id = p_experiment_id and status = 'active';

  if not found then
    raise exception 'The selected experiment is not active';
  end if;

  if char_length(btrim(p_team_member)) not between 2 and 100 then
    raise exception 'The team member must contain between two and one hundred characters';
  end if;

  insert into public.outreach_batches (
    activity_date, team_member, channel, method, audience, campaign, experiment_id, notes
  ) values (
    p_activity_date,
    btrim(p_team_member),
    experiment_record.channel,
    experiment_record.method,
    experiment_record.audience,
    experiment_record.campaign,
    experiment_record.id,
    nullif(btrim(p_notes), '')
  ) returning id into batch_id;

  for metric in select value from jsonb_array_elements(p_metrics)
  loop
    metric_variant_id := nullif(metric ->> 'variantId', '')::uuid;
    sent := coalesce((metric ->> 'sent')::integer, 0);
    replies := coalesce((metric ->> 'replies')::integer, 0);
    positive_replies := coalesce((metric ->> 'positiveReplies')::integer, 0);
    calls_booked := coalesce((metric ->> 'callsBooked')::integer, 0);
    connection_requests := case
      when experiment_record.message_step = 'connection_request' then sent
      else coalesce((metric ->> 'connectionRequests')::integer, 0)
    end;
    connections_accepted := coalesce((metric ->> 'connectionsAccepted')::integer, 0);

    select * into variant_record
    from public.outreach_variants
    where id = metric_variant_id
      and experiment_id = experiment_record.id
      and active;

    if not found then
      raise exception 'A metric variant does not belong to the selected experiment';
    end if;

    if sent < 0 or sent > 1000000
      or replies < 0 or replies > 1000000
      or positive_replies < 0 or positive_replies > 1000000
      or calls_booked < 0 or calls_booked > 1000000
      or connection_requests < 0 or connection_requests > 1000000
      or connections_accepted < 0 or connections_accepted > 1000000
      or replies > sent
      or positive_replies > replies
      or calls_booked > replies
      or connections_accepted > connection_requests then
      raise exception 'Experiment metric counts are internally inconsistent';
    end if;

    activity_total := activity_total + sent + replies + positive_replies + calls_booked
      + connection_requests + connections_accepted;

    insert into public.outreach_batch_metrics (
      batch_id,
      variant_id,
      variant_label,
      connection_requests,
      connections_accepted,
      initial_dms,
      f1_sent,
      f2_sent,
      custom_sent,
      replies,
      attributed_replies,
      positive_replies,
      calls_booked
    ) values (
      batch_id,
      variant_record.id,
      variant_record.label,
      connection_requests,
      connections_accepted,
      case when experiment_record.message_step = 'initial_dm' then sent else 0 end,
      case when experiment_record.message_step = 'follow_up_1' then sent else 0 end,
      case when experiment_record.message_step = 'follow_up_2' then sent else 0 end,
      case when experiment_record.message_step = 'custom' then sent else 0 end,
      replies,
      replies,
      positive_replies,
      calls_booked
    );
  end loop;

  if activity_total = 0 then
    raise exception 'Enter at least one experiment activity or outcome count';
  end if;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (
    p_actor,
    'created',
    'experiment_metric_snapshot',
    batch_id::text,
    jsonb_build_object(
      'activity_date', p_activity_date,
      'experiment_id', experiment_record.id,
      'message_step', experiment_record.message_step,
      'team_member', btrim(p_team_member)
    )
  );

  return batch_id;
end;
$$;

revoke execute on function public.create_experiment_metric_snapshot(uuid, date, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_experiment_metric_snapshot(uuid, date, text, text, jsonb, text)
  to service_role;
