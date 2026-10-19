# Agent handoff: 2026-10-19 debugging pass

The owner asked for a debugging pass over the whole website, using a team of subagents. They named one bug in particular: logging numbers on the control desk bounced them to `/sign-in` and the screen kept flashing. That bug is fixed and committed. The rest of the work is written but not yet committed, reviewed or deployed. **Your job is to finish it, confirm it with subagents, and get it live, but only with the owner's approval.**

Read `docs/agent-handoff-2026-10-16.md` first for the project background. This document only covers the 2026-10-19 pass.

## 1. Rules (unchanged, and they matter)

- **Where to work.** Work only in this worktree: `Desgins/ajani-automation-analytics`, branch `claude/exciting-bardeen-3j7j3m`. Never touch the main clone at `Desgins/ajani-automation/`.
- **Live credentials.** `.env.local` holds live credentials.
  - Never print or open it to read secrets.
  - The local dev server (`next dev -p 3001`, possibly still running) uses the live database. Never use it to test anything that writes.
  - The owner's own local logging is real data.
- **Next.js.** It's Next.js 16, where `src/proxy.ts` replaces middleware. Read `node_modules/next/dist/docs/` before relying on Next behaviour.
- **Migrations.** No database migrations without the owner typing an explicit approval. The process (token, backup, rehearsal, apply) is in `docs/agent-handoff-2026-10-16.md` and the memory notes. Nothing in this pass needs a migration.
- **Deploys.** A deploy needs the owner's explicit go-ahead each time. Last time, "can you push what we have locally to prod?" was enough. Then `git push origin <branch>:main` was allowed.
- **Classifier limits.** The auto-mode classifier blocks:
  - opening saved key files (any request for the access key);
  - clicking Redeploy in Vercel;
  - clicking Create token in Supabase.
- **Talking to the owner.**
  - They are a non-developer and dictate by voice.
  - Use plain language, one question at a time.
  - They want subagent teams for reviews and a confirmation pass after fixes.
- **Test quirks.**
  - `npm run test:database` exits 0 even when a check fails on Windows. Read its `PASS:` lines.
  - Vitest sometimes times out (5 s) on `metric-query`, `sample-data`, `clerk` or `proxy` tests while the machine is busy. Rerun those files alone before treating them as failures.

## 2. Where things stand

| Area | State |
|---|---|
| Sign-in loop fix | **Committed** as `90c51b2`. An independent subagent confirmed it fixes the loop. Not pushed. |
| Follow-ups to the sign-in fix (3 files) | Uncommitted, not yet verified |
| Control desk logging fixes (5 bugs) | Uncommitted, written by a fixer subagent. **Not yet reviewed by the lead agent**, not verified. |
| Public site fixes (14 bugs) | Uncommitted, written by a fixer subagent. **Not yet reviewed**, not verified. |
| `next build`, full test suite, database suite on the combined tree | **Not run yet** |
| Deploy | Not done. The live site is still on `e7a5d9c`. |

Working tree: 38 changed files plus 3 new ones (`git status`). No `zz-agent-*` temp files remain. The changes split into three groups:

**A. Sign-in follow-ups** (lead agent)
- `src/components/admin/admin-login-form.tsx`: renews the sign-in before unlocking.
- `src/components/admin/metric-trends.tsx`: the "Refresh the page" button renews first.
- `src/components/signed-in-redirect.tsx`: the hop guard falls back to `window.name` when `sessionStorage` throws. Without this, the guard never stopped in that case.

**B. Control desk logging** (fixer subagent)
- `src/app/admin/actions.ts`, `action-state.ts`, `admin.css`
- `src/lib/admin/metric-query.ts`
- `src/components/admin/metric-log.tsx`, `admin-dashboard.tsx`
- Tests: `actions.test.ts`, `actions.sample.test.ts`, `metric-log.test.tsx`, and the new `src/lib/admin/metric-query.entry.test.ts`

**C. Public site** (fixer subagent): everything else, including:
- `next.config.ts`, `src/proxy.ts`, `src/lib/clerk/redirect.ts`
- `src/components/record/record-flow.tsx` and `pending-request-resumer.tsx`
- the new `src/lib/record/flow-progress.ts`
- the deleted `src/app/request/page.tsx`

## 3. The sign-in loop (fixed in `90c51b2`)

