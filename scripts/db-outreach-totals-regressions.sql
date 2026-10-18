-- Synthetic, transactional fixtures for Outreach totals across channels. Root
-- harness runs only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  keys text[] := array['outreach.touches', 'outreach.replies', 'outreach.reply_rate', 'outreach.calls_booked', 'outreach.positive_replies', 'outreach.acceptance_rate'];
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

  -- A Dripify batch after the sync's latest day (the sync stopped), and Reddit
  -- batches against Log numbers' spans (DMs sent today-5..today-2, replies and
  -- calls today-1): one inside the DM span on a day with nothing logged, one
  -- on a logged DM day, and one after the DM span on the replies-and-calls day.
  perform public.create_outreach_batch(today, 'Audit team', 'linkedin', 'dripify', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":8,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":1,"attributedReplies":1,"positiveReplies":1,"callsBooked":0}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 2, 'Audit team', 'reddit', 'manual', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":10,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":2,"attributedReplies":2,"positiveReplies":1,"callsBooked":1}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 1, 'Audit team', 'reddit', 'manual', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":6,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":1,"attributedReplies":1,"positiveReplies":1,"callsBooked":1}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 4, 'Audit team', 'reddit', 'manual', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":5,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":1,"attributedReplies":1,"positiveReplies":0,"callsBooked":0}]'::jsonb,
    'audit_totals');

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
    jsonb_build_object('metricKey', 'reddit.dms_sent', 'date', today - 5, 'value', 4),
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
  -- All channels add up. Touches: 35 manual + 40 Dripify batch before the sync
  -- + 8 Dripify batch after it (the batch inside its span is the sync's) + 42
  -- Dripify sync + 14 DMs + 40 calls + 6 from the Reddit batch after the DM
  -- span (the two inside it are Log numbers').
  ---------------------------------------------------------------------------
  series := public.load_analytics_series(keys, 'day', today - 6, today) -> 'series';
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.touches';
  if (item->>'current')::numeric <> 185 then raise exception 'touches must add every channel once, got %', item; end if;
  -- Replies: 4 + 2 + 1 Dripify batches + 4 Dripify sync + 2 Reddit DMs + 1 + 2 from the
  -- Reddit batches before the replies span + 10 answered calls (follow-ups are not extra replies).
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.replies';
  if (item->>'current')::numeric <> 26 then raise exception 'replies must add every channel once, got %', item; end if;
  -- Reply base: 20 + 10 + 8 first messages + 42 Dripify contacted + 14 DMs + 6 Reddit batch + 40 calls.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.reply_rate';
  if (item->>'current_numerator')::numeric <> 26 or (item->>'current_denominator')::numeric <> 140 then
    raise exception 'the reply rate must be all replies over everyone reached, got %', item;
  end if;
  -- Calls: 1 + 1 + 1 (a synced-era Dripify batch keeps its booked call) + 1 Reddit DMs
  -- + 1 Reddit batch before the calls span (the one inside it is Log numbers') + 1 cold call.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.calls_booked';
  if (item->>'current')::numeric <> 6 then raise exception 'calls booked must add every channel once, got %', item; end if;
  -- Positive replies: Log numbers doesn't record them for Dripify or Reddit, so every batch keeps its own.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.positive_replies';
  if (item->>'current')::numeric <> 10 then raise exception 'positive replies come from batches and cold calls, got %', item; end if;
  -- Acceptance: 3 + 10 batch acceptances + 4 Dripify sync, over 10 + 30 requests + 42 leads Dripify contacted.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.acceptance_rate';
  if (item->>'current_numerator')::numeric <> 17 or (item->>'current_denominator')::numeric <> 82 then
    raise exception 'the acceptance rate must include the Dripify sync, got %', item;
  end if;

  ---------------------------------------------------------------------------
  -- Each channel still filters on its own.
  ---------------------------------------------------------------------------
  series := public.load_analytics_series(array['outreach.touches', 'outreach.replies'], 'day', today - 6, today, 'phone/cold_call') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 40 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.replies') <> 10 then
    raise exception 'the cold-call channel must show calls made and answered replies, got %', series;
  end if;
  series := public.load_analytics_series(array['outreach.touches', 'outreach.calls_booked'], 'day', today - 6, today, 'reddit/dm') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 14 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 1 then
    raise exception 'the Reddit DM channel must show DMs sent and calls booked, got %', series;
  end if;
  -- Dripify: 40 before the sync + 8 after its latest day + 42 synced; calls 1 + 1.
  series := public.load_analytics_series(array['outreach.touches', 'outreach.calls_booked', 'outreach.acceptance_rate'], 'day', today - 6, today, 'linkedin/dripify') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 90 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 2 then
    raise exception 'Dripify must take its sends from the sync only while it runs, without dropping booked calls, got %', series;
  end if;
  if (select (s->>'current_numerator')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.acceptance_rate') <> 14
    or (select (s->>'current_denominator')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.acceptance_rate') <> 72 then
    raise exception 'Dripify acceptance must be accepted over contacted, as Dripify shows it, got %', series;
  end if;
  -- Reddit batches: each number counts outside Log numbers' span for it. Sends: 6 (after
  -- the DM span); replies: 1 + 2 (before the replies span); calls: 1 (before the calls span).
  series := public.load_analytics_series(array['outreach.touches', 'outreach.replies', 'outreach.calls_booked'], 'day', today - 6, today, 'reddit/manual') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 6
    or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.replies') <> 3
    or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 1 then
    raise exception 'Reddit batches must not repeat what Log numbers has for Reddit, got %', series;
  end if;

  select value->'dimensions' into dimensions from jsonb_array_elements(public.load_analytics_catalog()->'metrics') where value->>'metric_key' = 'outreach.touches';
  if not (dimensions ?& array['linkedin/manual', 'linkedin/dripify', 'reddit/dm', 'reddit/manual', 'phone/cold_call']) then
    raise exception 'the Channel filter must list every channel with numbers, got %', dimensions;
  end if;

  ---------------------------------------------------------------------------
  -- The overview shows the same totals; the Outreach page's batch funnel does not.
  ---------------------------------------------------------------------------
  item := public.load_admin_analytics();
  if (item #>> '{metrics,outreach_current}')::numeric <> 185 or (item #>> '{metrics,replies_current}')::numeric <> 26
    or (item #>> '{metrics,reply_base_current}')::numeric <> 140 then
    raise exception 'the overview must show every channel, got %', item->'metrics';
  end if;
  if (select sum((t->>'outreach')::numeric) from jsonb_array_elements(item->'trend') t) <> 185 then
    raise exception 'the overview trend must show every channel, got %', item->'trend';
  end if;
  -- Batch calls only: 1 manual + 1 + 1 + 0 Dripify + 1 + 1 + 0 Reddit.
  if (item #>> '{outreach,calls_booked}')::numeric <> 5 then
    raise exception 'the Outreach page funnel reads logged batches only, got %', item->'outreach';
  end if;

  raise notice 'outreach totals regressions passed: every channel, no double counting, per-channel filters';
end;
$$;
rollback;
