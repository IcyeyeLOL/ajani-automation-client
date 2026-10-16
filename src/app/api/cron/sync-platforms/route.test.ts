import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ syncAll: vi.fn() }));
vi.mock("@/lib/connectors/registry", () => ({ syncAllConnectors: mocks.syncAll }));

import { GET } from "@/app/api/cron/sync-platforms/route";

const request = (authorization?: string) => new Request("https://ajaniflow.com/api/cron/sync-platforms", { headers: authorization ? { authorization } : {} });
const run = (connector: string, status: string, reason: string | null = null) =>
  ({ connector, status, reason, date: "2026-10-16", valuesWritten: 2, details: { secretish: 1 } });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.syncAll.mockReset();
});

describe("nightly platform sync", () => {
  it("runs only with the cron secret", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(mocks.syncAll).not.toHaveBeenCalled();
  });

  it("is healthy when every connector synced or is not set up yet, and returns counts only", async () => {
    mocks.syncAll.mockResolvedValue([run("youtube", "synced"), run("instagram", "not_configured")]);
    const response = await GET(request("Bearer cron-secret-value"));
    expect(response.status).toBe(200);
    const body = await response.json() as { results: Array<Record<string, unknown>> };
    expect(body.results[0]).toEqual({ connector: "youtube", status: "synced", reason: null, valuesWritten: 2 });
    expect(JSON.stringify(body)).not.toContain("secretish");
  });

  it("fails the run so Vercel flags it when a connector needs attention", async () => {
    mocks.syncAll.mockResolvedValue([run("youtube", "synced"), run("instagram", "rejected", "token_expired")]);
    expect((await GET(request("Bearer cron-secret-value"))).status).toBe(503);
    mocks.syncAll.mockRejectedValue(new Error("boom"));
    const response = await GET(request("Bearer cron-secret-value"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("boom");
  });
});
