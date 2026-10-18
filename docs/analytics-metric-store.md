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

### Dripify dashboard parity (`20261016050000`)

Dripify's own dashboard (help center, 2026-10-16) shows activity in a period next to lifetime rates, a progress bar of leads entered per campaign, lead statuses, and unread inbox messages. The connector now records all of it from the same official Open API calls, plus one `GET /teams` request per run:

| Metric | Aggregation | Source |
|---|---|---|
| `dripify.new_contacted`, `new_accepted`, `new_replies` | `sum` per campaign | change in the running total since the campaign's previous sync |
| `dripify.period_acceptance_rate`, `period_reply_rate` | `ratio` | new accepted or new replies ÷ new contacted in the range |
| `dripify.leads_remaining` | `last` per campaign | `totalLeads − contactedLeads` (Dripify's progress bar) |
| `dripify.leads_in_progress`, `leads_finished`, `leads_failed` | `last` per campaign | `leadStatusBreakdown` |
| `dripify.unread_messages`, `active_campaigns` | `last` per team (`dripify-team:<id>`) | `GET /teams` → `statistics` |

- **New activity** is today's running total minus the latest total recorded before today (`load_analytics_latest_values(keys, before)`, indexed by metric, account and newest day), written on the sync day. The three are written together or not at all, so a period rate never pairs new acceptances with missing contacts. Re-syncing the same day recomputes from the same starting point. A campaign's first sync, any total that went down, or an unreadable history stays unknown; nothing is guessed. Limitation: once written, a day's figure stays if a later same-day sync finds a total went down (the next day starts fresh). A campaign deferred by the request budget gets several days' activity on the day it is next read, so period totals stay exact while single days can lump.
- **Gone campaigns and teams.** "Right now" counts (`leads_in_progress`, `leads_remaining`, `unread_messages`, `active_campaigns`) are set to 0 once, after a complete listing no longer has the campaign or team, so Trends stops carrying them forward. Lifetime totals keep their last snapshot on purpose. A campaign repeated across listing pages is read once.
- **Period rates** are cohort-free: acceptances and replies arrive days after the invite, so a short range can read high or low. The lifetime rates remain the reference.
- **Control desk.** Connections → Dripify shows the latest sync day, unread messages, active campaigns, and campaigns still sending (in progress > 0) with fewer than 40 leads not yet contacted. Campaigns that last synced more than a week before the newest sync are ignored. Before the migration it says the sync status is unavailable instead of "not synced".
- **Not available through the API**, so not tracked: per-step sends (invites, messages, follow-ups, InMails, endorsements, profile views) per day. Dripify's per-lead activity endpoint has them, but reading it per lead does not fit 60 requests a minute inside one Vercel Hobby run, and it returns lead details the store must not keep.

## Platform connectors (`20261016040000`)

Code: `src/lib/connectors/` (`provider-http.ts`, `youtube.ts`, `instagram.ts`, `credential-vault.ts`, `registry.ts`, `ingest.ts`). Schedule: `/api/cron/sync-platforms` at 22:30 UTC daily. The control desk's **Connections** section (07) shows each connector's settings by name (set, missing or wrong format, never values), its last run, and a Sync now button. Each run is logged in `analytics_connector_runs` as a status and a fixed reason token, pruned after 90 days.

- **YouTube.** `YOUTUBE_API_KEY` + `YOUTUBE_CHANNEL_ID` (a `UC…` ID or `@handle`) give public numbers: `youtube.subscribers` (YouTube rounds to three significant figures), `youtube.total_views`, and `youtube.videos_published` per day for the last 14 days. Adding `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN` (scopes `yt-analytics.readonly` and `youtube.readonly`, app set to "In production" so the refresh token does not lapse after 7 days) adds YouTube Analytics for the last 7 complete days: views, watch hours, likes, comments, shares, subscribers gained and lost, and Shorts views. A lapsed sign-in falls back to the public numbers and reports `token_expired`. Impressions and click-through rate are only in the Reporting API's bulk files and are not read.
- **Instagram.** `INSTAGRAM_ACCESS_TOKEN` (Instagram API with Instagram Login, professional account, `instagram_business_basic` + `instagram_business_manage_insights`) gives followers, posts per day (14 days), and per-UTC-day insights for the 3 days before today: reach, views, interactions, likes, comments, shares, saves and link taps. A metric the account cannot report is learned on the first day and skipped after; a day refused outright costs later days one combined request each, not eight single ones. Tokens last 60 days: with `CONNECTOR_ENCRYPTION_KEY` (64 hex characters) the connector renews within 20 days of expiry and keeps the new token sealed (AES-256-GCM, connector name as associated data) in `analytics_connector_credentials`. A token pasted into the setting later always wins. Profile visits left the API in 2025 and stay manual.
- **Reddit.** Reddit stops approving API access after 2026-10-31 and retires the public API; chat (where DMs live) has no API, and post views are not exposed. Reddit is manual: views, posts, upvotes, comments and karma, plus outreach `reddit.dms_sent`, `reddit.dm_replies`, `reddit.dm_calls_booked` and the derived `reddit.dm_reply_rate`.
- **Unknown stays unknown.** Hidden, missing or malformed counts are skipped. A listing (uploads, posts) records zero days only when read in full; when cut short, only days after the oldest item seen count. A response without its list is a failed read. Shorts views are zero only for days the content-type report covers.
- **Writes** go through `upsert_analytics_metric_values(..., 'connector', 'connector:<name>')` for the owner's main account (dimension `''`), so a synced day replaces a typed one. A store refusal is reported as `save_failed`.

### Private ingest endpoint

`POST /api/metrics/ingest` with `Authorization: Bearer <AJANI_METRICS_INGEST_KEY>` (at least 32 characters; otherwise the route answers 404) lets the owner's own automations send daily totals: `{"values":[{"metricKey":"reddit.dms_sent","date":"2026-10-15","value":12}]}`. Least privilege: YouTube, Instagram, Reddit, TikTok and LinkedIn metrics only; the main account only (an account name could carry a prospect's handle); the last 35 UTC days; at most 200 values and 64 KB; strict fields. Values are written as **manual** entries (actor `connector:ingest`), so the store refuses connector-only metrics and every row shows under recent entries and can be deleted. Errors never echo submitted values or database text.

