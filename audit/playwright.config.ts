import { defineConfig, devices } from "@playwright/test";

// Permanent reliability regressions. No expected failures: all must pass.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../artifacts/engineering-audit",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001",
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    permissions: ["microphone"],
    trace: "retain-on-failure",
  },
});
