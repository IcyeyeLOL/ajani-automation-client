# Ajani engineering audit
Date: September 5, 2026
Decision: **Do not promote the current working tree as production-ready.**
Scope: functionality and engineering, not a redesign.

Follow-up: this is the original audit snapshot, not the current repair status. See [Engineering remediation](./engineering-remediation-2026-09-05.md) for the subsequent implementation and verification. The original defect probes have since been converted into ordinary passing regression requirements.

## Executive assessment

The application builds successfully and most existing browser checks pass. That is not enough to certify the complete request lifecycle: the connected database API is missing two required RPCs, several asynchronous flows can lose or misrepresent user decisions, and recovery throughput and analytics aggregation have clear scaling limits.

This audit made **no application-source changes, database mutations, provider submissions, commits, pushes, or deployments**. Existing unpublished changes were preserved. Deliverables are this report, isolated reproduction tests, and a read-only database inspection script. The local preview was restarted for testing.

The assessment applies to the current dirty `codex/main-ready` checkout of `ajani-main-ready`, not automatically to the deployed website. The baseline includes commit `7490cd9` plus substantial later unpublished work. A production environment, authenticated test tenants, actual email delivery, and real provider behavior were not certified.

## Engineering team and review dimensions

| Reviewer | Responsibility | Independent work |
| --- | --- | --- |
| Codex, audit lead | Integration, functional correctness, motion, release evidence | Ran full browser/unit/build checks, inspected connected DB schema read-only, created functional and motion probes, reconciled findings |
| Linnaeus, voice reliability | Audio lifecycle, transcript integrity, async state | Traced capture through transcription and submission; browser-reproduced two edit-loss cases |
| Confucius, data consistency | Transactions, tenancy, retries, admin/database synchronization | Reviewed SQL migrations, RLS, submission/storage ownership, webhook ordering and replay; independently rechecked the deletion race |
| Maxwell, security/performance | Authorization, abuse controls, capacity, dependencies | Reviewed admin security, rate limits, worker budgets and analytics; ran the production dependency advisory check |

Seven dimensions: functional correctness; reliability/recovery; data integrity/tenant isolation; security/privacy controls; performance/scalability; operational visibility; testability/change safety.

## Evidence and verification results

| Check | Result | What it establishes |
| --- | --- | --- |
| ESLint | Passed | Static lint checks on the working tree |
| TypeScript | Passed | Current routes/types compile |
| Production build | Passed | Optimized Next build and 27 prerendered outputs completed |
| Unit tests, serial rerun | **152/152 passed, 34 files** | Existing mocked/unit contracts pass |
| Existing Chromium browser suite | **87/88 passed** | Public navigation, recording controls, mocked intake, many motion and responsive contracts |
| Additional functional probes | **4 open defects reproduced** | Desktop autoplay, storage-denied hydration, stale shape response, missing-handoff dead end |
| Additional voice probes | **2 open defects reproduced** | Manual correction loss after resume; late speech result overwrites paused edit |
| Additional motion probes | **1 fallback defect reproduced; label-spacing failure independently confirmed** | Legacy observer failure reaches error boundary; routing labels fail even after fonts load |
| Production dependency advisory scan | **0 known advisories** | `npm audit --omit=dev --json`, 96 production dependencies; not a comprehensive security certification |
| Connected Supabase API | Reachable; schema mismatch confirmed | Service-role GET OpenAPI and HEAD counts only; no client row bodies read |

The first concurrent unit run had two Clerk-import timeouts. Those two passed in isolation, and the final serial full run passed all 152 tests. Browser launches initially needed sandbox approval, and an earlier localhost binding conflict was resolved before the recorded suite; neither is counted as a product defect.

The isolated `audit/` tests use `test.fail()` immediately before assertions of correct behavior for documented defects. Playwright may report these as “passed” because failure was expected. **They demonstrate broken behavior, not release readiness.** The label diagnostic deliberately remains a normal failing assertion. The original test suite was not weakened or edited.

