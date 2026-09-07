# Mobile navigation and motion review

## Follow-up: simplified navigation and default playback

The September 6 follow-up supersedes the preference-control design described below. At the owner's explicit request, the mobile menu now contains only Demos, Stories, and Record a note. The pitch card, menu legal links, and motion-settings UI were removed; legal documents remain available in the site footer. The root HTML renders `data-motion="full"` and the `full-v2` policy, so playback is enabled from first render, including devices reporting reduced motion. Previous saved motion preferences no longer determine playback. Individual animation pause controls remain available. This intentionally changes the earlier device-respecting default; it does not change operating-system settings.

Three agents handled menu UI, shared motion behavior, and regression coverage. The integration lead visually inspected the simplified live menu. Follow-up automated verification is recorded separately from the earlier results below.

Follow-up verification: ESLint, TypeScript, and the optimized production build passed. Unit suite: 202 passed initially, with two proxy import timeouts under concurrent build load; both passed in an isolated rerun (204 total). The live preview retained `full-v2` after fresh navigation and the hero visibly advanced from the network to mindmap scene. The credential-free browser suite passed 114 of 117 initially. Two obsolete expectations were corrected; the third failure came from `/request` redirecting while the test inspected layout. All three and an additional hover check passed on targeted rerun (4/4). The new menu and default-motion tests passed in the full run, including legacy saved preferences, OS reduced-motion reports, reloads, and individual pause controls.

Local development changes only. No deployment, push, authentication configuration change, or database mutation.

## Team

- Integration lead: browser inspection, menu redesign, account-dialog handoff, copy, and combined verification.
- Mobile navigation agent: focus, touch targets, scroll locking, links, responsive dismissal, and preference browser regressions.
- Mobile motion agent: hidden-tab, offscreen, completed-workflow, and manual-pause behavior.
- Mobile layout agent: mobile source review, explicit motion preference control, persistence, and preference unit tests.

## Changes

- Replaced the mobile menu with a cream/peach editorial panel, one close button, clear Demos/Stories links, an understated record-note card, and legal links. The scrollable body and fixed close header accommodate small screens and safe-area insets.
- Closing, navigation, and resizing to desktop release the dialog's focus trap and scroll lock. Opening account access dismisses navigation instead of stacking two modal surfaces.
- Changed the homepage eyebrow to **Done for you workflows**, with no hyphens.
- Increased mobile system-title type from 8px to 10px, retaining wrapping; enlarged the hero pause target to 44px.
- Added visible **Play animations** controls in the homepage and mobile menu. The browser inspected reported reduced motion enabled, which previously hid both motion and its playback control. Explicit opt-in now updates CSS and JavaScript together, persists safely, restores on direct route visits, and offers **Use device setting** to undo it. Device settings are never modified; denied storage does not prevent the current-visit choice.
- Fixed a real mobile demo bug: backgrounding during a completed workflow's hold could start the next scenario invisibly. Background/desktop transitions now cancel autoplay, and offscreen playback pauses without overriding a user's manual pause.
- Removed obsolete menu panel styles from the shared stylesheet; the replacement is isolated in `mobile-site-menu.module.css`.

## Verification

Focused navigation tests: 8 passed. Focused mobile motion tests: 4 passed. Preference unit tests: 7 passed.

Final combined verification: all **115 Chromium browser tests passed** against the optimized production build, with no retries; all **206 unit tests across 44 files passed**. ESLint, TypeScript, production build, and whitespace checks passed. Browser coverage includes 320/390px phones and wider responsive breakpoints, default reduced motion, explicit opt-in persistence, hidden/offscreen pauses, menu focus and scroll restoration, public navigation, and recording regressions.

The local in-app preview was explicitly switched to full animations through the new control. Its hero was observed progressing from the network to the routing scene with a running CSS animation clock. Automated browser checks use isolated contexts and credential-free production-build preview semantics. They do not certify physical iOS/Android devices or live authentication/provider integrations.
