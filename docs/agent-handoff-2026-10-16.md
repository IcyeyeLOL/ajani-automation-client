# Agent handoff: analytics backend (2026-10-16)

Read this first, then `docs/analytics-metric-store.md`. `docs/next-agent-implementation-plan.md` is older, and its "Current Baseline" section is out of date. It describes mock portal data, no tests, and `/api/build-requests`, none of which match the current code.

## 1. Who and what

- **Owner.** Runs Ajani Automation, a done-for-you automation agency. The product is **Ajani Flow** (ajaniflow.com). Messages are voice-dictated, so expect transcription slips: "Johnny Flow" means Ajani Flow.
- **Communication.** The owner is not a developer. Explain outcomes in plain language, keep jargon out, and ask one focused question at a time.
- **Goal.** Make Ajani Flow's backend the business's **single analytics database**: outreach (Dripify and manual), YouTube, TikTok and other platforms, the request funnel and revenue. Every number should trend from **days to weeks, months and years**, with charts.
- **Explicit ask.** "Very optimized system, not a bad one." Correctness and performance matter more than speed of delivery.

## 2. Repositories

| Repo | State |
|---|---|
| `IcyeyeLOL/ajani-automation-client` | **The real codebase.** Frontend and backend: Next.js 16 App Router, Supabase Postgres/Storage, Clerk, Vercel. Work here. |
| `IcyeyeLOL/ajani-automation-app` | Empty. |
| `IcyeyeLOL/ajani-automation` | README only. |
| `IcyeyeLOL/ajani-lead-discovery` | Separate Node pipeline. It finds insurance-agency leads (People Data Labs, Google Places, state registries), scores them, and writes to Google Sheets. See §7. |
| `riteshkv16/Agent-Rise-Vault` | The owner's **mentor's** repo, meant as a reference for "what we should track". **Private and not accessible:** `add_repo` failed and the public URL returns 404. The owner downloaded a ZIP and was told to upload it to a new private repo on their own account. **Pending:** ask for the repo name, attach it with `add_repo`, and compare its tracked metrics with the catalog. |

**Branch:** `claude/exciting-bardeen-3j7j3m`. It was pushed with these commits on top of `main` (`e51ffe4`):

- `07dfab3` Add day-to-year business trends and fix outreach measurement
- `ffd10e8` Harden trends after review: coverage, filters, entry form, scale

**No PR has been opened.** The owner was asked whether to open one and has not answered. Do not open a PR unless asked.

## 3. What was built (steps 1–2 of the plan)

**Measurement fixes**, in `supabase/migrations/20261016000000_outreach_measurement_accuracy.sql`:

- **Reply-rate base.** `outreach_batch_metrics.reply_base` is the exposure that replies are measured against. A BEFORE INSERT trigger defaults it to `initial_dms` for older writers. The check `replies <= reply_base` is added NOT VALID and validated only when the data is clean. Historical rows are backfilled, with experiment entries detected through `admin_activity_log.entity_type = 'experiment_metric_snapshot'`. The aggregate reply rate is now `replies ÷ reply_base`, which caps it at 100%.
- **Voiding.** `void_outreach_batch(batch, reason, actor)` sets the `voided_at/by/reason` columns. Every analytics read excludes voided rows. Outreach entries stay additive by design.
- **Validation restored.** `create_outreach_batch` again validates inputs in the database: experiment active, variant ownership, consistent counts, at least one activity. It also lowercases channel and method.
- **Failed saves.** `discard_unpublished_request_draft(draft)` deletes a just-created, unpublished draft and decrements `request_cohort_daily`. `src/app/api/request-drafts/route.ts` calls it through `discardUnpublishedDraft()` and falls back to a plain delete if the RPC is missing or errors.
- **Admin analytics.** `load_admin_analytics` was redefined to exclude voided batches and to expose `reply_base` and `reply_base_current`.

**Metric store**, in `supabase/migrations/20261016010000_analytics_metric_store.sql`. Full semantics are in `docs/analytics-metric-store.md`.