**Cause.**
- Clerk's session JWT lasts about 60 s and is renewed in the browser.
- `@clerk/backend` only renews it on the server for GET document requests: see `isRequestEligibleForHandshake` around line 6783 of `node_modules/@clerk/backend/dist/chunk-RTBRJPLB.mjs`, and `isRequestEligibleForRefresh` around line 7094.
- A server-action POST, an RSC `router.refresh()`, or a `fetch` that carries an expired token therefore reads as signed out. Tabs left in the background, or a laptop that slept, hold expired tokens.
- `requireAdminClerkUser` then redirected to `/sign-in?redirect_url=/admin`.
- Clerk's `<SignIn forceRedirectUrl>` saw a signed-in client and sent the user back with an in-app navigation. That still wasn't a document request, so `/admin` read signed-out again. This repeated as the loop, with the root `loading.tsx` ("Loading your next view") flashing each time.
- The dashboard's `visibilitychange` auto-refresh raced Clerk's own renewal.
- It never happened locally, because `AJANI_ADMIN_SKIP_SIGN_IN_IN_DEVELOPMENT=true` bypasses Clerk.

**Fix.**
- `src/lib/admin/fresh-session.ts`: `renewSignIn()` calls `window.Clerk.session.getToken({ skipCache: true })`, which rewrites the `__session` cookie. `withRenewedSignIn()` wraps every `useActionState` action. `adminFetch()` renews and retries once on a 401.
- `authorizeAdminAction()` in `src/lib/admin/session.ts` is used by every action in `actions.ts`:
  - signed out → returns "Your sign-in was renewing, so nothing was saved. Press save again." instead of redirecting;
  - desk locked → `/admin/login`;
  - not allowlisted → 404.
- The dashboard auto-refresh renews first and only runs on a visible, focused window.
- `src/components/signed-in-redirect.tsx` wraps the sign-in and sign-up forms. A signed-in visitor gets one full page load to the destination, which lets the server renew the token. After 2 hops in a minute it stops and shows "Sign out and sign in again".
- `resolveAdminClerkUser` is wrapped in React `cache()`, which cuts about 7 Clerk API calls per render to 1.

**Verifier's remaining notes.** None of these loop; each is at most one bounce with a reload.
- The Previous/Next pagination links in `AdminPagination` (`admin-dashboard.tsx`, around line 409) don't renew before navigating. **Still to do** (task 1).
- `src/app/admin/(dashboard)/error.tsx` still uses `reset`. `retry` would refresh the data. **Still to do** (task 1).
- If multi-session is ever enabled in Clerk, `/sign-in` can't show "add account". It isn't enabled.
- **Real-world check after deploy.** Leave the desk tab in the background for 3+ minutes (or sleep the laptop), come back, and save numbers straight away. It should save, or at worst say "press save again", and never bounce. In DevTools the request should show `x-clerk-auth-status: signed-in`.

## 4. Uncommitted fixes: what they claim to do (verify these)

**B. Control desk logging.** The audit found these; the fixer reports all of them done.
1. **Blocker: logging the same day twice replaced the first numbers.**
   - Cold calls and Dripify save with account `''`, and `upsert_analytics_metric_values` overwrites. So a second calling session, or the co-founder's log, erased the first.
   - Now `recordMetricValuesAction` reads that day's saved values (`loadLoggedDay`). If a `sum` metric already has a non-zero value and the form didn't send `onExisting`, it saves nothing. It returns `code: "existing"` with the question "Oct 18 already has 30 cold calls made… Add these to them, or replace them?"
   - The form shows **Add to them** and **Replace them**. "Add" adds to sum metrics and replaces `last` metrics such as followers.
   - Known limit: two saves within milliseconds can still race, because this isn't atomic. Closing that needs an RPC change, which means a migration and owner approval.
2. **Date default.** Entries made after about 8 pm Eastern were defaulting to tomorrow's UTC date. Log numbers and Experiments now default to the browser's local date, set after mount, with max = the later of local and the catalog's today.
3. **Cold-call answers above calls made** (seen live: 17 negative against 8 calls).
   - The server rejects it on the day's final totals, after add or replace.
   - The form shows an amber warning while you type.
4. **Experiments page.**
   - The counts clear after a successful save, so pressing Save again no longer double counts.
   - The forms submit through `onSubmit` + `startTransition` (`keepFieldsOnError`), so a refused save keeps the date, team member and notes. Previously React reset the form and the retry saved to today.