### Security model

- Provider calls go through one client: HTTPS to an exact host allowlist (pagination links included), `redirect: "error"`, a request budget, a deadline with write time held back, response bodies capped while streaming (2 MB, error bodies 20 KB), Retry-After capped at 15 s, and errors reduced to a status and a short code token.
- Keys travel in headers (`x-goog-api-key`, `Authorization`) except Instagram's, which Meta's Graph API takes as `access_token` in the query string; no URL is ever logged or returned.
- Tables are RLS-on with all grants revoked; security-definer RPCs with `search_path = ''` are granted to `service_role` only. Browser-facing code receives setting names, booleans, counts and fixed messages.

## Report import (Instagram)

Code: `src/lib/admin/report-import.ts`, `src/app/admin/reports/read/route.ts`, `saveReportValuesAction` in `src/app/admin/actions.ts`, `src/components/admin/report-import.tsx`. Trends → Log numbers → Instagram → **Import a report** takes Muse reports, Instagram exports or screenshots (PDF, CSV, text, PNG, JPEG or WEBP; up to 10 files at a time, 4 MB each). An agent reads the day-by-day numbers, the owner checks them, then saves.

- **Several files** (`src/lib/admin/report-merge.ts`). The browser sends each file as its own read (three at a time), so every request stays under Vercel's 4.5 MB body limit and its own 60-second budget. Files over 4 MB are not sent. The answers are combined into one review table that names each number's file. Two files giving the same number for a metric and day count once. Two files giving different numbers drop that day, listed under "Not imported", as within one file. A file that fails is named with its reason, and the others still show. The save takes up to 1,200 rows and writes them in batches of 500, the store's limit. When a later batch fails, the message says how many were saved; saving again finishes, because rows already saved are replaced.