- **Tables.** `analytics_metric_definitions` is the catalog (about 50 seeded metrics). Aggregation is `sum` (flow), `last` (stock, carried forward per account and summed) or `ratio` (always recomputed from its numerator and denominator). `entry_mode` is `derived`, `manual` or `connector`. `analytics_metric_daily` holds stored values, keyed by `(metric_key, metric_date, dimension_key)`. Writes are idempotent upserts.
- **Derived metrics.** `analytics_daily_values()` computes the live `ajani.*` and `outreach.*` metrics from source tables. Outreach breakdown keys are `analytics_dimension_slug(channel)/slug(method)`, for example `linkedin/dripify`.
- **RPCs.** `load_analytics_series(keys[], grain, from, to, dimension)`, `load_analytics_catalog()`, `upsert_analytics_metric_values(values, origin, actor)` and `delete_analytics_metric_value(...)`. All are security definer with `search_path = ''`, revoked from anon and authenticated, and granted to `service_role` only. `service_role` can SELECT the tables but **cannot write them directly**; writes go through the RPCs.
- **Unknown is never zero.** Null is returned for:
  - cohort metrics before `admin_analytics_coverage.started_at`, and any comparison window that reaches back before it;
  - stored metrics with nothing recorded;
  - derived metrics under a dimension filter that does not apply to them.
- **Grains.** Day, week (ISO, Monday start), month, quarter and year, all in UTC. Buckets are capped at 732. The current period is marked `partial`. The comparison window has the same number of days and ends immediately before the range.

**Application code:**

- **Data layer.** `src/lib/admin/metric-types.ts` (shared types), `metric-query.ts` (Zod schemas, presets, formatting; pure and shared with the client) and `metrics.ts` (server-only loaders; `loadMetricCatalog` authorizes itself).
- **Series route.** `src/app/admin/analytics/series/route.ts` is a GET JSON endpoint. It lives under `/admin` **because the admin session cookie is scoped to `path=/admin`**. It authorizes with the non-redirecting `resolveAdminSession()` from `src/lib/admin/session.ts` (built on `resolveAdminClerkUser()`).
- **Server actions** (`src/app/admin/actions.ts`): `recordMetricValuesAction`, `deleteMetricValueAction`, `voidOutreachBatchAction`.
- **UI.** `src/components/admin/metric-trends.tsx` is the client Trends section: grain and range presets, pick up to 8 metrics, account/channel filter, one chart per metric (bars for flows, lines for stocks and rates), hover and keyboard readouts, table view, a manual entry form per platform, and recent entries with remove. It is wired into `admin-dashboard.tsx` as section 02, and the void control is in Outreach → Recent outreach. Styles are appended to `src/app/admin/admin.css`. The page loads the catalog in parallel with the dashboard data in `src/app/admin/(dashboard)/page.tsx`.

**Verification at `ffd10e8`:**

- lint, type-check, 230 unit tests and the production build pass;
- `npm run test:database` passes, including the new `scripts/db-metrics-regressions.sql` (mutation-checked: a deliberately wrong expected value fails the suite);
- all 145 Playwright tests pass;
- an independent review found no blockers, and its three should-fix items were fixed in `ffd10e8`.

## 4. Live database status and release blockers