### Flow coverage and limits

| Flow | Verified | Remaining production evidence |
| --- | --- | --- |
| Home, demos, stories, approach, legal navigation | Browser loading, links, controls and mobile containment | Production runtime and non-Chromium coverage |
| Homepage motion | Carousel cycling, pause, hidden/offscreen handling, proof and how-it-works timing, reduced-motion fallbacks | A single agreed motion preference contract across all components |
| Voice capture | Synthetic microphone, permission/capture controls, pause/resume/finish, waveform, mocked transcription, Back restoration | Real iOS/Safari/Android devices, hardware interruptions, actual transcription quality |
| Typed/voice intake to route approval | Mocked clarify/shape, editing, progress, failed-save retry and account dialog | Correctness under the edge cases below; real provider fallback behavior |
| Saved draft to authenticated submission | Route/SQL/unit review, capability checks, transaction structure | Disposable tenant integration test through Clerk, Storage and Supabase |
| Admin and client portal | Authorization/data-access source review and existing units | Authenticated cross-tenant tests and actual count reconciliation |
| Notifications and background work | Outbox/worker/cron source and unit checks | A received test email, scheduler invocations, crash/retry recovery and queue-age evidence |
| Billing and delivery | Read models and code capability inventory | Billing is not a complete checkout/payment workflow; delivery operation needs an explicit owner/tool |

## Priority findings

Evidence labels: **B** = browser reproduced; **E** = connected-environment read; **S** = source/SQL-reviewed reachable condition. Source findings are not claims that production data has already been damaged.

### AUD-01 · P1 · Required database RPCs are absent from the connected API schema [E + S]

The configured service-role OpenAPI response includes `submit_request_draft`, `claim_voice_memo_transcription_job`, and `claim_clerk_webhook_event`, but does not expose `acknowledge_request_draft` or `update_request_draft_voice_memo_metadata`. The current routes require both. The pending migration `20260902000000_enforce_request_handoff_acceptance.sql` defines them and matches the callers.

A valid voice finalization reaches the metadata RPC after updating memo/job rows; an RPC error returns 503 before immediate processing is scheduled. Re-acknowledgment also cannot complete through its required RPC. This is a runtime contract mismatch that TypeScript and mocked route tests cannot catch.

Action: reconcile the migration ledger, function grants and PostgREST schema cache in a staging environment, then perform an explicitly approved database rollout. Absence from OpenAPI is not proof of the exact migration ledger state. Do not blindly reapply or modify production during an audit.

Acceptance: apply all migrations to a disposable database; invoke both functions with fixtures; complete written and voice submissions; verify versioned acceptance, memo metadata, build ownership and rollback behavior.

Sources: [voice completion](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/[draftId]/voice-memo/complete/route.ts:98>), [acknowledgment route](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/acknowledge/route.ts>), [required migration](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/supabase/migrations/20260902000000_enforce_request_handoff_acceptance.sql>), [read-only probe](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/scripts/audit-database-readonly.mjs>).

### AUD-02 · P1 · Draft deletion can race submission and remove submitted audio [S]

DELETE validates an unclaimed/unsubmitted draft using an ordinary SELECT. Its helper then reads storage paths, awaits Storage deletion, and deletes the draft by ID alone. Concurrent claim/submission can commit between those operations, moving the memo to a build before the in-flight Storage removal completes. The build's source-draft FK uses ON DELETE SET NULL, so it does not prevent the late deletion. No actual client recording was deleted to test this.

Action: reserve deletion atomically under the same draft lock used for claim/submission. Only a reserved, non-submittable draft may enter external storage cleanup. Make cleanup recoverable/idempotent. Adding a condition only to the final SQL DELETE does not protect the already-deleted audio.

Acceptance: deterministically interleave delete/claim/submit in a disposable database and fake Storage. Either deletion wins before submission, or submission wins and its audio remains readable.

