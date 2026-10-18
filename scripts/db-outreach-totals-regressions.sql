-- Synthetic, transactional fixtures for Outreach totals: Dripify, Reddit DMs and
-- cold calls (20261018010000, narrowed by 20261018020000). Root harness runs
-- only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  keys text[] := array['outreach.touches', 'outreach.replies', 'outreach.reply_rate', 'outreach.calls_booked', 'outreach.positive_replies', 'outreach.acceptance_rate'];
  series jsonb; item jsonb; dimensions jsonb; catalog jsonb;
begin
  ---------------------------------------------------------------------------
  -- Logged batches (LinkedIn by hand, Dripify, Reddit) still feed the batch
  -- funnel and A/B tests, but are not an outreach channel.
  ---------------------------------------------------------------------------
  perform public.create_outreach_batch(today - 3, 'Audit team', 'linkedin', 'manual', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":10,"connectionsAccepted":3,"initialDms":20,"f1Sent":5,"f2Sent":0,"customSent":0,"replies":4,"attributedReplies":4,"positiveReplies":2,"callsBooked":2}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 1, 'Audit team', 'linkedin', 'dripify', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":15,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":3,"attributedReplies":3,"positiveReplies":2,"callsBooked":1}]'::jsonb,
    'audit_totals');
  perform public.create_outreach_batch(today - 2, 'Audit team', 'reddit', 'manual', 'Synthetic owners', '', null, '',
    '[{"variantId":null,"variantLabel":"No variant","connectionRequests":0,"connectionsAccepted":0,"initialDms":10,"f1Sent":0,"f2Sent":0,"customSent":0,"replies":2,"attributedReplies":2,"positiveReplies":1,"callsBooked":1}]'::jsonb,
    'audit_totals');
  series := public.load_analytics_series(array['outreach.touches'], 'day', today - 6, today) -> 'series';
  if coalesce((series #>> '{0,current}')::numeric, 0) <> 0 then
    raise exception 'logged batches must not count toward outreach, got %', series;
  end if;

  ---------------------------------------------------------------------------
  -- Dripify sync (two campaigns) plus Dripify outcomes from Log numbers,
  -- Reddit DMs and cold calls.
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
    jsonb_build_object('metricKey', 'dripify.positive_replies', 'date', today - 1, 'value', 2),
    jsonb_build_object('metricKey', 'dripify.calls_booked', 'date', today - 1, 'value', 1),
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
  -- The three channels add up; logged batches add nothing.
  ---------------------------------------------------------------------------
  series := public.load_analytics_series(keys, 'day', today - 6, today) -> 'series';
  -- Touches: 42 Dripify contacted + 10 Reddit DMs + 40 calls made.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.touches';
  if (item->>'current')::numeric <> 92 then raise exception 'touches must add the three channels, got %', item; end if;
  -- Replies: 4 Dripify + 2 Reddit + 2 positive calls (neutral and negative answers don't count).
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.replies';
  if (item->>'current')::numeric <> 8 then raise exception 'replies must add the three channels, cold calls positive only, got %', item; end if;
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.reply_rate';
  if (item->>'current_numerator')::numeric <> 8 or (item->>'current_denominator')::numeric <> 92 then
    raise exception 'the reply rate must be replies over everyone reached, got %', item;
  end if;
  -- Calls: 1 Dripify (Log numbers) + 1 Reddit + 1 cold call.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.calls_booked';
  if (item->>'current')::numeric <> 3 then raise exception 'calls booked must add the three channels, got %', item; end if;
  -- Positive replies: 2 Dripify (Log numbers) + 2 cold calls.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.positive_replies';
  if (item->>'current')::numeric <> 4 then raise exception 'positive replies come from Dripify and cold calls, got %', item; end if;
  -- Acceptance: Dripify's 4 accepted over 42 contacted.
  select value into item from jsonb_array_elements(series) where value->>'metric_key' = 'outreach.acceptance_rate';
  if (item->>'current_numerator')::numeric <> 4 or (item->>'current_denominator')::numeric <> 42 then
    raise exception 'the acceptance rate must be Dripify accepted over contacted, got %', item;
  end if;

  ---------------------------------------------------------------------------
  -- Each channel filters on its own; a logged batch's channel reads nothing.
  ---------------------------------------------------------------------------
  series := public.load_analytics_series(array['outreach.touches', 'outreach.replies'], 'day', today - 6, today, 'phone/cold_call') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 40 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.replies') <> 2 then
    raise exception 'the cold-call channel must show calls made and positive answers only, got %', series;
  end if;
  series := public.load_analytics_series(array['outreach.touches', 'outreach.calls_booked'], 'day', today - 6, today, 'reddit/dm') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 10 or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 1 then
    raise exception 'the Reddit DM channel must show DMs sent and calls booked, got %', series;
  end if;
  series := public.load_analytics_series(array['outreach.touches', 'outreach.calls_booked', 'outreach.positive_replies'], 'day', today - 6, today, 'linkedin/dripify') -> 'series';
  if (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.touches') <> 42
    or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.calls_booked') <> 1
    or (select (s->>'current')::numeric from jsonb_array_elements(series) s where s->>'metric_key' = 'outreach.positive_replies') <> 2 then
    raise exception 'Dripify must show the sync''s sends plus the outcomes logged for it, and none of the logged batch, got %', series;
  end if;
  series := public.load_analytics_series(array['outreach.touches'], 'day', today - 6, today, 'linkedin/manual') -> 'series';
  if coalesce((series #>> '{0,current}')::numeric, 0) <> 0 then
    raise exception 'a logged batch''s channel must read nothing, got %', series;
  end if;

  ---------------------------------------------------------------------------
  -- Catalog: only the three channels; Dripify outcomes are typeable; unused
  -- outreach numbers are retired.
  ---------------------------------------------------------------------------
  catalog := public.load_analytics_catalog();
  select value->'dimensions' into dimensions from jsonb_array_elements(catalog->'metrics') where value->>'metric_key' = 'outreach.touches';
  if dimensions <> '["linkedin/dripify", "phone/cold_call", "reddit/dm"]'::jsonb then
    raise exception 'the Channel filter must list exactly the three channels with numbers, got %', dimensions;
  end if;
  if (select count(*) from jsonb_array_elements(catalog->'metrics') m
      where m->>'metric_key' in ('dripify.positive_replies', 'dripify.calls_booked') and m->>'entry_mode' = 'manual') <> 2 then
    raise exception 'Dripify positive replies and calls booked must be typeable in Log numbers';
  end if;
  if exists (select 1 from jsonb_array_elements(catalog->'metrics') m where m->>'metric_key' in ('outreach.follow_ups', 'outreach.initial_dms')) then
    raise exception 'follow-ups and first messages must be retired';
  end if;
  if (select m->>'label' from jsonb_array_elements(catalog->'metrics') m where m->>'metric_key' = 'outreach.reply_base') <> 'People reached' then
    raise exception 'the reply base must read as people reached';
  end if;

  ---------------------------------------------------------------------------
  -- The overview shows the same totals; the batch funnel (A/B tests) still
  -- reads the batches.
  ---------------------------------------------------------------------------
  item := public.load_admin_analytics();
  if (item #>> '{metrics,outreach_current}')::numeric <> 92 or (item #>> '{metrics,replies_current}')::numeric <> 8
    or (item #>> '{metrics,reply_base_current}')::numeric <> 92 then
    raise exception 'the overview must show the three channels, got %', item->'metrics';
  end if;
  if (select sum((t->>'outreach')::numeric) from jsonb_array_elements(item->'trend') t) <> 92 then
    raise exception 'the overview trend must show the three channels, got %', item->'trend';
  end if;
  -- Batch calls 2 + 1 + 1, unlike the channels' 3.
  if (item #>> '{outreach,calls_booked}')::numeric <> 4 then
    raise exception 'the batch funnel reads logged batches only, got %', item->'outreach';
  end if;

  raise notice 'outreach totals regressions passed: Dripify, Reddit DMs and cold calls only';
end;
$$;
rollback;