1. **Production schema brought up to date on 2026-10-16, with the owner's approval.** The live site and the local `.env.local` both use Supabase project `cubmsmokqtlpbfxaucsg` (Postgres 17.6). Before: `npm run check:database-contract` found 7 of 20 required RPCs because seven migrations were missing (`20260902000000` through `20261016020000`). That broke Clerk webhooks, voice-note completion, the expired-draft cleanup cron, background demand analysis and admin analytics on the live site. Procedure: a full JSON backup of every public table plus the function, policy, constraint, index, trigger and grant definitions (29 tables, 103 rows, 22 functions), kept on the owner's PC outside the repo; a restore test of that backup into a throwaway local Postgres built from the migration chain (functions and columns matched exactly); a rehearsal of all seven migrations on that copy with smoke checks; then each migration applied live as one all-or-nothing request through the Supabase Management API and recorded in `supabase_migrations.schema_migrations` (32 rows, latest `20261016020000`). After: the contract check finds 20 of 20, and the first Dripify sync wrote the 2026-10-16 snapshot. The code on `main` stays compatible, because the October migrations only add objects or `create or replace` functions with unchanged signatures. One live behaviour change: `create_outreach_batch` now rejects more replies than their reply base.
2. **Database access.** The Supabase MCP server timed out in that session, so the owner provided a short-lived personal access token (`SUPABASE_ACCESS_TOKEN` in `ajani-automation/.env.local`) to revoke after use. Future sessions need their own access, and should apply any new migration the same way: backup, rehearsal, then apply.
3. **Growth goals applied on 2026-10-16, with the owner's approval.** `20261016030000_growth_goals.sql` came out of a review of the owner's Obsidian vault and an audit of the calculations (see `docs/analytics-metric-store.md` → "Growth goals" and "Metric review"). It was applied after a fresh backup and a rehearsal on a restored copy of the live data, whose structure matched the migration chain exactly. History: 33 rows. The contract check still finds 20 of 20. All five goals read "Not logged" until the owner logs clients, revenue, MRR, followers and posts.
4. **Platform connectors and Dripify parity applied on 2026-10-16, with the owner's approval.** `20261016040000_platform_connectors.sql` (YouTube and Instagram connectors, sealed token store, run log, Reddit content and DM metrics) and `20261016050000_dripify_dashboard_parity.sql` (Dripify new activity, leads remaining, statuses, unread messages, latest-value index) passed two review rounds (security and adversarial fake data), the local database suite, and a rehearsal on a restored copy of a fresh backup. Applied live after a second backup (189 rows, identical to the rehearsed copy). History: 35 rows. Live checks pass and the contract check finds 20 of 20. The deployed code is unchanged until a deploy is approved; the deployed Dripify cron keeps writing its original four counts, which the new schema accepts. New settings, all optional: `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `CONNECTOR_ENCRYPTION_KEY`, `AJANI_METRICS_INGEST_KEY` (see `.env.example` and `docs/analytics-metric-store.md` → "Platform connectors").
5. **Dripify study with REA.** The owner asked to study Dripify with REA (github.com/morluto/rea) and match its tracking (not its private API, not a LinkedIn sender). The metric map came from Dripify's help center and Open API reference; running REA itself (`npx rea-agents`) was blocked by the session's safety settings and needs the owner's go-ahead.
6. **Deployed on 2026-10-16, with the owner's approval.** `main` was fast-forwarded to `15253d9` after lint, type-check, 512 unit tests, a production build, 145 Playwright tests (isolated production build), the local database suite and the read-only contract check (20 of 20) all passed, and the branch preview built. The four daily crons are registered. A manual run of `/api/cron/sync-platforms` on production returned YouTube `synced` (51 values) and Instagram `not_configured`. YouTube private analytics use a Desktop OAuth client in Google Cloud project `ajani-analytics`; its consent screen is External and In production, but unverified. **Open gap, pre-existing:** Vercel has no `AJANI_ADMIN_ACCESS_KEY`, `AJANI_ADMIN_SESSION_SECRET` or `AJANI_ADMIN_EMAIL_ALLOWLIST`/`AJANI_ADMIN_USER_ID_ALLOWLIST`, so the live `/admin` shows the not-found page to every signed-in account; the owner has only used the control desk locally. The release included the control desk refresh, which needs no migration:
   - sample data mode (`docs/analytics-metric-store.md` → "Sample data mode")
   - the rebuilt Trends section, with views, period presets, cleaner chart cards and a folded "Log numbers" panel (`metric-trends.tsx`, `trend-card.tsx`, `metric-log.tsx`)
   - charts in Outreach, Experiments, Website funnel and Operations (`section-charts.tsx`, `chart-math.ts`)

   The nightly Dripify and platform crons use the same `CRON_SECRET` as the existing crons. Per the README, never push to `main` or deploy without explicit approval from the owner.