Sources: [DELETE guard](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/[draftId]/route.ts:42>), [storage-first helper](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/request-drafts/delete-request-draft.ts:11>), [memo transfer](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/supabase/migrations/20260825000000_preserve_voice_memos_on_submit.sql>).

### AUD-03 · P1 · Recovery throughput is one transcription per day [S]

The scheduled intake sweep runs once daily and processes one transcription plus four notification jobs. Immediate `after()` work is the normal fast path, but the fallback cannot clear even a modest outage backlog promptly. Ten ready recording jobs need ten daily sweeps if no other worker invocation drains them; new failures extend that delay.

Action: define a recovery objective and use a supported frequent schedule or durable worker with bounded concurrency and a wall-clock budget. Alert on oldest-ready-job age, not just job counts.

Acceptance: a staged backlog of at least 20 jobs drains within the agreed recovery objective; provider 429/5xx and worker crashes produce bounded retries without duplicate client outcomes.

Sources: [schedule](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/vercel.json:8>), [batch limits](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/cron/process-intake-jobs/route.ts:8>), [worker](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/transcription/worker.ts:44>).

### AUD-04 · P1 · AI generation and draft saving consume the same rate-limit bucket [S]

Both endpoints hash the same address/salt and use `consume_public_request_allowance`, but AI allows 12 operations while saving allows eight. Three clarify → shape → save journeys in ten minutes make the third save the ninth shared operation, so analysis can succeed immediately before saving is rejected. Shared-IP offices compound the issue.

Action: explicitly namespace operation budgets, or introduce an intentional funnel-wide quota with consistent costs and a reserved final-save allowance. Keep abuse protection; do not simply remove limits.

Acceptance: simulate full journeys, retries and shared-IP users against the actual rate-limit SQL. A permitted analysis flow must have a documented path to save, and abusive traffic must still be limited.

Sources: [AI quota/fingerprint](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/automation-brief/route.ts:53>), [draft quota](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/route.ts:300>), [draft fingerprint](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/route.ts:347>).

### AUD-05 · P1 · Internal implementation email can contradict the approved route [S]

Route edits, additions, removals and reordering change `blocks` without invalidating the earlier generated `emailBrief`. Submission includes both. The notification renderer prefers the earlier email implementation notes over canonical `system_definition`. Edits to the check-stage brief can also fall back to a new note-derived email rather than the actual approved blocks.

Action: render implementation instructions from the persisted approved build snapshot. Treat AI-generated assumptions as separate commentary. Prefer a revision/hash tying transcript, decisions, approved route and downstream communication together.

Acceptance: change a step, delete one, reorder the sequence and edit the desired outcome. Persist and render the notification; every approved detail must match exactly, with no deleted instruction remaining.

Sources: [route editing](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:759>), [submission payload](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:1216>), [notification preference](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/notifications/build-request.ts:180>).

### AUD-06 · P2 · AI failover can exhaust the route budget; client requests have no deadline [S]

The AI route has a 60-second maximum. Two provider candidates each receive a fresh 30-second timeout, leaving no margin for validation, database rate limiting, serialization or platform overhead. This is a conditional timeout risk, not a measured production timeout. Client transcription and generation fetches lack their own cancellation/deadline, so a network stall can leave the UI waiting indefinitely even though server/provider budgets exist.

Action: carry a single end-to-end deadline, allocate provider attempts within it, reserve fallback/response time, and abort client work on cancellation, replacement or timeout.

Acceptance: delayed/hung provider and network fixtures return a retryable or editable fallback state within a documented limit. Discarded/replaced operations cannot apply late state.

Sources: [route duration](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/automation-brief/route.ts:10>), [provider loop](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/ai/automation-workflow.ts:97>), [transcription client](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/transcription/client.ts:12>), [generation client](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/record/automation-brief-client.ts:29>).

### AUD-07 · P2 · Desktop demo autoplay advances once, then stalls [B + S]

