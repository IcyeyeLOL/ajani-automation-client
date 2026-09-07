import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
const hostname = process.env.PLAYWRIGHT_HOST ?? "localhost";
const baseURL = `http://${hostname}:${port}`;
const productionBuild = process.env.PLAYWRIGHT_PRODUCTION === "1";
// A production-optimized, credential-free preview runtime. Keep production's
// fail-closed authentication unchanged; external integrations are mocked in E2E.
const isolatedEnvironment = productionBuild ? {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  CLERK_SECRET_KEY: "",
  CLERK_WEBHOOK_SECRET: "",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  AI_GATEWAY_API_KEY: "",
  VERCEL_OIDC_TOKEN: "",
  ANTHROPIC_API_KEY: "",
  DEEPGRAM_API_KEY: "",
  RESEND_API_KEY: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  AJANI_ADMIN_ACCESS_KEY: "",
  AJANI_ADMIN_SESSION_SECRET: "",
  CRON_SECRET: "",
} : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/**/*.spec.ts", "audit/*.spec.ts"],
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL,
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    permissions: ["microphone"],
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: productionBuild
      ? `npm run build && npm run start -- --hostname ${hostname} --port ${port}`
      : `npm run dev -- --hostname ${hostname} --port ${port}`,
    env: isolatedEnvironment,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !productionBuild,
    timeout: productionBuild ? 240_000 : 120_000,
  },
});