7. **2026-10-17: on the branch, not deployed.**
   - **Commits.** `ecdbabb` through `b321ec3` on `claude/exciting-bardeen-3j7j3m`, with lint, type-check, 555 unit tests, a production build and the local database suite (36 migrations) all passing:
     - **Import numbers** at the top of Trends, for any platform, sales and revenue (see `docs/analytics-metric-store.md` → "Import numbers").
     - **Cold calls** (`docs/analytics-metric-store.md` → "Cold calls").
     - **Logging notes** from a YouTube, Reddit and LinkedIn audit.
   - **Migration applied live on 2026-10-18** with the owner's explicit approval.
     - Before: a backup of the definitions and migration history (`Documents/ajani-database-backups/ajani-live-definitions-before-cold-calls-2026-10-18T15-59-09.json`; the full backup was blocked by the agent's safety check), and a rehearsal on a rebuilt copy that matched live exactly.
     - Applied as one transaction through the Management API and recorded in `supabase_migrations.schema_migrations`.
     - After: latest version `20261017000000`, 36 recorded, 100 definitions (8 cold calls), daily values unchanged at 181. The chart loader returns the cold-call series.
     - The one-off Supabase token was deleted locally; the owner should revoke it.
   - **TikTok removed (2026-10-18, owner request).** Migration `20261018000000_retire_tiktok.sql` sets its definitions inactive (data kept, like X), and the code drops the view, the log tab, the outreach channel option, sample data and ingest. The import reader now leaves a TikTok export out instead of putting its columns on LinkedIn or YouTube. Lint, type-check, 556 unit tests and the local database suite (37 migrations, `db-tiktok-retired-regressions.sql`) pass. **Not applied live yet**: it needs a new Supabase token and the owner's explicit go-ahead.
   - **Live admin access.** Vercel Production now has `AJANI_ADMIN_EMAIL_ALLOWLIST` (lime71129@gmail.com, lime17451@gmail.com), `AJANI_ADMIN_ACCESS_KEY` and `AJANI_ADMIN_SESSION_SECRET`, and live `/admin` reaches the key screen. The saved access key does not match the owner's copy ("The access key is not valid"). The owner was asked to replace it under Vercel → Environment Variables → Edit and redeploy. The agent's own write was blocked by the safety classifier. The local `.env.local` access key was changed to match the owner's copy.
   - **AI key.** The owner made a new Anthropic key and their billing is fine. It is in the local `.env.local` with `AI_PRIMARY_PROVIDER=anthropic`. A real run read the owner's Muse PDF correctly. Vercel's `ANTHROPIC_API_KEY` is 65 days old and probably the old rejected key; it must be replaced before the live import can use AI.
   - **YouTube channel.** The tracked channel is `UCr5_PR9yjdKV266rzB9GoFA` (@olakunleajani-q1d), which has 0 videos. The owner was asked whether they post on a different channel.
   - **Audit findings not yet fixed:**
     - The 8 manual YouTube metrics are also written by the connector. The proposed fix is a migration setting `entry_mode = 'connector'`.
     - "0 numbers changed" in Connections: the status RPC doesn't return `values_written`.
     - YouTube period comparisons read low while its data lags.
     - Reddit DMs can also be logged as an Outreach batch.
     - LinkedIn followers can inflate across stale or duplicate accounts.

## 5. Next work, in the owner's priority order

**Step 3: Dripify connector.** Built (code-complete and tested, not live). See `docs/analytics-metric-store.md` → "Dripify connector". Verified 2026-10-16: the host is `https://api.dripify.com/v1/open-api`, and a keyless or wrong-key call returns the documented 401 JSON. Per the OpenAPI spec embedded in the docs page, `acceptanceRateLeads` and `replyRateLeads` are the leads who **accepted** and **replied**, not the rate bases. On the live account, Dripify's percentages equal those counts ÷ `contactedLeads` (120 and 30 of 694 → 17.3% and 4.3%), so the design note below about using `acceptanceRateLeads` as the basis is superseded: rates divide exact counts by `contactedLeads` and match Dripify's screen. The owner's key works and the plan includes the Open API (one active campaign, two drafts); `DRIPIFY_API_KEY` is set in Vercel Production. The live database has every migration (see §4), and the first sync ran from the local control desk on 2026-10-16 (1 of 1 campaign, rates matching Dripify's screen). Remaining: deploy the code, which needs the owner's approval. The original brief follows for reference.

- **Setup.**
  - The owner should set `DRIPIFY_API_KEY` in Vercel → Project → Settings → Environment Variables. For live testing in a cloud session, add it as an environment secret or variable through the environment's Edit menu.
  - Never ask for the key in chat.
  - The Dripify API only works on the **Advanced and Pro plans**; confirm the owner's plan.