5. **Recently logged** shows the year when it isn't the current year.

**C. Public site.** Items 1–14 are in the fixer's report, summarised here:
1. **Duplicate build requests.** A resumed handoff no longer leaves `ajani_record_flow_v3` behind, which used to allow a duplicate build request. Stage 4 only restores when a draft is pending.
2. **"What happens" length.** On desktop the box is capped at 1,000 characters, and `routeReady` checks the length.
3. **Accessibility statement.** It now matches reality: motion is forced to "full" by the owner's choice, and the major animations have pause controls.
4. **Error pages.** `error.tsx` and `global-error.tsx` use `retry()`.
5. **Draft responses.** `request-drafts/client.ts` uses `.json().catch(() => null)`, so platform error pages no longer show raw JSON errors.
6. **Note size limit.** `automation-brief` route body limit raised from 32 KB to 96 KB, so long notes in non-English scripts fit.
7. **Backup brief.** `fallbackAutomationShape` trims text to the client's 500-character limits.
8. **Sign-in deep links.** `clerk/redirect.ts` now accepts same-origin `/portal/...` deep links and full `https://ajaniflow.com/...` URLs, with open-redirect guards. **Review this carefully.**
9. **Bad IDs.** Non-UUID build ids give a 404 page, and `DELETE /api/request-drafts/<non-uuid>` gives a 404.
10. **Portal sign-in.** `src/proxy.ts` passes `signInUrl: "/sign-in"` and `signUpUrl: "/sign-up"` to `clerkMiddleware`. Signed-out `/portal` visitors now go to the site's own sign-in page instead of Clerk's hosted `accounts.ajaniflow.com`, which also showed a Cloudflare challenge.
    - **Check:** this doesn't change admin behaviour or the handshake.
11. **/approach.** Has metadata and `noindex`.
12. **/subprocessors.** Company names no longer break mid-word.
13. **Fonts.** The /approach page, the sign-in and sign-up headings, and the error heading now use the site font instead of Trebuchet MS.
14. **/request.** It is now a real 308 redirect to `/record` in `next.config.ts`, and `src/app/request/page.tsx` is deleted.
    - `tsc` currently errors on a stale `.next/types/validator.ts` that still references the deleted page. `next build` regenerates it.
    - README and `docs/architecture.md` still mention `/request`; it still works through the redirect.

The fixers reported their area tests as passing: logging 329/330, with the one failure a known load timeout; public 670/670. Both reported `eslint` clean on touched files. Nobody has run them all together yet.

## 5. Your tasks, in order

1. **Finish the three small leftovers.**
   - Renew before the pagination links navigate. Keep the `href` for open-in-new-tab, and on click do `preventDefault` → `renewSignIn()` → `router.push(href, { scroll: false })`.
   - Switch `src/app/admin/(dashboard)/error.tsx` to `retry`, the same way `src/app/error.tsx` now does.
   - Fix the stale lines in `docs/analytics-metric-store.md`: around line 38 ("Re-entering… replaces") and around line 366 ("Entry dates default to the UTC day").
2. **Review the uncommitted diffs yourself** (`git diff`). Concentrate on:
   - `actions.ts`: the add/replace logic, the reading of saved values, and every path that can save nothing or save twice;
   - `redirect.ts`: open redirects;
   - `proxy.ts`: the `signInUrl` change;
   - the record-flow restore;
   - the deleted `/request` page.
3. **Run everything on the combined tree.**
   - `npx vitest run`, then rerun timeouts alone.
   - `npx eslint`.
   - `npm run build`. It loads `.env.local`, which is fine because it doesn't write. It also regenerates `.next/types`.
   - `npx tsc --noEmit -p .`
   - `npm run test:database`, reading the `PASS:` lines.
4. **Confirmation team.** The owner explicitly asked for this. Spawn read-only verifier subagents in parallel:
   - one for B (logging), adversarial, including the add/replace UX and the answers check;
   - one for C (public), including redirect security and a headless Playwright GET-only pass. Use a local `next start` on another port **only** if it is isolated from live credentials. Otherwise review the code only.

   Fix what they confirm, then re-verify.