Run starts at step 1; the single timeout advances to step 2. Its effect depends on mode, reduced-motion and step count, not active step. Nothing rearms it. The probe remained at “Playing automation: Intent scan” beyond the time needed to complete all steps. Existing desktop tests exercise play/pause/manual stepping, while the complete-autoplay test covers the separate mobile component.

Action: give playback one explicit state machine/timer owner and rearm on step progression. Keep manual and reduced-motion modes intact.

Acceptance: every desktop scenario runs start → all steps → complete with no extra click; pause freezes progress, restart resets, scenario changes cancel the old run, and hidden/offscreen behavior is specified.

Sources: [timer effect](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/demo-grid.tsx:152>), [reproduction](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/functional-reliability.spec.ts:17>).

### AUD-08 · P2 · Motion has inconsistent contracts and an unsafe legacy fallback [B + S]

The current root does not set `data-motion="full"`. Many CSS/JS branches intentionally turn motion off under the operating-system reduced-motion preference. Existing tests explicitly expect that default. Therefore “static” can be intentional preference behavior, not deleted animations. The prior always-on intention and current tests/code need one agreed contract; blindly forcing full motion would ignore accessibility needs.

At handoff, the actual in-app recording preview reported reducedMotion = true, motionOverride = null, and a hydrated form. This confirms that the user's current browser is requesting the reduced-motion path. No browser or operating-system preference was changed during the audit.

Separately, homepage Reveal has a fallback, while legacy MotionReveal on /approach constructs IntersectionObserver unguarded. Removing that optional API in a browser probe produces an IntersectionObserver error and the route error screen. Its base CSS also starts content hidden, making progressive enhancement fragile.

Action: document one default motion policy and share its implementation across JS/CSS. Keep meaningful static content, guard optional APIs, and make enhancement failure leave content readable. This audit did not install the previously discussed central motion-policy solution.

Acceptance: route-by-route tests under both media preferences, navigation/back-forward, user pause, offscreen/hidden state and missing observer. Essential text must not depend on animation initialization.

Sources: [root policy](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/layout.tsx:50>), [legacy reveal](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/motion-reveal.tsx:18>), [hidden CSS](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/motion.css:3>), [motion probes](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/motion-diagnostics.spec.ts>).

### AUD-09 · P1 · Resuming voice capture can erase a user's manual correction [B + S]

The probe corrected “Orders above 500 dollars” to “Orders above 50 dollars.” The corrected text remained during Resume. A subsequent speech result changed provenance back to `live`; completion then transcribed the entire original audio and replaced the corrected text with “500 dollars.”

Action: preserve manual-edit provenance across resumed segments. Merge new transcription into an explicitly versioned transcript, or retain edited text as authoritative and require review before replacing it.

Acceptance: correct a name, amount and routing destination; resume recording, finish, navigate Back and reload the tab. Approved edits must survive all stages.

Sources: [speech-result provenance](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/home/voice-recorder.tsx:146>), [completion overwrite](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:731>), [voice reproductions](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/voice-reliability.spec.ts>).

### AUD-10 · P2 · Late speech recognition results overwrite paused edits [B + S]

Stopping recognition removes onend but leaves onresult attached. The result callback has no active-session/generation guard. After pause, the probe edited “all incoming leads … support queue” to “qualified incoming leads … sales queue”; a queued final result restored the original text.

Action: invalidate a recognition generation before stop/abort, detach handlers and ignore callbacks from inactive sessions. Define whether a final result should be accepted before opening the editor, never after the user starts editing.

Acceptance: inject late result/error/end events after pause, discard, new recording and unmount. None may overwrite current text or resurrect discarded state.

Sources: [stop/result handlers](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/home/voice-recorder.tsx:117>), [reproduction](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/voice-reliability.spec.ts>).

### AUD-11 · P2 · An in-flight shape response can use an older clarification [B + S]

