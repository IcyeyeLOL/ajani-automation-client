# Demo motion handoff — September 8, 2026

The Demos page now borrows the homepage terminal's visible cause and effect: material arrives, Ajani interprets it, an output takes shape, and a person receives the handoff. This replaces the earlier caramel palette and mostly static miniature application screens.

## Visual direction

Use graphite chrome, porcelain canvas, white source material, carmine signals, and mint delivery states. Preserve the small `a.` mark. The animated objects are the primary explanation; the chapter rail and event list provide optional inspection.

- After-hours leads: a message arrives, a scan extracts intent, a reply types and sends, and Mia receives the context.
- Client intake: source sheets gather, the missing approval owner separates into an open question, the brief assembles, and the team receives it. The unresolved question remains visible.
- Returning clients: activity pings connect to Jordan's history, a personal check-in composes, and an owner receives the follow-up context.

These are explicitly illustrative examples. Animation does not make network requests or represent a real customer conversation.

## Implementation and playback contract

- `src/components/demo-artifact.tsx` and its CSS module own the shared objects and choreography. Desktop and mobile use the same scene components. CSS performs a bounded sequence within each three-second step.
- `src/components/demo-grid.tsx` owns desktop state, visible-entry autoplay, the three-scenario showcase, and manual controls. Its observer targets a stable element outside the scenario-keyed grid.
- `src/components/mobile-demo-theatre.tsx` retains the fixed controls and scrolling player, with a compact source strip, processing lane, output, and human handoff.
- `src/lib/motion/use-demo-timer.ts` preserves remaining time across pauses, keeping JavaScript progression aligned with CSS playback. A distinct phase resets the duration.
- The artifact's `settled` prop distinguishes explicit inspection from pausing in flight. Inspecting even the current step shows the full output immediately. Continue starts that inspected phase afresh. Pause freezes the current pose.
- Offscreen playback waits. A hidden document or departure from desktop/mobile view cancels the relevant showcase. Explicit pause, restart, step, and scenario controls prevent an observer from restarting playback unexpectedly.
- Motion follows the application's existing preference policy. System fallback remains manual and readable; the existing explicit full-showcase behavior remains available on mobile.
- The one-millisecond character reveals use linear easing. A stepped endpoint can round below its final threshold in Chrome, leaving letters invisible even after the animation finishes. Frame-sampled regressions require the complete reply before its sent status appears.
- Header dots fill cumulatively from the selected scenario: one for 01, two for 02, three for 03. Returning to 01 resets the visible count.
- The typing caret anchors to the latest revealed character, including wrapped lines. Character-length CSS windows move it while a synchronized blink runs on its pseudo-element. Pausing freezes both; settled scenes and the sent state hide it.

The current Demos page width and heading scale are preserved. On tablet, the event summary moves below the animation. Compact intake sheets use shallow rotations so they clear the title divider and source counts.

## Team and verification

The integration lead owns parent clocks and page/chrome styling. The motion engineer owns the shared scene components. The design reviewer evaluates current screenshots and recorded frames. The QA reviewer independently checks state, actual object geometry, pause behavior, preferences, and responsive fit. Overlapping source writes are serialized.

Relevant regression coverage:

- `tests/demo-choreography.spec.ts`
- The automation tests in `tests/public-funnel.spec.ts`
- `tests/mobile-demo.spec.ts`
- Mobile showcase tests in `tests/mobile-motion-review.spec.ts`
- Demo motion-policy checks in `audit/motion-policy-regressions.spec.ts`

Local review artifacts are in `.tmp/demo-motion-v2/`, including screenshots at 320, 390, 769, 980, 1440, and 1920 pixels and a recording of all three workflows. Treat those as evidence, not source to restore over later edits. The local preview is `http://localhost:3001/demos`.

Validation completed: 30 unique browser cases passed (15 existing demo regressions and 15 choreography cases), scoped ESLint passed, and the production build compiled, type-checked, and generated all routes. The final CSS typing correction passed both frame-sampled reply regressions and all three geometry/pause cases. The design reviewer accepted the current desktop, tablet, and compact phone layouts after the intake-sheet clearance correction.

The subsequent dots/caret polish passed eight focused browser checks, scoped ESLint, and TypeScript. Screenshots and geometry evidence are in `.tmp/demo-cursor-v3/`. This review covers cumulative dots and their showcase reset, the caret following proportional text across line wraps on desktop and mobile, synchronized blinking and pause, settled/reduced motion, and reply-before-sent ordering. Empty DOM Ranges for collapsed wrap spaces use the inline span's geometry in the test; actual glyphs retain the strict alignment assertion. The local server was restored on port 3001 using Next's default host binding.