- **Reading saves nothing.** `POST /admin/reports/read` (admin session; 409 in sample mode) checks the file's leading bytes, not its name, asks Claude for the numbers, and returns rows `{metricKey, date, value, evidence}` plus what was left out and why. The file is not kept. The owner unticks anything wrong; `saveReportValuesAction` checks the rows again (strict fields, no repeated metric and day, 1–1,200 rows) and writes them with `upsert_analytics_metric_values(..., 'manual', <admin user>)` for the main account. A day already logged is replaced, and every row shows under recent entries and can be deleted.
- **Exact daily numbers only.** Instagram's manual count metrics: followers, reach, views, interactions, likes, comments, shares, saves, posts published, profile visits and link taps (contact-button taps included). The instructions forbid splitting 7, 30 or 90-day totals into days, reading values off chart bars, and treating a post's lifetime likes as daily activity. Posts per day come only from a complete post list. The code then drops rows for metrics the charts don't track, unreadable or future dates, dates more than 100 days back, and numbers that aren't whole and non-negative. When a report gives two different numbers for one day, it keeps neither.
- **The report is data, not instructions.** It is sent as a file part (text inside a `<report>` block) under instructions to ignore any instructions it contains, and the answer must match a zod schema. Logs record counts only.
- **Model.** Same provider order as the rest of the site: direct Anthropic first when `AI_PRIMARY_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` is set (`REPORT_IMPORT_ANTHROPIC_MODEL`, default `claude-opus-5-5`), otherwise the AI Gateway (`REPORT_IMPORT_MODEL`, default `anthropic/claude-sonnet-5`, Anthropic only, prompt training disallowed). If neither answers, the screen asks to check the Anthropic key or type the numbers in. The Gateway's free tier cannot call Claude models.
- **What to ask Muse.** Muse has no API, so the screen carries a copyable prompt (`MUSE_PROMPT`) for a 30-day daily CSV with fixed columns, blanks instead of estimates, the time zone, and window totals in a separate table. Muse's Oct 17, 2026 summary PDF yielded only today's followers, posts per day and two printed daily reach values (Oct 8 and 9). Every other figure was a window total. Muse also reported no daily follower history, so follower trends start from the counts logged from now on.

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
- **Trends defaults follow the goals:** clients signed, revenue collected, MRR, LinkedIn followers, calls booked, Dripify reply rate, outreach touches and briefs saved. The saved-view key moved to `ajani_admin_trends_v2`. The Trends rebuild later moved it to `ajani_admin_trends_v3`, with up to 8 picks per view; it migrates v2 picks into the "Key numbers" view and keeps saved keys even while the catalog is unavailable.

Known limits, not changed: brief → build conversion reads low for the newest periods because recent briefs have had less time to convert. Comparisons assume manual numbers are logged as regularly in both windows. Outreach periods before the first logged batch read 0. Entry dates default to the UTC day.

## Sample data mode

The sidebar switch **SAMPLE DATA** shows every section filled with made-up numbers, so the owner can see each chart before the real data exists. Nothing is ever written.

- **Offered while tracking is new.** Until any logged or synced number goes back 14 days, or outreach has been logged on 14 days (`isEarlyTracking`), every section except Connections shows "Just getting started" with a SHOW SAMPLE DATA button. The sidebar switch alone was easy to miss.
- **Switch.** `setSampleModeAction` sets the cookie `ajani_admin_sample=1` (httpOnly, SameSite strict, `path=/admin`, 8 hours). Locking or unlocking the desk clears it, so every session starts on real numbers.
- **Rendering only.** `src/app/admin/(dashboard)/page.tsx` renders `sampleDashboardData`, `sampleGoalBoard` and `sampleMetricCatalog` from `src/lib/admin/sample-data.ts`. These are deterministic generators with no randomness and no real names. The real metric definitions are still read so Trends shows the same numbers. Connections always shows the real setup. A red banner stays on screen in every section.
- **Trends in the browser.** In sample mode the Trends client builds its series from a lazily imported `sample-data` and never calls `/admin/analytics/series`. If that route is called while the cookie is set, it answers 409. Such a request comes from a tab still showing real numbers, which must not chart made-up series.
- **Writes refuse twice over.** Every write action refuses when the cookie is set, and also when the form carries `sample=1`. Every form rendered in sample mode adds that field and disables its button. A tab left on sample data after the switch is turned off elsewhere therefore cannot save or delete real numbers. `actions.sample.test.ts` enumerates the exported actions, so a new unguarded write fails the suite.

## Release

Apply the four migrations in order (`20261016000000`, `20261016010000`, `20261016020000`, `20261016030000`) after the existing release gates in `docs/engineering-remediation-2026-09-05.md`. They are additive. The only data rewrite is the `reply_base` backfill on `outreach_batch_metrics`. The new `replies <= reply_base` check is added `NOT VALID` and validated only if historical rows already satisfy it, so it cannot fail on legacy data. Code and schema can deploy in either order:

- the dashboard falls back to the initial-DM basis when `reply_base` is absent;
- failed-save cleanup falls back to a plain delete when the discard RPC is missing;
- Trends shows an "apply the migrations" notice instead of zeros;
- the Overview shows a "Goals unavailable" notice until `20261016030000` is applied.

On the live project, the first four were applied on 2026-10-16 (see `docs/agent-handoff-2026-10-16.md` §4).

`20261016040000_platform_connectors.sql` and `20261016050000_dripify_dashboard_parity.sql` are additive (new tables, RPCs and metric definitions, four description updates). Until they are applied, the Connections section shows settings with a "sync history unavailable" notice, the Dripify card shows only whether a key is set, Dripify syncs write only the original four counts (they detect the missing history reader, which ships with the new metrics), and platform syncs report `save_failed` for metrics the store does not know yet.