The custom-answer textarea remains editable outside the disabled fieldset during generation. Editing it does not invalidate the active request. The probe submitted “morning owner,” changed it to “evening owner instead,” then released the original response. The app advanced with morning-owner route details despite the updated answer.

Action: version all generation inputs and compare the response revision before applying it; cancel on Back/input changes. Disabling only some controls is insufficient.

Acceptance: edit or navigate away at every async boundary; stale results cannot advance stages or replace newer decisions.

Sources: [answer update](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:1137>), [shape response application](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:1171>), [enabled textarea](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:1504>), [reproduction](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/functional-reliability.spec.ts:45>).

### AUD-12 · P2 · Denied session storage leaves the entire recording form inert [B + S]

Legacy-key cleanup executes outside the guarded storage reader. If removeItem throws, setHydrated is never reached and the form retains its inert attribute. A browser probe restricted only Ajani's legacy-key deletion; the controls stayed unusable.

Action: treat storage as optional. Wrap the complete restore/cleanup sequence and always settle hydration, with an in-memory fallback and honest persistence notice.

Acceptance: throwing reads/writes/deletes, quota exhaustion and invalid stored JSON never block a new note or expose another tab's state.

Sources: [hydration effect](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:436>), [inert boundary](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:1312>), [reproduction](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/functional-reliability.spec.ts:27>).

### AUD-13 · P2 · A schema-valid generated route can strand the user [B + S]

The response schema permits three to eight blocks with no handoff. The editor requires a handoff to advance, but Add creates only custom blocks and the kind is not editable. The probe supplied an otherwise valid response without a handoff; “Check this route” remained disabled with no usable repair control.

Action: enforce semantic route invariants at the provider boundary and provide a safe editable fallback. UI and server validation must agree.

Acceptance: property-based or table-driven generated routes cover no handoff, duplicate IDs, missing trigger and empty details. No accepted provider output may create an unrecoverable editor state.

Sources: [response schema](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/record/automation-brief.ts:38>), [route readiness](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/record/record-flow.tsx:404>), [reproduction](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/functional-reliability.spec.ts:76>).

## Further reliability, security and scale findings

These source-verified findings should become tracked engineering work. They are not claims of observed production incidents.

