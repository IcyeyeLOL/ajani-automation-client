# Engineering remediation and release gates

Date: September 5, 2026. Scope: engineering repairs to the existing application, not a redesign.

This follows the [original engineering audit](./engineering-audit-2026-09-05.md). Work is local on `codex/main-ready`. No commit, push, deployment, production migration, real customer submission, or provider notification was performed. Substantial pre-existing unpublished changes were preserved.

## Team and responsibility

| Engineer | Responsibility |
| --- | --- |
| Codex, integration lead | Shared motion contract, demo playback, responsive correctness, loading, browser/CI integration, isolated PostgreSQL verification, final review |
| Linnaeus | Recording lifecycle, transcript integrity, cancellation/deadlines, blocked storage, capability handoff, independent motion regressions |
| Confucius | Transaction ordering, draft/media ownership, retry recovery, identity synchronization, retention, SQL and real concurrency tests |
| Maxwell | Authorization, abuse budgets, canonical notifications, bounded analytics, webhook fencing, independent security/lock-order review |

The seven review dimensions were functional correctness, reliability/recovery, data integrity/tenant isolation, security/privacy controls, performance/scalability, operational visibility, and regression safety.

## Original finding disposition

The following repairs are implemented locally. “Implemented” does not mean the production database or deployed application has been changed.

| Finding | Repair and protection |
| --- | --- |
| AUD-01: missing database RPCs | Complete migration-chain tests and a read-only required-RPC release gate. The existing September 2 handoff migration remains required; it was not silently applied remotely. |
| AUD-02: deletion races submission | A database row-lock reservation precedes Storage removal. Claim/submission and deletion have exclusive outcomes; delayed path-only purge work survives content deletion. |
| AUD-03: daily recovery bottleneck | Recovery is configured every minute with bounded work and queue-health counts. Scheduler support is a release prerequisite. |
| AUD-04: AI quota consumes final save quota | Separate salted operation-specific request budgets prevent successful generation from exhausting draft-save allowance. |
| AUD-05: stale generated email brief | Approved persisted workflow steps, current development brief, and confirmed answers are canonical notification content. Old generated implementation notes cannot contradict edits. |
| AUD-06: inconsistent request deadlines | Server generation uses a shared 45-second budget with bounded provider attempts; client requests have cancellation and a 55-second total fetch/body deadline. |
| AUD-07: desktop autoplay stops | The timer rearms on each active step and reaches completion without another click. Manual pause and hidden-tab behavior are tested. |
| AUD-08: inconsistent/static motion | Shared `system-v1` preference helper, deduplicated listeners, matching CSS overrides, readable observer fallbacks, and live preference tests. |
| AUD-09: manual transcript edits lost | Manual provenance survives resumed speech and completion; whole-audio transcription cannot replace the corrected text. |
| AUD-10: late recording callbacks | Stopped/obsolete recognition sessions, recorder events, and async completions cannot overwrite current input. |
| AUD-11: stale clarification responses | Editing or leaving the step cancels and invalidates prior generation before results can be committed. |
| AUD-12: denied storage blocks form | Optional tab storage fails safely. Atomic capability storage has a same-page memory fallback, expected-draft guards, and explicit reload-loss/recovery messages. |
| AUD-13: generated route has no handoff | Client and server schemas require a human handoff. Invalid responses use a valid fallback; older saved routes can add a handoff. |
| AUD-14: voice completion replay regresses state | The route validates uploaded audio; one RPC atomically records metadata, preserves progressed states, and idempotently enqueues transcription. |
| AUD-15: exhausted worker leases strand work | Stale final attempts become terminal failures; current-attempt fencing prevents old workers from overwriting newer outcomes. Notification leases receive the same protection. |
| AUD-16: busy webhook acknowledged as complete | Busy claims return a retryable response. Versioned claim/finish RPCs use attempt fences; stale success/failure cannot finish a newer lease. |
| AUD-17: delete-before-create resurrection | Provider deletion tombstones block older organization/membership events from recreating deleted identities. |
| AUD-18: completed handoff retry fails | Authorized retries, including expired submitted drafts, return the original receipt without a duplicate build or outbox entry. Other users cannot obtain the receipt. |
| AUD-19: provisioning race | Database-backed ordered upsert serializes concurrent provider-organization provisioning. |
| AUD-20: capped/raw analytics and retention distortion | SQL performs exact aggregate calculations; only detail lists are paginated (25 experiments/20 batches). Monotonic cohort counts survive retention. Missing/partial history is disclosed instead of presented as zero or complete. |
| AUD-21: weak admin identity/throttling | Email allowlists accept verified addresses only; stable user and IP budgets reserve attempts atomically and fail closed on database/network errors. The data-access layer authorizes independently. |
| AUD-22: cleanup/notification duration and throughput | Shared invocation budgets bound provider, database, Storage, retention, and health work. Partial/deadline cleanup returns failure status and observable remaining work; recovery is frequent rather than once daily. |
| AUD-23: hidden image downloads | Audience imagery loads only when selected; already-visited images stay cached for transitions. Browser tests reject eager mounting of all six images. |
| AUD-24: routing labels collide | Station labels use two lines within the existing boxes. Browser measurement tests verify containment/clearance after fonts settle at 1440, 760, 390, and 320px. |

