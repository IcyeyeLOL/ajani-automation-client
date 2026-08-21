-- Keep aggregate outreach records internally consistent even if a future
-- trusted caller bypasses the current Next.js validation layer.

create or replace function public.create_outreach_experiment(
  p_title text,
  p_audience text,
  p_campaign text,
  p_channel text,
  p_method text,
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
  if jsonb_typeof(p_variants) is distinct from 'array'
    or jsonb_array_length(p_variants) not between 2 and 8 then
    raise exception 'An experiment requires between two and eight variants';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_variants) item
    group by item ->> 'label'
    having count(*) > 1
  ) then
    raise exception 'Variant labels must be unique within an experiment';
  end if;

  insert into public.outreach_experiments (title, audience, campaign, channel, method, primary_metric, created_by)
  values (p_title, p_audience, nullif(btrim(p_campaign), ''), p_channel, p_method, p_primary_metric, p_created_by)
  returning id into experiment_id;

  for variant in select value from jsonb_array_elements(p_variants)
  loop
    insert into public.outreach_variants (experiment_id, label, title, sort_order)
    values (experiment_id, variant ->> 'label', variant ->> 'title', variant_index);
    variant_index := variant_index + 1;
  end loop;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (p_created_by, 'created', 'outreach_experiment', experiment_id::text, jsonb_build_object('variant_count', variant_index));
  return experiment_id;
end;
$$;

create or replace function public.create_outreach_batch(
  p_activity_date date,
  p_team_member text,
  p_channel text,
  p_method text,
  p_audience text,
  p_campaign text,
  p_experiment_id uuid,
  p_notes text,
  p_metrics jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_id uuid;
  metric jsonb;
  metric_variant_id uuid;
  connection_requests integer;
  connections_accepted integer;
  initial_dms integer;
  f1_sent integer;
  f2_sent integer;
  replies integer;
  positive_replies integer;
  calls_booked integer;
begin
  if jsonb_typeof(p_metrics) is distinct from 'array'
    or jsonb_array_length(p_metrics) not between 1 and 12 then
    raise exception 'A batch requires between one and twelve metric rows';
  end if;

  if p_experiment_id is not null and not exists (
    select 1 from public.outreach_experiments where id = p_experiment_id and status = 'active'
  ) then
    raise exception 'The selected experiment is not active';
  end if;

  insert into public.outreach_batches (activity_date, team_member, channel, method, audience, campaign, experiment_id, notes)
  values (p_activity_date, p_team_member, p_channel, p_method, p_audience, nullif(btrim(p_campaign), ''), p_experiment_id, nullif(btrim(p_notes), ''))
  returning id into batch_id;

  for metric in select value from jsonb_array_elements(p_metrics)
  loop
    metric_variant_id := nullif(metric ->> 'variantId', '')::uuid;
    connection_requests := coalesce((metric ->> 'connectionRequests')::integer, 0);
    connections_accepted := coalesce((metric ->> 'connectionsAccepted')::integer, 0);
    initial_dms := coalesce((metric ->> 'initialDms')::integer, 0);
    f1_sent := coalesce((metric ->> 'f1Sent')::integer, 0);
    f2_sent := coalesce((metric ->> 'f2Sent')::integer, 0);
    replies := coalesce((metric ->> 'replies')::integer, 0);
    positive_replies := coalesce((metric ->> 'positiveReplies')::integer, 0);
    calls_booked := coalesce((metric ->> 'callsBooked')::integer, 0);

    if metric_variant_id is not null and not exists (
      select 1
      from public.outreach_variants
      where id = metric_variant_id and experiment_id = p_experiment_id and active
    ) then
      raise exception 'A metric variant does not belong to the selected experiment';
    end if;

    if connections_accepted > connection_requests
      or replies > initial_dms
      or f2_sent > f1_sent
      or positive_replies > replies
      or calls_booked > replies then
      raise exception 'Outreach metric counts are internally inconsistent';
    end if;

    insert into public.outreach_batch_metrics (
      batch_id, variant_id, variant_label, connection_requests, connections_accepted,
      initial_dms, f1_sent, f2_sent, replies, positive_replies, calls_booked
    ) values (
      batch_id, metric_variant_id, metric ->> 'variantLabel', connection_requests,
      connections_accepted, initial_dms, f1_sent, f2_sent, replies,
      positive_replies, calls_booked
    );
  end loop;

  insert into public.admin_activity_log (actor, action, entity_type, entity_id, payload)
  values (p_team_member, 'created', 'outreach_batch', batch_id::text, jsonb_build_object('activity_date', p_activity_date, 'experiment_id', p_experiment_id));
  return batch_id;
end;
$$;

revoke execute on function public.create_outreach_experiment(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_outreach_experiment(text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.create_outreach_batch(date, text, text, text, text, text, uuid, text, jsonb) to service_role;