| ID / priority | Defect and consequence | Required change / acceptance evidence |
| --- | --- | --- |
| AUD-14 / P2 | Replaying voice completion unconditionally marks a ready memo uploaded, but duplicate-ignore preserves its succeeded job. The worker cannot reclaim a succeeded job, leaving regressed status. | Monotonic/idempotent completion transaction; replay after success returns the original receipt and ready status. [completion](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/[draftId]/voice-memo/complete/route.ts:84>) |
| AUD-15 / P2 | A worker crash on its final allowed attempt leaves running status at max_attempts; the claim query excludes it forever despite an expired lease. | Reap exhausted stale leases into a terminal state with visible recovery; crash-inject on the last attempt. [claim SQL](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/supabase/migrations/20260825010000_claim_voice_transcription_jobs.sql:21>) |
| AUD-16 / P2 | Clerk claim returns the same false value for completed and currently leased events; the webhook acknowledges both with 200. A retry during a crashed invocation's lease can be acknowledged before any successful processing, with no later recovery worker. | Distinguish completed/busy/claimed; persist a durable inbox or return a retryable busy response. Crash and redelivery tests must converge. [webhook](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/webhooks/clerk/route.ts:30>), [lease SQL](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/supabase/migrations/20260825020000_harden_clerk_webhook_ordering.sql:14>) |
| AUD-17 / P2 | Membership and organization deletion update existing rows only. Delete-before-create leaves no tombstone, allowing an older creation to insert an active row later. Immediate cross-tenant access was not demonstrated: portal loading also checks current Clerk membership. | Persist tombstones by provider identity even when rows do not exist; test every out-of-order create/update/delete permutation. [membership deletion](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/webhooks/clerk/route.ts:61>), [organization deletion](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/supabase/migrations/20260825020000_harden_clerk_webhook_ordering.sql:110>) |
| AUD-18 / P2 | If a successful claim/submission response is lost, retry rejects the already-submitted draft with 404 rather than returning the authorized build receipt. SQL deduplication prevents duplicate builds but does not make the API outcome recoverable. | Authorized replay returns the same build ID; simulate response loss after commit. [availability guard](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/request-drafts/claim/route.ts:50>) |
| AUD-19 / P2 | First workspace provisioning does SELECT then INSERT for an organization. Parallel first visits or a webhook can insert between them; a unique conflict is returned instead of resolving the existing row. | Atomic upsert/RPC or unique-conflict reread; parallel provisioning must resolve one organization without error. [provisioning](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/clerk/provisioning.ts:65>) |
| AUD-20 / P2 | Admin downloads 14 raw datasets, caps each at 10,000 and aggregates locally; a lower API row cap may truncate sooner. No pagination/count completeness signal exists, so partial data can look authoritative. Visible tabs repeat this every minute. Retention also removes abandoned drafts from historical funnel denominators. | SQL aggregates with explicit time/cohort definitions; paginated details; separate unavailable/partial/zero states; reconcile fixtures above all row caps and before/after retention. [admin query](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/admin/dashboard.ts:49>), [cap](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/admin/dashboard.ts:110>), [funnel](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/admin/dashboard.ts:196>), [polling](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/admin/admin-dashboard.tsx:64>) |
| AUD-21 / P2 | Admin email allowlisting includes all Clerk email addresses without checking verification. A pending allowlisted address can satisfy this layer, though the separate shared admin key is still required. Throttle helpers also ignore ordinary Supabase error results, and caller-controlled User-Agent changes the throttle fingerprint. | Prefer stable allowed user IDs or verified emails; check returned DB errors; stable user/IP throttles; test pending email and outage cases. This is layered-access hardening, not a demonstrated full admin takeover. [allowlist input](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/admin/clerk.ts:17>), [throttle](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/admin/actions.ts:177>), [fingerprint](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/lib/admin/session.ts:63>) |
| AUD-22 / P2 | Daily retention deletes at most 100 drafts without stable ordering/pagination and returns HTTP 200 even when individual deletions all fail. A separate notification endpoint can process 25 serial eight-second sends inside a 60-second function budget. | Deadline-aware bounded draining, cursor/progress metrics and failure alerts. Retention backlog must not grow indefinitely; all-failed runs must be operationally visible. [retention](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/cron/delete-expired-drafts/route.ts:20>), [notification sweep](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/app/api/cron/send-build-notifications/route.ts:15>) |
| AUD-23 / P3 | The below-fold audience section renders six photos with eager loading, including inactive panels. That creates avoidable requests/decode/optimizer work. | Lazy-load the current panel by viewport; preload others on intent; measure production transfer/LCP before and after. Original image size is not optimized transfer size. [image panels](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/home/audience-picker.tsx:236>) |
| AUD-24 / P2 | Routing station label/number spacing fails the existing browser regression. A separate font-settled probe still measured overlap; at 320px, “Read context” and “Human review” also exceeded their faces. This is label legibility, not stopped playback. | Reserve explicit label/index regions or revise line layout; measure after fonts settle at 1440/760/390/320. The 320px gaps were approximately -31 and -32 SVG units for those labels. [station geometry](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/home/system-animation.tsx:99>), [label CSS](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/home/system-animation.module.css:100>), [measurements](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/motion-diagnostics.spec.ts:18>) |

Optimization candidate, not a measured latency defect: the global account-access provider statically imports the auth dialog and Clerk SignIn/SignUp components. Consider lazy loading the closed dialog after measuring the production route bundle. [dialog boundary](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/src/components/account-access-dialog.tsx:5>).

### Capability boundaries, not regressions