## Additional issues caught while integrating

- A mobile stage entrance translated 22px inside an 18px page gutter, briefly pushing the next-step content outside a 320px viewport. The narrow-screen entrance is now capped at 12px in both directions; the overflow assertion remains intact.
- Dynamically changing a running carousel's CSS duration made the test itself emit queued iteration events. The test now accelerates the actual animation with a phase-preserving playback rate, verifies the full scene order, and tests pause/resume/offscreen behavior.
- The proof-halo regression previously measured the first stage's clock after it had legitimately finished. It now measures the last stage of the one-shot sequence, retaining offscreen/hidden pause, actual elapsed progress, and fully settled end-state assertions. Three consecutive focused runs passed.
- A recorder capture was incorrectly rejected when the one-second display interval had not updated React state. A native synthetic-audio test reproduced nonzero audio, a successful stop event, and the erroneous failure state with display ticks suppressed. Capture duration now uses monotonic active time, excludes pauses, resets between sessions, and does not discard a nonempty short note because its display remained at zero. The three-minute active-recording deadline is independent of display updates and recalculates its remaining time after pause/resume.
- A valid signed-upload token can recreate a private object after immediate deletion. A path-only outbox now schedules another idempotent purge after the two-hour token window plus a 15-minute in-flight grace; failed work remains leased/retryable and observable.
- Background demand enrichment and submission must lock draft before AI state. The enrichment RPC follows the submission lock order; two-connection regression tests protect it.
- ESLint now excludes generated browser artifacts and local database files. It previously raced Playwright's output cleanup during parallel verification; application source, unit tests, and browser regressions remain linted.

## Motion policy

The original remediation respected the device's reduced-motion preference under `system-v1`. This was superseded by the owner's September 6 request: the root now renders `html[data-motion="full"]` and `data-motion-policy="full-v2"` from the server, and old saved preferences no longer disable playback. Individual pause controls remain. No operating-system preference is changed. See `mobile-review-2026-09-06.md` for the updated menu and motion contract.

The in-app preview reported reduced motion enabled with no override. Its static fallback is intentional accessibility behavior, not missing animation code. Normal-motion playback, live preference changes, manual controls, and explicit mobile showcase playback have separate tests. Essential content remains readable without viewport observation.

## Verification

Final combined verification results are recorded below after the implementation freeze. Tests use synthetic audio/data and mock external application services; database fixtures run only in a fresh local native PostgreSQL cluster.

