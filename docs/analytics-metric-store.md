# Analytics metric store

The control desk's **Trends** section charts every number the business runs on, from Ajani Flow's own funnel to outreach, content platforms and revenue, at day, week, month, quarter or year grain. This document describes how the numbers are stored and how to add new ones.

Migrations: `supabase/migrations/20261016000000_outreach_measurement_accuracy.sql` and `20261016010000_analytics_metric_store.sql`. Regression suite: `scripts/db-metrics-regressions.sql` (run by `npm run test:database`).

## Model

| Piece | Role |
|---|---|
| `analytics_metric_definitions` | The catalog: key (`source.name`), label, unit, **aggregation**, entry mode. |
| `analytics_metric_daily` | Manual and connector values: one row per metric, UTC day and account (`dimension_key`, `''` = main account). |
| `analytics_daily_values()` | Internal union of stored values and **live-derived** Ajani metrics (drafts, builds, workspaces, outreach). |
| `load_analytics_series()` | Rolls daily values up to the requested grain and compares with the previous equal-length window. |
| `load_analytics_catalog()` | Definitions, coverage dates, available accounts/channels, recent manual entries. |
| `upsert_analytics_metric_values()` / `delete_analytics_metric_value()` | The only write paths. Validating and audited in `admin_activity_log`. |

All functions are `security definer`, revoked from `anon`/`authenticated`, and executable by `service_role` only. `service_role` can read the tables but cannot write them directly, so every write goes through validation.

### Aggregation decides how a metric rolls up

- **`sum` (flows):** views, touches, cash collected. Bucket value = sum of its days. Derived flows are zero on quiet days. Recorded flows stay **null (unknown)** when nothing was entered, never zero.
- **`last` (stocks):** followers, MRR, active clients. Bucket value = each account's latest value on or before the bucket end, **carried forward** until a newer value is recorded, summed across accounts.
- **`ratio` (rates):** always `sum/last(numerator) ÷ sum/last(denominator)` over the bucket. Never an average of daily rates. The numerator and denominator are returned with every point so the UI can show "12 of 340".

Weeks start on Monday (ISO). Days are UTC calendar days, matching the existing cohort and outreach analytics. The current period is flagged `partial` and compared like-for-like: the comparison window is the same number of days immediately before the range.

### Idempotent writes

`(metric_key, metric_date, dimension_key)` is the primary key. Re-entering or re-syncing a day **replaces** its value. Writing an identical value is a no-op and is not audited again. This is what keeps the totals free of double counting.

## Measurement accuracy fixes (same release)

- **Reply rate cannot exceed 100%.** `outreach_batch_metrics.reply_base` records the exposure that replies are measured against: unique initial DMs for batch rows, and sends at the tested step for experiment entries. Aggregate reply rate = `replies ÷ reply_base`. Historical rows are backfilled; experiment entries are identified through their `experiment_metric_snapshot` audit rows.
- **Corrections are voids.** `void_outreach_batch` keeps the row for audit but removes it from every total, list, count and derived trend. Entries remain additive by design: each entry is new activity.
- **Database validation restored.** `create_outreach_batch` again rejects inconsistent counts, foreign variants and inactive experiments at the database layer, not only in Zod.
- **Failed saves no longer inflate saved briefs.** When a request save fails before its capability is returned, `discard_unpublished_request_draft` removes the draft *and* its cohort contribution. Retention deletes still never change cohort counts.

## Adding a metric

1. Insert a definition in a new migration. Pick the aggregation by asking: does it add up over time (`sum`), is it a level (`last`), or is it a rate (`ratio` with numerator/denominator keys)?
2. Manual metrics (`entry_mode = 'manual'`) appear automatically in the "Log platform numbers" form for their source. To group a new source in the form, add it to `entryGroups` in `src/components/admin/metric-trends.tsx`.
3. A derived metric needs a block in `analytics_daily_values()`, guarded by `p_keys` so it only runs when requested.

## Writing a connector (Dripify, YouTube, TikTok, Stripe…)

A connector is a scheduled server job that calls `upsert_analytics_metric_values(values, 'connector', 'connector:<name>')` with one item per metric, day and account: `{ "metricKey": "dripify.leads_contacted", "date": "2026-10-16", "dimension": "<campaign-id>", "value": 412 }`.

- Use `entry_mode = 'connector'` for metrics only the integration may write. Manual entry is then refused.
- Store platform **cumulative stats as `last`** metrics (most APIs return current totals rather than history) and let the store build the history from daily snapshots.
- For platform-reported rates, store the numerator and denominator as separate `last` or `sum` metrics and define the rate as a `ratio`. Never store a percentage.
- Re-running a sync for the same day is safe, because the write is an upsert.
- Daily schedules fit the current Vercel Hobby cron limits.

## Release

Apply both migrations in order after the existing release gates in `docs/engineering-remediation-2026-09-05.md`. They are additive. The only data rewrite is the `reply_base` backfill on `outreach_batch_metrics`. The new `replies <= reply_base` check is added `NOT VALID` and validated only if historical rows already satisfy it, so it cannot fail on legacy data. Code and schema can deploy in either order:

- the dashboard falls back to the initial-DM basis when `reply_base` is absent;
- failed-save cleanup falls back to a plain delete when the discard RPC is missing;
- Trends shows an "apply the migrations" notice instead of zeros.
