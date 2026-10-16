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
| `load_analytics_catalog()` | Definitions, coverage dates, the 50 most recently recorded accounts/channels per metric, account display labels, recent manual entries. |
| `upsert_analytics_metric_values()` / `delete_analytics_metric_value()` | The only write paths. Validating and audited in `admin_activity_log`. |
| `analytics_dimension_labels` / `upsert_analytics_dimension_labels()` | Display names for connector accounts (Dripify campaign names). Display only; written by connectors. |

All functions are `security definer`, revoked from `anon`/`authenticated`, and executable by `service_role` only. `service_role` can read the tables but cannot write them directly, so every write goes through validation.

### Aggregation decides how a metric rolls up

- **`sum` (flows):** views, touches, cash collected. Bucket value = sum of its days. Derived flows are zero on quiet days. Recorded flows stay **null (unknown)** when nothing was entered, never zero.
- **`last` (stocks):** followers, MRR, active clients. Bucket value = each account's latest value on or before the bucket end, **carried forward** until a newer value is recorded, summed across accounts.
- **`ratio` (rates):** always `sum/last(numerator) ÷ sum/last(denominator)` over the bucket. Never an average of daily rates. The numerator and denominator are returned with every point so the UI can show "12 of 340".

**Unknown is never zero.** Three cases are returned as null and shown as "—":
- cohort metrics (briefs saved, brief → build) before cohort tracking began, because earlier rows only include drafts that survived retention, plus any comparison window reaching back before that date;
- recorded metrics with nothing entered;
- built-in metrics under an account or channel filter that does not apply to them.

Outreach breakdown keys are `channel/method` slugs, for example `linkedin/dripify`.

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
2. Manual metrics (`entry_mode = 'manual'`) appear automatically in the "Log platform numbers" form for their source. To give a new source its own tab, add it to `entryGroups` in `src/components/admin/metric-trends.tsx`; a tab shows only while its source has active manual metrics. To retire a metric, set `active = false`: its data is kept, and it leaves the catalog, the form and the charts.
3. A derived metric needs a block in `analytics_daily_values()`, guarded by `p_keys` so it only runs when requested.

## Writing a connector (Dripify, YouTube, TikTok, Stripe…)

A connector is a scheduled server job that calls `upsert_analytics_metric_values(values, 'connector', 'connector:<name>')` with one item per metric, day and account: `{ "metricKey": "dripify.leads_contacted", "date": "2026-10-16", "dimension": "<campaign-id>", "value": 412 }`.

- Use `entry_mode = 'connector'` for metrics only the integration may write. Manual entry is then refused.
- Store platform **cumulative stats as `last`** metrics (most APIs return current totals rather than history) and let the store build the history from daily snapshots.
- For platform-reported rates, store the numerator and denominator as separate `last` or `sum` metrics and define the rate as a `ratio`. Never store a percentage.
- Re-running a sync for the same day is safe, because the write is an upsert.
- Daily schedules fit the current Vercel Hobby cron limits.
- Give accounts a stable key (an ID, never a name) and send the display name through `upsert_analytics_dimension_labels(labels, actor)` with items `{ "dimension": "dripify:12345", "label": "Insurance owners TX" }`. The catalog returns `dimension_labels` for accounts that have data, and the Trends filter shows the name. A renamed account keeps one history; if the name were the key, the old key's last value would carry forward next to the new one and be counted twice.

## Dripify connector

Migration: `supabase/migrations/20261016020000_dripify_connector.sql`. Code: `src/lib/connectors/dripify.ts`. Schedule: `/api/cron/sync-dripify` at 22:00 UTC daily (Vercel Hobby fires within the hour, so a run always lands on the same UTC day, near its end). The control desk's **Dripify sync** panel runs the same job on demand and explains a rejected key or plan in plain language.

| Metric | Aggregation | From Dripify's `GET /campaigns/{id}/statistics` |
|---|---|---|
| `dripify.leads_total` | `last` per campaign | `totalLeads` |
| `dripify.leads_contacted` | `last` per campaign | `contactedLeads` |
| `dripify.leads_accepted` | `last` per campaign | `acceptanceRateLeads` (leads who accepted) |
| `dripify.leads_replied` | `last` per campaign | `replyRateLeads` (leads who replied) |
| `dripify.acceptance_rate` | `ratio` | accepted ÷ contacted |
| `dripify.reply_rate` | `ratio` | replied ÷ contacted |

- **Exact counts only.** Dripify's `acceptanceRate` and `replyRate` are percentages rounded to one decimal, which cannot be added up across campaigns. The rates here are recomputed from the exact counts against leads contacted. That is the base Dripify itself uses, even though its API docs describe the rates as "of sent connection requests" and "of sent messages": on the live account on 2026-10-16, 120 accepted and 30 replied of 694 contacted were reported as 17.3% and 4.3%. The charts therefore match Dripify's screen, and they add up exactly across campaigns.
- **Rates are lifetime rates.** Each snapshot is a campaign's running total, so a bucket's rate is the campaign lifetime rate at the bucket's end. Growth in a period is the change in the totals.
- **Account key** `dripify:<campaign id>`, labelled with the campaign name. Draft campaigns are skipped. Paused and finished campaigns are still read, because replies keep arriving after a sequence ends. A deleted campaign keeps its last snapshot, so all-time totals still include the people it contacted.
- **Rate limits.** Dripify allows 60 requests a minute and 5,000 a day. One run makes at most 50 requests, active campaigns first. When there are more campaigns than that, the rest rotate in on later days and keep their last snapshot meanwhile; the run still counts as synced. A 429 pauses every request until `Retry-After`; a longer wait ends the run as partial.
- **Outcomes.** The cron returns 200 when synced or when no key is configured yet, and 503 when partial or rejected (bad key: 401, plan without the Open API: 403, Open API switched off: 404). A missing or malformed count is never stored as zero. The three counts the rates use (contacted, accepted, replied) are stored together or not at all: if one is missing or malformed, none are stored that day and the campaign counts as failed, so a rate never pairs a new count with a carried-forward one. Leads loaded feeds no rate and is stored whenever it is valid.
- **Privacy.** Only aggregate counts and campaign names are stored. No lead, prospect or message data is read.
- **Manual Dripify logs** in Outreach still feed `outreach.*` (channel `linkedin/dripify`). The connector feeds `dripify.*` separately, so neither double counts the other.