| Check | Final result |
| --- | --- |
| ESLint and whitespace validation | Passed |
| Generated Next route types / TypeScript | Passed |
| Unit tests | 202 passed across 44 files |
| Fresh isolated PostgreSQL migration chain | All 29 migrations passed |
| Database regression suites | Reliability/retention, analytics, and fenced webhook assertions passed |
| Real database concurrency | All 5 interleavings passed: delete/claim, submit/delete, concurrent provisioning, and both enrichment/submission orders |
| Production dependency advisory scan | 0 known advisories across 96 production dependencies |
| Optimized Next.js production build | Passed |
| Production-build Chromium browser suite | All 105 tests passed, with no retries or expected failures |

### Reproduce locally

```bash
npm ci
npm run lint
npm run type-check
npm run test:unit -- --maxWorkers=1
npm run test:database
npx playwright install chromium
npm run test:e2e
```

Set `PLAYWRIGHT_PRODUCTION=1` before the browser command to build/run optimized Next output. Set `PLAYWRIGHT_PORT` to an unused local port. That harness disables integration credentials and uses preview environment semantics; it does not weaken production authentication. The CI workflow runs this production-build mode and the isolated migration suite without deployment credentials.

The database harness accepts no remote connection string, does not load `.env`, binds a randomly chosen loopback port, stops the engine afterward, and retains synthetic data under ignored `.tmp/database-tests`. It applies all migrations in order and checks SQL permissions, replay invariants, data counts, and real lock waiting with independent connections.

## Release gates — still required before production

1. Obtain explicit approval for the exact code/release. Do not push this development redesign or engineering working tree merely because local verification passes.
2. Review the dirty diff, separate unrelated unpublished work, and select the intended release commit. Preserve a known-good production rollback target.
3. Back up and review the target database. Apply the September 2 handoff migration and the September 5 reliability, analytics, and webhook-fencing migrations in order, using an authorized release procedure. None were applied to the connected project during this work.
4. Run `npm run check:database-contract` with the intended target configuration. It performs a read-only OpenAPI contract check and fails when required RPCs are missing; presence is necessary but not a substitute for provider integration testing.
5. Verify live Clerk credentials, webhook signing configuration, rate-limit secret, private Storage permissions, transcription/AI settings, email sender/recipient configuration, and `CRON_SECRET` in the intended environment. Do not infer them from local unit mocks.
6. Confirm a scheduler supporting every-minute recovery and every-15-minute retention. [Vercel's cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) do not permit these frequencies on Hobby. No plan purchase or scheduler change was made externally.
7. Run an approved isolated service-integration exercise: sign in, save/upload a synthetic recording, claim/submit it, inspect the resulting database/admin state, receive the internal notification, replay webhooks/retries, and verify cleanup through the actual Storage HTTP service.
8. Test real iOS/Safari/Android microphone behavior and interruptions. Chromium synthetic-device tests cannot certify physical microphones or every browser's speech service.
9. After an approved release, verify the public domain and monitor queue age, retry/terminal failures, cleanup backlog, analytics availability, and webhook failures.

### Explicit limits and assumptions

- Supabase-owned `auth.jwt`, roles, and Storage bucket schema are bootstrapped for local SQL testing. The Storage HTTP service, JWT issuance, real Clerk tenancy, external transcription quality, email delivery, and billing-provider behavior are not emulated by that database harness.
- The 15-minute extra upload grace is an application policy assumption, not a verified maximum duration for every provider upload. Validate the delayed-purge horizon against the actual Storage service before claiming externally proven orphan-free cleanup.
- Historical drafts already deleted before cohort backfill cannot be reconstructed. The dashboard explicitly discloses that coverage boundary.
- Direct service-role UPDATE of AI-state rows is now denied; asynchronous enrichment must use the lock-ordered RPC. During a mixed-version rollout, an old optional enrichment callback may fail until the matching app version is deployed. Initial saves and database submission RPCs retain their required access. Review that rollout window explicitly.
- This work repairs the implemented application. It does not create new billing, build-delivery, or operational capabilities that were outside the audit's existing-code scope.