5. **Commit** in logical pieces: sign-in follow-ups, desk logging, public fixes, docs. End each message with the co-author line used in this repo's history.
6. **Ask the owner** whether to put it live. In plain words, say what changes for them:
   - no more bounce;
   - a second same-day log asks "add or replace";
   - dates follow their own day.

   Only after a clear yes:
   - `git push origin claude/exciting-bardeen-3j7j3m`
   - `git push origin claude/exciting-bardeen-3j7j3m:main`, a fast-forward from `e7a5d9c`. First check `git rev-list --left-right --count origin/main...HEAD` shows `0` behind.
   - Watch `gh api repos/IcyeyeLOL/ajani-automation-client/commits/<sha>/status` until it reports `success`, then confirm the Vercel Deployments page shows it as Production.
7. **After deploy, ask the owner and co-founder to:**
   - do the real-world check in section 3;
   - log a second session on the same day and see the add/replace question;
   - **correct the cold-call numbers already logged.** On 2026-10-18/19 the live data showed 8 calls with 17 negative answers, probably made worse by the old replace bug. Fix them under Trends → Cold calls, or in Recently logged.
8. **Update records.** Update `docs/agent-handoff-2026-10-16.md` (§4) and the memory notes (`ajani-connector-setup.md`) with what shipped.

## 6. Owner decisions still open (ask; don't decide)

- **Heading contrast.** Home page second-line headings in `--home-highlight #edc6a0` measure 1.41:1, which fails WCAG.
- **Reduced motion.** The site forces full motion by the owner's earlier choice.
- **"Record a note" sign-in.** The header and hero send visitors to `/sign-in?redirect_url=/record`, but `/record` works signed out and the 404 page links to it directly. Which is intended?
- **Share and search tags.** `canonical` and `og:url` are missing on every page except home.
- **Outreach reply rate.** The owner said "yes" to counting replies only from channels that reached someone in the period, then switched to the per-channel replies chart instead. Not done.
- **Atomic "add" for same-day logging.** Needs a migration.

## 7. Audit findings not fixed (minor; mention, don't rush)

- **Blank cold-call outcomes.** With calls logged, they read "—" on the Cold calls view but 0% under Outreach (`coalesce` in `20261018020000`). Sending blanks as 0 would be safe now that "add" exists.
- **Future dates.** A future date (today + 1 UTC) is accepted, and a mistyped year is accepted. The year now shows in Recently logged.
- **Desk cookie from outside links.** The desk cookie is `SameSite=strict`, so opening `/admin` from an email or Slack link shows the key screen even when already unlocked.
- **Sign-in page layout.** A 54 px gap above "Email address" (Clerk's hidden password label row), and two `h1`s.
- **Console warnings.** "Preloaded but not used" CSS warnings on legal pages, /record and /demos, plus warnings from the YouTube iframe on /stories.

## 8. Older open items (from earlier sessions, still open)

- **AI key.** Vercel's `ANTHROPIC_API_KEY` is probably stale, so the PDF and screenshot import AI path may 503. Plain CSVs still work.
- **Instagram followers.** The owner should re-upload the combined Instagram/LinkedIn CSV in Import numbers to repair them. The rebuilt import is live.
- **Leftover RLS policies.** Client-write RLS policies in `20260808000000_portal_foundation.sql` (lines 242–252) were never dropped.
- **Transcription rate limit.** Its key includes the user-agent (`src/app/api/transcribe-voice/route.ts:114`).
- **YouTube manual metrics.** The 8 "manual" YouTube metrics are also written by the connector.
- **LinkedIn followers.** They can inflate across accounts.
- **Dripify.** The Dripify campaign has been stalled since 10-16 (694 contacted, 186 remaining).
- **Old Supabase tokens.** "cold calls" and "Claude" never expire; the owner was asked to delete them.

## 9. Evidence

- **Investigator, verifier and fixer reports.** These were in the 2026-10-19 session and aren't saved as files; this document summarises them.
- **Live-site QA run (headless, GET-only).** Screenshots and JSON are in the session scratchpad. They are temporary and may be gone: `C:\Users\lime7\AppData\Local\Temp\claude\c--Users-lime7-Documents-ChatGPT-Desgins\2324629e-d8cc-4255-b714-e0ffb7dcf51c\scratchpad\qa\`
- **Clerk behaviour.** An investigator ran Clerk's real `authenticateRequest` offline with an expired `__session` token:
  - server-action POST → signed-out (`session-token-expired-refresh-non-eligible-non-get`);
  - RSC/fetch GET → signed-out;
  - document GET → handshake.