## Growth goals

Migration: `supabase/migrations/20261016030000_growth_goals.sql`. The Overview opens with a **Growth goals** panel: one card per active row of `analytics_goals`, measured live by `load_analytics_goals()`.

| Goal | Metric | Measure | Target | Window |
|---|---|---|---|---|
| Clients signed | `sales.deals_won` | `total` | 5 | Jul 12, 2026 – Jan 1, 2027 |
| Revenue collected | `revenue.cash_collected` | `total` | $5,000 | Jul 12, 2026 – Jan 1, 2027 |
| Monthly recurring revenue | `revenue.mrr` | `latest` | $2,000 | by Jan 1, 2027 |
| LinkedIn followers | `linkedin.followers` | `latest` | 4,000 | by Jan 1, 2027 |
| LinkedIn posts this week | `linkedin.posts_published` | `weekly` | 3 | every ISO week |

The first four come from the owner's Growth Goal Sheet, which tracks total revenue and monthly recurring revenue separately ("both have to hit target"). The weekly goal is the LinkedIn post system's 3–4 posts a week.

- **Measured like Trends.** Every goal calls `load_analytics_series()`, so a goal and a chart of the same metric and range always agree. `total` sums a `sum` metric at day grain from exactly the start date to today (or the due date). `latest` takes a `last` metric's newest value, every account added together, and reports the value the day before the goal began as its baseline. `weekly` sums the current ISO week (Monday to Sunday, UTC) at week grain and reports last week's total. A goal before its start date has no progress. Triggers keep a goal's measure and its metric's aggregation compatible, from both sides.
- **Pace** (`goalProgress()` in `src/lib/admin/metric-query.ts`) is a straight line from the start to the target on the due date: from zero for totals and weeks, and from the recorded baseline for latest values. A latest-value goal without a baseline shows progress but no on-pace or behind verdict. Counts round the expected value down. Nothing recorded stays "Not logged", never zero.
- **Changing a goal** is a row update in `analytics_goals` (target, dates, `active`). Deadlines are at most two years out, and weekly goals have none.

## Metric review (2026-10-16)

The catalog was checked against the owner's notes, the Growth Goal Sheet and the Dripify, LinkedIn and content system notes, and the calculations were audited. `20261016030000` applies the result:

- **Definitions now match the owner's terms.** `sales.deals_won` is "Clients signed" (signed and paid the first invoice). Calls booked count only once Calendly confirms the booking. MRR excludes setup fees and pilots, and active clients is distinct from total signed. `linkedin.engagements` follows LinkedIn's own definition, and `outreach.reply_base` is labelled "Reply base".
- **Dripify rates are labelled lifetime.** They cover each campaign's whole life, so Trends says "lifetime to date" instead of "in range".
- **Added numbers:** Instagram saves and shares, LinkedIn reactions and comments, Reddit views and posts published, and "Leads from content" (qualified DMs or conversations from posts or videos, the content metric the notes rank first).
- **X retired.** No note shows X in use. Its definitions are inactive and their data is kept.
- **Overview money cards removed.** "Quoted pipeline" and "Monthly retainers" read `build_request_quotes` and `billing_subscriptions`, which nothing writes, so they always showed $0. The goals panel shows the revenue the owner logs.
- **Accounts are picked, not typed.** The entry form lists existing accounts plus "Add another account…". A handle typed two ways would otherwise become two accounts whose followers add up forever. Sales and revenue have no account field.
- **Trends defaults follow the goals:** clients signed, revenue collected, MRR, LinkedIn followers, calls booked, Dripify reply rate, outreach touches and briefs saved. The saved-view key moved to `ajani_admin_trends_v2`.

Known limits, not changed: brief → build conversion reads low for the newest periods because recent briefs have had less time to convert. Comparisons assume manual numbers are logged as regularly in both windows. Outreach periods before the first logged batch read 0. Entry dates default to the UTC day.

## Release

Apply the four migrations in order (`20261016000000`, `20261016010000`, `20261016020000`, `20261016030000`) after the existing release gates in `docs/engineering-remediation-2026-09-05.md`. They are additive. The only data rewrite is the `reply_base` backfill on `outreach_batch_metrics`. The new `replies <= reply_base` check is added `NOT VALID` and validated only if historical rows already satisfy it, so it cannot fail on legacy data. Code and schema can deploy in either order:

- the dashboard falls back to the initial-DM basis when `reply_base` is absent;
- failed-save cleanup falls back to a plain delete when the discard RPC is missing;
- Trends shows an "apply the migrations" notice instead of zeros;
- the Overview shows a "Goals unavailable" notice until `20261016030000` is applied.

On the live project, the first three were applied on 2026-10-16 (see `docs/agent-handoff-2026-10-16.md` §4).
