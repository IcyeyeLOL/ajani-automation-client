-- Synthetic fixtures in the isolated local PostgreSQL harness only.
begin;
do $$
declare first_claim jsonb; recovered jsonb; event_id text := 'audit_fenced_delivery';
begin
  first_claim := public.claim_clerk_webhook_delivery_v2(event_id,'user.updated');
  if first_claim->>'state'<>'claimed' or (first_claim->>'attempt')::integer<>1 then
    raise exception 'first webhook attempt must own its lease';
  end if;
  if public.claim_clerk_webhook_delivery_v2(event_id,'user.updated')->>'state'<>'busy' then
    raise exception 'active webhook must remain retryable, not acknowledged';
  end if;
  update public.clerk_webhook_events set processing_started_at=now()-interval '11 minutes' where id=event_id;
  recovered := public.claim_clerk_webhook_delivery_v2(event_id,'user.updated');
  if recovered->>'state'<>'claimed' or (recovered->>'attempt')::integer<>2 then
    raise exception 'recovery must increment the fence';
  end if;
  if public.finish_clerk_webhook_delivery_v2(event_id,1,'stale failure')
    or public.finish_clerk_webhook_delivery_v2(event_id,1,null) then
    raise exception 'stale failure or success cannot complete the current lease';
  end if;
  if exists(select 1 from public.clerk_webhook_events where id=event_id
    and (processed_at is not null or processing_started_at is null or last_error is not null or attempts<>2)) then
    raise exception 'stale attempts must not mutate current delivery state';
  end if;
  if not public.finish_clerk_webhook_delivery_v2(event_id,2,'retryable failure') then
    raise exception 'owner must be able to release a failed attempt';
  end if;
  recovered := public.claim_clerk_webhook_delivery_v2(event_id,'user.updated');
  if (recovered->>'attempt')::integer<>3 or not public.finish_clerk_webhook_delivery_v2(event_id,3,null) then
    raise exception 'a later owner must be able to complete delivery';
  end if;
  if public.finish_clerk_webhook_delivery_v2(event_id,3,'duplicate failure')
    or public.claim_clerk_webhook_delivery_v2(event_id,'user.updated')->>'state'<>'completed' then
    raise exception 'completed delivery must remain immutable and duplicate-safe';
  end if;
  if has_function_privilege('anon','public.claim_clerk_webhook_delivery_v2(text,text)','execute')
    or has_function_privilege('authenticated','public.finish_clerk_webhook_delivery_v2(text,integer,text)','execute')
    or not has_function_privilege('service_role','public.finish_clerk_webhook_delivery_v2(text,integer,text)','execute') then
    raise exception 'webhook fencing RPCs must remain service-role only';
  end if;
  raise notice 'webhook regressions passed: busy vs completed, attempt fencing, immutable completion, permissions';
end;
$$;
rollback;