The internal admin is primarily analytics/outreach, not a complete build-detail/review/delivery console. Notification text pointing to “full brief in admin” needs either a real destination or a documented operational handoff. Billing pages read connected records and explicitly describe manual approval; the repository does not contain a complete self-service checkout/payment webhook workflow. Do not present either capability as fully implemented without product scope and integration work.

## Connected-environment observations

The read-only script loaded the local environment and reported configuration presence, not values. Supabase API returned HTTP 200. Counts were 25 request drafts, one build request, four transcription jobs and one notification job. Counts do not establish job health or data accuracy; row contents were intentionally not retrieved.

This audit process had no RESEND_FROM, CRON_SECRET, AJANI_ADMIN_ACCESS_KEY or AJANI_ADMIN_SESSION_SECRET configured. Email sending, scheduled endpoint authorization and full admin login therefore cannot be certified from this setup. Provider keys being present does not establish valid subscriptions, model availability or delivery. Deployed Vercel environment variables were not inspected and must not be inferred from this local environment.

Before a release, reconcile configuration privately, including Clerk live-vs-test mode, webhook signing secret, provider permissions, verified email sender, cron credentials, admin allowlists and rate-limit secrets. Never copy secret values into this report, client bundles or test artifacts.

## Controls that are already useful

- Admin mutations require a Clerk-authorized identity plus a separate signed, expiring, HttpOnly admin session. Production auth intentionally fails closed without live credentials.
- Privileged provider/database clients are server-only; public bodies have size/schema checks and processing acknowledgments.
- Draft access uses a hashed capability token; submission SQL establishes organization ownership and copies the approved request within a transaction.
- Voice objects use private storage, signed upload handling, size checks and basic audio-container validation.
- Transcription and notification queues use database claiming and retry state; notifications include provider idempotency and escaped content.
- Clerk webhooks are signature-verified and have delivery tracking and ordering checks, although the edge cases above remain.
- Portal request loading scopes the parent build to the organization before fetching dependent records.
- Security headers, error/loading boundaries, many reduced-motion fallbacks, debounced tab persistence and listener cleanup are present.
- Existing CI has lint, typecheck, unit, build and Chromium browser jobs.

These controls lower risk; they do not negate the specific gaps.

## Why issues keep recurring

1. **Tests assert local UI events more often than complete outcomes.** A demo can pass play/pause checks while never reaching completion. A recorder can pause/resume successfully while losing an edited amount afterward.
2. **Related state is duplicated without a shared revision.** Live speech, edited transcript, clarified answers, generated route, email brief and persisted build can disagree.
3. **Runtime contracts live outside TypeScript.** An absent SQL function is invisible to mocked API tests and a successful Next build.
4. **Success/retry/terminal behavior is not consistently monotonic.** A ready memo can move backward; an already-completed submission can look unavailable; a crashed final attempt can remain running.
5. **Motion policy and implementation ownership are fragmented.** Different components implement media preference, visibility, timers and fallback handling independently.
6. **Scaling changes correctness, not only speed.** Truncated analytics and slowly drained queues can mislead operators before server load appears alarming.

## Ordered remediation and release gates

### Gate 1: protect accepted work and reconcile contracts

Owner: data lead + voice lead, independently reviewed by audit lead.

- Resolve AUD-01 in staging before any production migration.
- Fix deletion/submission arbitration, transcript edit preservation and canonical notification content.
- Make completion and claim receipts idempotent; reap exhausted leases.
- Add integration fixtures and controlled concurrency tests; do not use customer drafts as disposable fixtures.

Exit: one approved request yields exactly one build, preserved audio and matching client/admin/notification content even after replay, interruption or concurrent deletion.

### Gate 2: make every interactive flow recoverable

Owner: client/voice lead + audit lead.

- Repair desktop demo scheduling.
- Centralize the motion policy without suppressing accessibility preferences.
- Guard storage/observer failures.
- Version and cancel async generation; enforce usable route invariants.
- Repair routing label geometry without changing the approved design direction.

