-- Synthetic, transactional fixtures for Outreach totals across channels. Root
-- harness runs only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  keys text[] := array['outreach.touches', 'outreach.replies', 'outreach.reply_rate', 'outreach.calls_booked', 'outreach.positive_replies'];
  series jsonb; item jsonb; dimensions jsonb;
begin
  ---------------------------------------------------------------------------
  -- Logged batches: LinkedIn by hand, and Dripify before and after its sync starts.
  ---------------------------------------------------------------------------
  perform public.create_outreach_batch(today - 3, 'Audit team', 'linkedin', 'manual', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":10,"connectionsAccepted":3,"initialDms":20,"f1Sent":5,"f2Sent":0,"customSent":0,"replies":4,"attributedReplies":4,"positiveReplies":2,"callsBooked":1}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 3, 'Audit team', 'linkedin', 'dripify', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":30,"connectionsAccepted":10,"initialDms":10,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":2,"attributedReplies":2,"positiveReplies":1,"callsBooked":1}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 1, 'Audit team', 'linkedin', 'dripify', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":15,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":3,"attributedReplies":3,"positiveReplies":2,"callsBooked":1}]'::jsonb,
    'audit_totals');

  -- Before the Dripify sync records anything, logged Dripify batches count in full.
  series := public.load_analytics_series(array['outreach.touches'], 'day', today - 6, today, 'linkedin/dripify') -> 'series';
  if (series #>> '{0,current}')::numeric <> 55 then
    raise exception 'logged Dripify batches must count until the sync starts, got %', series;
  end if;

  ---------------------------------------------------------------------------
  -- Dripify sync (two campaigns), Reddit DMs and cold calls.
  ---------------------------------------------------------------------------
  perform public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'dripify.new_contacted', 'date', today - 2, 'dimension', 'dripify:1', 'value', 25),
    jsonb_build_object('metricKey', 'dripify.new_contacted', 'date', today - 2, 'dimension', 'dripify:2', 'value', 5),
    jsonb_build_object('metricKey', 'dripify.new_accepted', 'date', today - 2, 'dimension', 'dripify:1', 'value', 4),
    jsonb_build_object('metricKey', 'dripify.new_replies', 'date', today - 2, 'dimension', 'dripify:1', 'value', 3),
    jsonb_build_object('metricKey', 'dripify.new_contacted', 'date', today - 1, 'dimension', 'dripify:1', 'value', 12),
    jsonb_build_object('metricKey', 'dripify.new_replies', 'date', today - 1, 'dimension', 'dripify:1', 'value', 1)
  ), 'connector', 'connector:dripify');
  perform public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'reddit.dms_sent', 'date', today - 2, 'value', 10),
    jsonb_build_object('metricKey', 'reddit.dm_replies', 'date', today - 1, 'value', 2),
    jsonb_build_object('metricKey', 'reddit.dm_calls_booked', 'date', today - 1, 'value', 1),
    jsonb_build_object('metricKey', 'cold_calls.dials', 'date', today - 1, 'value', 40),
    jsonb_build_object('metricKey', 'cold_calls.positive_replies', 'date', today - 1, 'value', 2),
    jsonb_build_object('metricKey', 'cold_calls.neutral_replies', 'date', today - 1, 'value', 3),
    jsonb_build_object('metricKey', 'cold_calls.negative_replies', 'date', today - 1, 'value', 5),
    jsonb_build_object('metricKey', 'cold_calls.follow_ups', 'date', today - 1, 'value', 4),
    jsonb_build_object('metricKey', 'cold_calls.meetings_booked', 'date', today - 1, 'value', 1)
  ), 'manual', 'admin');

  ---------------------------------------------------------------------------
  -- All channels add up. Touches: 35 manual + 40 Dripify batch + 42 Dripify
  -- sync (the later batch's sends are the sync's) + 10 DMs + 40 calls.
  ---------------------------------------------------------------------------
  series := public.load_analytics_series(keys, 'day', today - 6, today) -> 'series';
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.touches';
  if (item->>'current')::numeric <> 167 then raise exception 'touches must add every channel, got %', item; end if;
  -- Replies: 4 + 2 + 4 Dripify sync + 2 Reddit + 10 answered calls (follow-ups are not extra replies).
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.replies';
  if (item->>'current')::numeric <> 22 then raise exception 'replies must add every channel, got %', item; end if;
  -- Reply base: 20 + 10 first messages + 42 Dripify contacted + 10 DMs + 40 calls.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.reply_rate';
  if (item->>'current_numerator')::numeric <> 22 or (item->>'current_denominator')::numeric <> 122 then
    raise exception 'the reply rate must be all replies over everyone reached, got %', item;
  end if;
  -- Calls: 1 + 1 + 1 (a synced-era Dripify batch keeps its booked call) + 1 Reddit + 1 cold call.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.calls_booked';
  if (item->>'current')::numeric <> 5 then raise exception 'calls booked must add every channel, got %', item; end if;
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.positive_replies';
  if (item->>'current')::numeric <> 7 then raise exception 'positive replies come from batches and cold calls, got %', item; end if;

  ---------------------------------------------------------------------------
  -- Each channel still filters on its own.
  ---------------------------------------------------------------------------
  series := public.load_analytics_series(array['outreach.touches', 'outreach.replies'], 'day', today - 6, today, 'phone/cold_call') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 40 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.replies') <> 10 then
    raise exception 'the cold-call channel must show calls made and answered replies, got %', series;
  end if;
  series := public.load_analytics_series(array['outreach.touches', 'outreach.calls_booked'], 'day', today - 6, today, 'reddit/dm') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 10 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 1 then
    raise exception 'the Reddit DM channel must show DMs sent and calls booked, got %', series;
  end if;
  series := public.load_analytics_series(array['outreach.touches', 'outreach.calls_booked'], 'day', today - 6, today, 'linkedin/dripify') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 82 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 2 then
    raise exception 'Dripify must take its sends from the sync once it starts, without dropping booked calls, got %', series;
  end if;

  select value->'dimensions' into dimensions from jsonb_array_elements(public.load_analytics_catalog()->'metrics') where value->>'metric_key' = 'outreach.touches';
  if not (dimensions ?& array['linkedin/manual', 'linkedin/dripify', 'reddit/dm', 'phone/cold_call']) then
    raise exception 'the Channel filter must list every channel with numbers, got %', dimensions;
  end if;

  ---------------------------------------------------------------------------
  -- The overview shows the same totals; the Outreach page's batch funnel does not.
  ---------------------------------------------------------------------------
  item := public.load_admin_analytics();
  if (item #>> '{metrics,outreach_current}')::numeric <> 167 or (item #>> '{metrics,replies_current}')::numeric <> 22
    or (item #>> '{metrics,reply_base_current}')::numeric <> 122 then
    raise exception 'the overview must show every channel, got %', item->'metrics';
  end if;
  if (select sum((t->>'outreach')::numeric) from jsonb_array_elements(item->'trend') t) <> 167 then
    raise exception 'the overview trend must show every channel, got %', item->'trend';
  end if;
  if (item #>> '{outreach,calls_booked}')::numeric <> 3 then
    raise exception 'the Outreach page funnel reads logged batches only, got %', item->'outreach';
  end if;

  raise notice 'outreach totals regressions passed: every channel, no double counting, per-channel filters';
end;
$$;
rollback;
