# Ajani Automation

## Local development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Create `.env.local` from the following inventory. Values marked optional are not needed to run the public experience or the CI-ready checks.

| Variable | Required for | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk UI | Never expose the secret key. |
| `CLERK_SECRET_KEY` | Clerk server authentication | Enables protected routes and API access. |
| `CLERK_WEBHOOK_SECRET` | Clerk lifecycle webhooks | Required when the webhook route is added. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client and server access | Project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase client and server access | Publishable project key, not a service-role key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server provisioning and signed storage URLs | Keep server-only. |
| `STRIPE_SECRET_KEY` | Billing, later phase | Keep server-only. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks, later phase | Keep server-only. |
| `NEXT_PUBLIC_APP_URL` | Redirect and webhook URLs | For example, `http://localhost:3000`. |

Do not commit `.env.local` or any production credential.

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
