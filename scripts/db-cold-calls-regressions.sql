-- Synthetic, transactional fixtures for cold-call tracking. Root harness runs
-- only in isolated local Postgres.
begin;
do $$
declare
  today date := (now() at time zone 'UTC')::date;
  payload jsonb; failed boolean;
  series jsonb;
begin
  ---------------------------------------------------------------------------
  -- The six logged numbers exist, are outreach, and are typed in by hand.
  ---------------------------------------------------------------------------
  if (select count(*) from public.analytics_metric_definitions
      where source = 'cold_calls' and entry_mode = 'manual' and category = 'outreach' and unit = 'count' and aggregation = 'sum' and active) <> 6 then
    raise exception 'cold calls need six hand-logged daily counts';
  end if;
  if (select higher_is_better from public.analytics_metric_definitions where metric_key = 'cold_calls.negative_replies') then
    raise exception 'fewer negative replies is better';
  end if;

  ---------------------------------------------------------------------------
  -- Rates are per call made and computed, never written.
  ---------------------------------------------------------------------------
  perform public.upsert_analytics_metric_values(jsonb_build_array(
    jsonb_build_object('metricKey', 'cold_calls.dials', 'date', today - 2, 'value', 30),
    jsonb_build_object('metricKey', 'cold_calls.dials', 'date', today - 1, 'value', 50),
    jsonb_build_object('metricKey', 'cold_calls.positive_replies', 'date', today - 1, 'value', 4),
    jsonb_build_object('metricKey', 'cold_calls.neutral_replies', 'date', today - 1, 'value', 3),
    jsonb_build_object('metricKey', 'cold_calls.negative_replies', 'date', today - 1, 'value', 5),
    jsonb_build_object('metricKey', 'cold_calls.follow_ups', 'date', today - 1, 'value', 3),
    jsonb_build_object('metricKey', 'cold_calls.meetings_booked', 'date', today, 'value', 2)
  ), 'manual', 'admin');
  payload := public.load_analytics_series(array['cold_calls.positive_rate', 'cold_calls.meeting_rate', 'cold_calls.dials'], 'day', today - 6, today);
  series := payload -> 'series';
  if (select (s ->> 'current')::numeric from jsonb_array_elements(series) s where s ->> 'metric_key' = 'cold_calls.positive_rate') <> 0.05 then
    raise exception 'positive reply rate must be positive replies over calls made, got %', series;
  end if;
  if (select (s ->> 'current')::numeric from jsonb_array_elements(series) s where s ->> 'metric_key' = 'cold_calls.meeting_rate') <> 0.025 then
    raise exception 'meeting rate must be meetings booked over calls made, got %', series;
  end if;
  if (select (s ->> 'current')::numeric from jsonb_array_elements(series) s where s ->> 'metric_key' = 'cold_calls.dials') <> 80 then
    raise exception 'calls made must add up over the range, got %', series;
  end if;
  begin
    perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', 'cold_calls.meeting_rate', 'date', today, 'value', 0.5)), 'manual', 'admin');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'cold-call rates must never be written directly'; end if;
  begin
    perform public.upsert_analytics_metric_values(jsonb_build_array(jsonb_build_object('metricKey', 'cold_calls.dials', 'date', today, 'value', 2.5)), 'manual', 'admin');
    failed := false;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'calls made must be whole numbers'; end if;

  raise notice 'cold-call regressions passed: definitions, per-call rates, whole counts';
end;
$$;
rollback;
