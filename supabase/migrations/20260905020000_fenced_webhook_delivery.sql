-- Delivery completion must belong to the currently held attempt, never a
-- superseded invocation. Legacy service-only RPCs remain for rolling upgrades.
begin;

create function public.claim_clerk_webhook_delivery_v2(p_event_id text,p_event_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.clerk_webhook_events%rowtype; claimed_attempt integer;
begin
  insert into public.clerk_webhook_events(id,event_type) values(p_event_id,p_event_type) on conflict(id) do nothing;
  select * into e from public.clerk_webhook_events where id=p_event_id for update;
  if e.processed_at is not null then
    return jsonb_build_object('state','completed','attempt',e.attempts);
  end if;
  if e.processing_started_at>now()-interval '10 minutes' then
    return jsonb_build_object('state','busy','attempt',e.attempts);
  end if;
  update public.clerk_webhook_events set attempts=attempts+1,processing_started_at=now(),last_error=null
    where id=p_event_id returning attempts into claimed_attempt;
  return jsonb_build_object('state','claimed','attempt',claimed_attempt);
end;
$$;

create function public.finish_clerk_webhook_delivery_v2(p_event_id text,p_attempt integer,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare finished_id text;
begin
  update public.clerk_webhook_events set
    processed_at=case when p_error is null then now() else processed_at end,
    processing_started_at=null,last_error=left(p_error,500)
  where id=p_event_id and attempts=p_attempt and processing_started_at is not null and processed_at is null
  returning id into finished_id;
  return finished_id is not null;
end;
$$;

revoke all on function public.claim_clerk_webhook_delivery_v2(text,text),public.finish_clerk_webhook_delivery_v2(text,integer,text)
  from public,anon,authenticated;
grant execute on function public.claim_clerk_webhook_delivery_v2(text,text),public.finish_clerk_webhook_delivery_v2(text,integer,text)
  to service_role;
notify pgrst,'reload schema';
commit;
