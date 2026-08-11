# Ajani Automation: Next-Agent Implementation Plan

## Mission

Turn Ajani Automation from a visual prototype into a reliable, client-facing product. Preserve the current Ajani design language while making the request funnel, authentication, portal, and status information real.

The north star is simple: every interaction should make a prospective client feel understood, not make them feel like they are completing paperwork.

## Current Baseline

- App: Next.js 16 App Router in `C:\Users\lime7\Documents\ChatGPT\Desgins\ajani-automation`.
- Existing services: Clerk SDK, Supabase SDK, Stripe SDK, Zod, and a Supabase schema migration.
- Clerk SDK is installed, but live Clerk keys have not been added to `.env.local`.
- Clerk MCP is already configured globally as `mcp_servers.clerk`. It may require a fresh Codex session before its tools appear.
- The Supabase schema uses Clerk user IDs as text and RLS reads the Clerk JWT `sub` claim. Do not revert it to `auth.uid()`.
- The request funnel and portal are still mostly mock UI. The `POST /api/build-requests` route and the database foundation exist, but the full funnel does not persist data yet.
- Current styling lives primarily in `src/app/globals.css`. It is functional as a prototype but is too centralized for a larger product.
- No real test suite exists for Ajani yet.

## Source Reference: Script Player

Reference project: `C:\Users\lime7\Documents\GitHub\script-player`

Use Script Player for interaction architecture and engineering discipline, not for visual imitation. Its useful patterns are:

1. Tailwind v4 with semantic tokens rather than arbitrary one-off colors.
2. Radix primitives for dialogs, popovers, menus, tabs, selects, tooltips, and accessible keyboard behavior.
3. Small focused components instead of one large screen component.
4. Purposeful UI states: active, pending, complete, error, disabled, empty, loading, and success.
5. Responsive behavior built into components rather than added as an afterthought.
6. Clear focus styles and `prefers-reduced-motion` support.
7. Type checks plus unit, smoke, and E2E tests.

Do **not** copy Script Player's colors, type choices, utility-class density, or product metaphor. Ajani retains its ink, pearl, crimson, and sand visual identity.

## Decisions Already Made

- Keep Next.js. Do not migrate Ajani to Vite, Cloudflare Workers, or the Script Player stack.
- Use Clerk for authentication and Supabase for application data and file storage.
- Account creation happens after the client has described the problem, completed clarification, reviewed the logic, and is ready to request the build. Do not gate the first part of the funnel behind authentication.
- Use Clerk Organizations for B2B tenancy: one organization represents one client business. A client may later invite team members.
- The final `REQUEST BUILD` action opens account access in an overlay. It must not feel like a route change or a form interruption.
- Keep the full-page `/sign-in` and `/sign-up` routes only as Clerk fallbacks and callback destinations. Do not link normal visitors to them from the site header.
- Do not introduce em dashes in user-facing copy.

## Phase 0: Stabilize the Development Baseline

### Tasks

1. Review the working tree before editing. Preserve unrelated user changes.
2. Start the app and confirm `/`, `/demos`, `/request`, and `/portal` load.
3. Confirm Clerk MCP tools are available in the fresh agent session. Use them only for current Clerk patterns and snippets.
4. Add a concise `README` section listing local setup, required environment variables, and the test commands.
5. Introduce a test baseline:
   - Vitest for pure utilities and server validation.
   - Playwright for the public funnel and authenticated portal journey.
   - Keep `npm run build`, `npm run lint`, and `npm run type-check` green.

### Acceptance Criteria

- A new developer can identify every required environment variable.
- The app has one command for unit tests and one for E2E tests.
- The CI-ready checks run without live API credentials where possible.

## Phase 1: Create a Durable UI Foundation

### Tasks

1. Add Tailwind v4 and PostCSS without redesigning the site in one pass.
2. Establish semantic Ajani tokens in CSS variables:
   - Surfaces: `surface`, `surface-raised`, `surface-inverse`.
   - Content: `content`, `content-muted`, `content-inverse`.
   - Intent: `brand`, `brand-hover`, `success`, `warning`, `danger`.
   - Structure: `border`, `border-strong`, `focus-ring`.
   - Motion: duration and easing tokens.
3. Add `clsx`, `tailwind-merge`, and `class-variance-authority` for predictable component variants.
4. Add only the required Radix primitives first:
   - Dialog for account access and confirmation states.
   - Dropdown Menu for account actions.
   - Popover or Tooltip for contextual help.
   - Progress for request and build status.
5. Build reusable Ajani primitives:
   - `Button`, `IconButton`, `Card`, `StatusBadge`, `SectionHeader`.
   - `Modal`, `Field`, `EmptyState`, `LoadingState`, `ErrorState`.
   - `StepProgress`, `Timeline`, and `SystemBlock`.
6. Move CSS gradually. Do not convert every existing class in one pull request.

### Acceptance Criteria

- New screens use semantic tokens and shared primitives.
- Every focusable control has a visible keyboard focus state.
- Motion respects `prefers-reduced-motion`.
- The new system preserves Ajani's current visual identity and responsive layout.

## Phase 2: Implement Clerk Properly

### Clerk MCP Work

1. Ask Clerk MCP for the current Next.js App Router patterns for:
   - `auth-basics`.
   - `custom-flows` for embedded sign-in/sign-up.
   - `b2b-saas` and `organizations`.
   - Server-side protection and webhook patterns.