Exit: all current browser tests pass; the audit reproductions become ordinary passing regression tests with their `test.fail()` annotations removed. Test Chromium plus Firefox/WebKit and actual mobile recording devices.

### Gate 3: operational correctness and controlled capacity

Owner: data lead + security/performance lead.

- Separate rate-limit budgets.
- Introduce bounded recovery throughput and one end-to-end request deadline.
- Fix webhook replay/tombstones and concurrent provisioning.
- Move analytics aggregation to the database with stable cohort semantics.
- Harden admin identity/throttle behavior and retention visibility.
- Add targeted production measurements before optional bundle/image optimization.

Exit: tests demonstrate outage recovery and exact analytics totals at realistic volumes; alerting distinguishes delayed, failed, incomplete and healthy work.

### Gate 4: release evidence, not a blanket push

Owner: audit lead; deployment requires explicit user approval.

- Clean `npm ci` in CI; lint/type/unit/build.
- Test the production runtime, not only `next dev`.
- Apply migrations to an isolated environment and assert required RPC schemas.
- Use synthetic fixtures and authenticated test tenants for voice upload → transcript → approval → account → submit → portal → admin → received email.
- Run cross-tenant negative tests, timeout/crash/replay cases and provider fallback checks.
- Record build SHA, migration version and motion-policy version with the release evidence.
- Agree rollback and data-recovery procedures before promoting. No production push is part of this audit.

The installed Next testing guidance also recommends testing production code; current browser configuration launches `next dev`. [installed Playwright guide](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md>), [current browser config](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/playwright.config.ts>), [CI](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/.github/workflows/ci.yml>).

## Operational metrics and acceptance targets to agree

These are proposed engineering contracts, not measured promises:

- User-visible completion/error deadline for each generation/transcription operation.
- Oldest queued/retryable job age and bounded backlog-drain time after an outage.
- Zero silently lost approved edits; zero duplicate builds for replayed submissions.
- Every accepted request has a traceable build receipt and visible notification state.
- Admin totals reconcile to database aggregates and remain stable across retention.
- No cross-tenant access; no admin allowlist acceptance from an unverified email.
- No essential content hidden by a failed animation enhancement.
- Production LCP/INP/CLS, JS/image transfer, endpoint latency percentiles and database query duration tracked against agreed budgets.
- Backup/restore and rollback tested separately; neither was exercised in this audit.

## Reproduction commands and artifacts

Run from the repository root with the existing local preview available:

```powershell
npm run lint
npm run type-check
npx vitest run --maxWorkers=1
npm run build
npx playwright test --workers=2
npx playwright test --config audit/playwright.config.ts --workers=1
node scripts/audit-database-readonly.mjs
```

The standard browser suite uses localhost:3001. The separate audit config deliberately does not launch/restart a server and does not modify the original suite. The read-only DB script uses existing local credentials and outputs only configuration booleans, API function presence and table counts. Its network access may require approval.

Files added by this audit:

- [Functional reliability probes](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/functional-reliability.spec.ts>)
- [Voice reliability probes](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/voice-reliability.spec.ts>)
- [Motion diagnostics](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/motion-diagnostics.spec.ts>)
- [Isolated Playwright configuration](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/audit/playwright.config.ts>)
- [Read-only database inspection](<C:/Users/lime7/Documents/ChatGPT/Desgins/ajani-main-ready/scripts/audit-database-readonly.mjs>)

Browser error contexts, screenshots and traces are under `artifacts/engineering-audit*`; the original suite failure is under `test-results/`. These folders are ignored by Git and contain synthetic browser scenarios, not real submitted recordings. Future passing tests should be moved into the normal regression suite as the corresponding defects are fixed.

## Final limitation

This is an evidence-backed engineering audit, not a penetration test, legal opinion, load-test certification or promise of uninterrupted service. It identifies confirmed local defects, connected-environment mismatches, source-reviewed concurrency risks and the exact remaining production verification work. **A successful build and mostly green UI tests do not yet justify a production-readiness sign-off.**
