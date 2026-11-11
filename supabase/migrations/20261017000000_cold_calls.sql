-- Cold calls (2026-10-17).
--
-- The owner and anyone calling for the agency log each day's cold calls on
-- Trends: calls made, how the people who picked up replied (positive, neutral,
-- negative), how many asked for a follow-up, and meetings booked. Two rates
-- show the yield per call. Counts only; no prospect names or numbers.
--
-- Additive: new definitions only. Rates are computed by load_analytics_series
-- from their numerator and denominator, like every other ratio.
begin;

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('cold_calls.dials', 'cold_calls', 'outreach', 'Cold calls made', 'Cold calls dialled, whether or not anyone answered, on the day you made them.', 'count', 'sum', null, null, 'manual', true, true, 30),
  ('cold_calls.positive_replies', 'cold_calls', 'outreach', 'Cold call positive replies', 'People who picked up and were interested: wanted to hear more, asked for details or agreed to a next step.', 'count', 'sum', null, null, 'manual', true, true, 31),
  ('cold_calls.neutral_replies', 'cold_calls', 'outreach', 'Cold call neutral replies', 'People who picked up and were neither interested nor against: unsure, busy, or asked you to send something.', 'count', 'sum', null, null, 'manual', true, true, 32),
  ('cold_calls.negative_replies', 'cold_calls', 'outreach', 'Cold call negative replies', 'People who picked up and said no, or asked not to be called again.', 'count', 'sum', null, null, 'manual', false, true, 33),
  ('cold_calls.follow_ups', 'cold_calls', 'outreach', 'Cold call follow-ups', 'People who asked you to call or message them back later. Also count their reply above.', 'count', 'sum', null, null, 'manual', true, true, 34),
  ('cold_calls.meetings_booked', 'cold_calls', 'outreach', 'Cold call meetings booked', 'Sales calls or meetings set up from a cold call. Count one only once Calendly confirms the booking.', 'count', 'sum', null, null, 'manual', true, true, 35);

insert into public.analytics_metric_definitions
  (metric_key, source, category, label, description, unit, aggregation, numerator_key, denominator_key, entry_mode, higher_is_better, chartable, sort_order)
values
  ('cold_calls.positive_rate', 'cold_calls', 'outreach', 'Cold call positive reply rate', 'Positive replies ÷ cold calls made.', 'ratio', 'ratio', 'cold_calls.positive_replies', 'cold_calls.dials', 'derived', true, true, 37),
  ('cold_calls.meeting_rate', 'cold_calls', 'outreach', 'Cold call meeting rate', 'Meetings booked ÷ cold calls made. A meeting can be booked days after the call, so a short range can read high or low.', 'ratio', 'ratio', 'cold_calls.meetings_booked', 'cold_calls.dials', 'derived', true, true, 37);

commit;