- **API (from the docs at https://api.dripify.com/).**
  - Auth header `X-Api-Key`; paths under `/v1/open-api`.
  - **Verify the host** before coding; the docs page didn't state it.
  - Endpoints: `GET /campaigns`, `GET /campaigns/{id}/statistics`, `GET /leads?campaignId=&status=`, `GET /leads/{id}/activity`, `GET /teams`, `GET /teams/{teamId}/members` (caller must be OWNER or MANAGER).
  - Campaign statistics fields: `totalLeads`, `contactedLeads`, `leadStatusBreakdown{inProgress, finished, failed, …}`, `acceptanceRate`, `acceptanceRateLeads`, `replyRate`, `replyRateLeads`. Team-member fields: `acceptanceRate`, `replyRate`, `activeCampaignsCount`, `unreadMessagesCount`.
  - Paging is cursor-based (`cursor`, `limit` ≤ 100, `nextCursor`). Rate limits are 60 requests per minute and 5,000 per day; 429 responses carry `Retry-After`.
  - There are no raw invite or reply counts, only rates plus lead counts.
- **Design.**
  - New `dripify.*` definitions with `entry_mode = 'connector'`, `dimension_key` = campaign id (or a slug).
  - Store cumulative stats as `last` metrics, for example `dripify.leads_total`, `dripify.leads_contacted`.
  - Store numerator and denominator for each rate, for example `accepted = round(acceptanceRate × acceptanceRateLeads)` with `acceptanceRateLeads` as the basis. Define `dripify.acceptance_rate` and `dripify.reply_rate` as `ratio` metrics. Never store percentages.
  - A daily cron route under `/api/cron/...` with the existing `Bearer CRON_SECRET` pattern, a deadline (`withinDeadline`), batched and bounded, writing through `upsert_analytics_metric_values(values, 'connector', 'connector:dripify')`. Upserts make re-runs safe.
  - Vercel Hobby allows daily crons only (see `vercel.json`).
  - Store aggregates only; no prospect personal data (see §6 legal).
- **Mapping.** Manual "Dripify" outreach rows already exist in `outreach_batches` (`method = 'dripify'`). Keep both: manual logs feed `outreach.*`, the connector feeds `dripify.*`. Decide with the owner whether to stop manual Dripify logging once the sync is live.

**Step 4: YouTube and TikTok connectors.** Unverified, so research before building.

- **YouTube** likely needs the YouTube Analytics and Data APIs with OAuth by the channel owner.
- **TikTok** needs an approved developer app, and its API is more limited.
- Manual entry for `youtube.*`, `tiktok.*`, `instagram.*`, `linkedin.*` and `x.*` metrics already works. Connectors should write the **same keys** with `origin = 'connector'`, and may need a separate `entry_mode` or a policy decision if both manual and connector writers exist.

**Step 5: Revenue and delivery.**

- Stripe is in `package.json` but **no code imports it**. `billing_subscriptions`, `invoices`, `build_request_quotes` and `pricing_modules` exist but nothing writes them.
- `build_requests.status` never moves past `in_review`, and the only `build_events` row ever written is `request_submitted`. Admin has no build list, detail view or status actions; the notification email's "Open full brief in Ajani admin" link goes to a bare `/admin`.
- Manual `revenue.*` and `sales.*` metrics exist meanwhile.

**Step 6: Attribution and lead discovery.**

- Request drafts carry no source or UTM field.
- Options from the review: push daily discovery totals into the metric store as `leads.*` connector metrics (fastest); later add prospect tables or opaque tracking tokens. Prospect tables raise privacy and retention issues.

## 6. Known pre-existing gaps (not fixed, by scope)

- **Background jobs run daily.** `vercel.json` runs the crons once a day (Hobby limit), but the README and remediation docs claim every minute and every 15 minutes. `/api/cron/send-build-notifications` is never scheduled; `process-intake-jobs` covers notifications, so it is redundant rather than broken.
- **AI usage isn't fully tracked.** Clarify/shape AI calls (`src/lib/ai/automation-workflow.ts`) do not persist token usage, cost or latency. `estimated_cost_usd` is never written. Demand-extraction failures are stored as `skipped`, so they never reach "attention".
- **No alerting.** `queue_recovery_health` is only written to the log.
- **RLS is not exercised.** Every read uses the service-role client with app-level `organization_id` filters, and `createClerkServerClient` is unused. New analytics reads must keep doing server-side scoping.
- **Experiment peeking.** The experiment z-test is re-checked on every 60-second refresh, with no correction for repeated looks.
- **Timing-unsafe compare.** The cron secret is compared with `!==`; `keysMatch` in `src/lib/admin/session-token.ts` is available.
- **Legal and privacy** (`docs/legal-readiness-review.md`). The retention schedule is an open P1. **Dripify is not on the subprocessors list** (`src/app/subprocessors/page.tsx`). Adding platform connectors may need privacy-page and subprocessor updates. Keep analytics aggregate-only; the cohort tables intentionally store no client text or identity.
- **Lead-discovery repo issues:**
  - Google Places leads almost always "qualify": the fabricated title "Agency Owner" is worth +4.
  - The Sheets append isn't idempotent: IDs are new each run, so leads duplicate daily.
  - The PM2 `--cron` instructions lack `--no-autorestart`, which risks a restart loop that burns API credits.
  - Outreach emails have no unsubscribe link or postal address (CAN-SPAM). Sending is off by default.
  - The ZeroBounce key is passed in the URL query, which can leak into logs.
  - Email verification fails open.

## 7. Conventions and gotchas

- **Read the Next.js docs first.** `AGENTS.md` says to read `node_modules/next/dist/docs/` before writing Next code. This is Next 16: middleware is `src/proxy.ts`, and GET route handlers are dynamic by default (Cache Components are not enabled).
- **Admin authorization.** It needs both a Clerk allowlist match and an HMAC cookie set with the access key, at `path=/admin`. Use `requireAdminSession()` in pages and actions, and `resolveAdminSession()` in JSON routes.
- **Database conventions.**
  - New RPCs follow the existing pattern: `security definer`, `set search_path = ''`, revoke from public, anon and authenticated, grant to `service_role`. Do aggregation in SQL, not by downloading rows (audit finding AUD-20).
  - Lock order: lock the parent `request_drafts` row first. `UPDATE` on `request_draft_ai_states` is revoked even from service_role.
  - Cohort counters only ever go up and survive retention.
- **Tests.**
  - vitest in a node environment, with `vi.mock("server-only")`, `vi.hoisted` mocks and fake Supabase clients.
  - SQL regressions go in `scripts/*.sql`; register new files in `scripts/test-local-database.mjs`.
  - CI runs lint, type-check, unit tests, build, Playwright and the database tests (`.github/workflows/ci.yml`).
- **Container quirks** (cloud session; these are environment-only, never commit them):
  - `npm run test:database` fails as root because embedded-postgres refuses to run as root. Run it as the `postgres` user: `chown -R postgres:postgres .tmp` (the directory is ignored by git), then `su postgres -s /bin/bash -c "cd <repo> && HOME=/tmp $(command -v node) scripts/test-local-database.mjs"`.
  - Playwright 1.62 expects `/opt/pw-browsers/chromium_headless_shell-1234`. Only `-1194` is installed. The workaround is a directory of symlinks to `chromium_headless_shell-1194/chrome-linux/*`, plus `chrome-headless-shell -> headless_shell`, plus `INSTALLATION_COMPLETE`. It is not in the repo.
  - To preview admin UI without auth: put a temporary page under `src/app/<name>/page.tsx` rendering the component with fixture data, and mock `/admin/analytics/series` with Playwright `page.route`. **Delete the page and `.next/` afterwards**; stale `.next/dev/types` breaks `type-check`.
- **Git.**
  - Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: <session url>`.
  - Push only to the designated branch. Do not put model identifiers in commits or PRs.
  - Don't open PRs unless asked. If this branch's PR has been merged, restart the branch from `main`.

## 8. Open questions for the owner

1. The mentor repo name, once uploaded.
2. Platforms: the vault review retired X (unused) and added Reddit. Track email, website traffic or Stripe too?
3. Stop logging Dripify volume manually now that the connector syncs it?
4. Open a PR for `claude/exciting-bardeen-3j7j3m`?
5. Approval to deploy this branch (the migrations were applied on 2026-10-16).
6. The vault disagrees on the outreach volume target: "60+ messages a day per operator" (July goal sheet) vs Dripify's 20–25 requests a day, about 100 a week (2026-09-30). Which one should become a weekly goal?
7. Does the 4,000-follower goal mean the personal profile only, or the profile and the company page together? It currently adds every LinkedIn account that is logged.
8. Allow REA to run (it downloads and runs an outside npm package) to inspect Dripify's public web app for anything its docs leave out?