2. Follow current Clerk documentation if MCP guidance conflicts with existing app code.

### Tasks

1. Add real Clerk keys to `.env.local` locally. Never commit keys.
2. Keep `ClerkProvider` at the root and apply Clerk's current route middleware or proxy guidance.
3. Replace the CSS hash-target fallback with a real accessible Radix `Dialog` that mounts Clerk's `SignIn` or `SignUp` component inside it.
4. Header `Sign in` opens the dialog in sign-in mode.
5. At the end of the request flow, `REQUEST BUILD` opens the same dialog in a contextual mode: "Create an account to save and request this build."
6. On successful authentication, return the user to the exact pending request state, not a generic portal screen.
7. Add Clerk Organizations:
   - Create or select an organization during post-auth onboarding.
   - Capture business name, phone, industry, preferred contact method, and role.
   - Use organization membership for tenant access.
8. Add a Clerk webhook route for user and organization lifecycle events. Verify webhook signatures.
9. Upsert the matching `profiles`, `organizations`, and `organization_members` records in Supabase from trusted server-side code.
10. Verify Clerk JWT templates and Supabase RLS claims. Do not rely on client-side organization checks for authorization.

### Acceptance Criteria

- Sign in and sign up happen in the overlay for normal user journeys.
- Closing the overlay returns the user to the exact current view.
- A signed-in user can only access their own organization data.
- A Clerk user and a Supabase profile/organization membership are reliably synchronized.
- `/portal` and build API routes reject anonymous access.

## Phase 3: Make the Request Funnel Real

### Tasks

1. Represent the request flow as a persisted state machine, not a screen-only mock.
2. Use Zod schemas for each submitted payload.
3. Add a build-request draft record before account creation, associated with an anonymous draft token stored securely.
4. Capture the voice memo through a real upload flow:
   - Request a signed Supabase Storage upload URL.
   - Upload the audio directly.
   - Store audio metadata and a draft transcript record.
5. Add placeholders for asynchronous processing status: uploaded, transcribing, extracting, clarifying, reviewed, quoted, requested.
6. After sign-in, claim the draft and associate it with the authenticated user and organization.
7. Persist clarification answers, editable system blocks, the final scope reflection, and the selected price tier.
8. Do not implement Claude, Twilio, n8n, or Stripe processing in the same pass unless the data contract is ready. Define stable interfaces first.

### Acceptance Criteria

- A user can refresh the page and continue a saved request.
- The system validates every stage and renders clear error or retry states.
- The final request produces a structured database record tied to the authenticated organization.

## Phase 4: Build the Real Client Portal

### Tasks

1. Replace portal mock data with server-side Supabase queries protected by Clerk identity and RLS.
2. Implement portal modules:
   - Active systems with health, last successful run, errors, and next action.
   - Build history with statuses: quoted, in review, in progress, live, needs attention.
   - Build detail page with original scope, transcript, approved workflow, delivery timeline, and messages.
   - Billing summary and invoice history once Stripe is connected.
3. Add a persistent `Request a build` entry point for existing customers. Prefill known business context but continue to ask only new gap-fill questions.
4. Add explicit loading, empty, error, and offline or retry views.
5. Add audit-friendly event records for requests, quotes, payment status, status updates, and provisioning actions.

### Acceptance Criteria

- No portal metrics or statuses are hard-coded.
- The portal is useful for a first-time user with no systems and an established user with several systems.
- A user never sees another organization's builds, billing, files, or status data.

## Phase 5: Integrations and Operations

### Tasks

1. Add Stripe checkout only after scope and price are persisted.
2. Add signed Stripe webhook handling with idempotency.
3. Define the n8n event contract for transcription, extraction, gap-fill, quote delivery, payment success, and provisioning.
4. Add the internal Ajani notification email with the build ID, client information, approved scope, price, and portal link.
5. Add operational observability before launch:
   - Structured logs.
   - Error reporting.
   - Traceable webhook and job statuses.
   - Alerts for failed transcription, payment, provisioning, and status sync.

### Acceptance Criteria

- Webhook processing is idempotent and observable.
- A failure has a visible state for both Ajani operations and the client.
- No API secret is exposed to the browser.

## Required End-to-End Journeys

Automate these journeys in Playwright before calling the product production-ready:

1. Public visitor opens a demo and sees all four stages run.
2. Public visitor completes the request flow and opens the account dialog without losing progress.
3. New user signs up, creates or joins a business organization, and claims the request draft.
4. Signed-in user refreshes and resumes the request.
5. User submits the request and sees it appear in portal history.
6. User from Organization A cannot fetch or view Organization B data.
7. Keyboard-only user can navigate, open, and close dialogs, menus, and the request flow.

## Guardrails

- Do not replace Ajani's design with a generic shadcn or default Tailwind aesthetic.
- Do not gate voice memo, clarification, or reflection behind sign-in.
- Do not leave controls that look interactive but do nothing.
- Do not use client-side checks as the security boundary.
- Do not write production credentials into the repository.
- Do not perform a large CSS rewrite before tests and primitives exist.
- Keep copy free of em dashes.

## Expected Handoff From the Next Agent

At the end of each implementation slice, report:

1. The exact user journey that now works.
2. The files changed and why.
3. The tests run and their results.
4. Any environment variables, webhook setup, Clerk Dashboard configuration, or user action still required.
5. Any decisions that need approval before expanding scope.
