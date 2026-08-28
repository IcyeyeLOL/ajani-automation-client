# Ajani Automation

## Local development

Install dependencies and start the app:

```bash
npm install
npm run dev -- --hostname localhost --port 3001
```

Open [http://localhost:3001](http://localhost:3001).

Create `.env.local` from the following inventory. Values marked optional are not needed to run the public experience or the CI-ready checks.

| Variable | Required for | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk UI | Never expose the secret key. |
| `CLERK_SECRET_KEY` | Clerk server authentication | Enables protected routes and API access. |
| `CLERK_WEBHOOK_SECRET` | Clerk lifecycle webhooks | Required by `/api/webhooks/clerk`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client and server access | Project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase client and server access | Publishable project key, not a service-role key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server provisioning and signed storage URLs | Keep server-only. |
| `AJANI_ADMIN_ACCESS_KEY` | Internal admin login | Separate server-only access key. |
| `AJANI_ADMIN_SESSION_SECRET` | Internal admin sessions | Long random server-only signing secret. |
| `AJANI_ADMIN_USER_ID_ALLOWLIST` | Internal admin authorization | Comma-separated Clerk user IDs. |
| `CRON_SECRET` | Protected cleanup and intake workers | Vercel sends this as a bearer token to cron routes. |
| `REQUEST_RATE_LIMIT_SECRET` | Anonymous intake throttling | Dedicated random secret used only to hash request fingerprints. |
| `AJANI_ADMIN_EMAIL_ALLOWLIST` | Internal admin authorization | Comma-separated Ajani team email addresses. |
| `AI_GATEWAY_API_KEY` | AI clarification and workflow generation | Optional when Vercel OIDC is available. Keep server-only. |
| `ANTHROPIC_API_KEY` | Direct AI-provider fallback | Optional server-only fallback. |
| `REQUEST_DEMAND_MODEL` | Saved-request demand classification | Optional Vercel AI Gateway model override. |
| `AUTOMATION_WORKFLOW_MODEL` | Clarification and workflow generation | Optional Vercel AI Gateway model override. |
| `DEEPGRAM_API_KEY` | Private voice transcription | Server-only; Nova-3 processing opts out of model improvement. |
| `RESEND_API_KEY` | Internal build notifications | Server-only Resend credential. |
| `RESEND_FROM` | Internal build notifications | Verified sender, such as `Ajani Automation <requests@yourdomain.com>`. |
| `INTERNAL_NOTIFICATION_TO` | Internal build notifications | Delivery recipient only; it does not grant admin access. |
| `STRIPE_SECRET_KEY` | Billing, later phase | Keep server-only. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks, later phase | Keep server-only. |
| `NEXT_PUBLIC_APP_URL` | Redirect and webhook URLs | `http://localhost:3001` locally and `https://ajaniflow.com` in production. |

Do not commit `.env.local` or any production credential.

Production must use Clerk `pk_live_`/`sk_live_` credentials. The proxy deliberately returns a non-cacheable 503 when live credentials are missing or test credentials are deployed. Apply every Supabase migration before accepting requests. Normal handoff notifications and voice transcription run immediately; the Hobby-compatible daily intake worker retries failed jobs and performs retention cleanup. A sub-daily retry sweep requires a Vercel plan that supports more frequent cron execution.

## Checks

```bash
npm run lint
npm run type-check
npm run test:unit
npm run test:e2e
npm run build
```

`npm run test:unit` runs pure validation and server-utility tests. `npm run test:e2e` runs Playwright against a local development server and needs the Chromium browser installed once:

```bash
npx playwright install chromium
```

## Architecture

Ajani uses Clerk for identity and organization tenancy, Supabase for application data and private voice-memo storage, and Stripe for billing once an approved scope is ready. The request funnel remains public until the client asks to save and submit their build. Server-side authorization and Supabase RLS are the security boundary.
