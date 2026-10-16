import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { syncDripifyMetrics } = vi.hoisted(() => ({ syncDripifyMetrics: vi.fn() }));
vi.mock("@/lib/connectors/dripify", () => ({ syncDripifyMetrics }));

import { GET } from "@/app/api/cron/sync-dripify/route";

const authorized = () => new Request("https://ajani.test/api/cron/sync-dripify", { headers: { authorization: "Bearer cron-secret" } });
const result = (overrides: Record<string, unknown>) => ({
  status: "synced", reason: null, date: "2026-10-16", campaigns: 2, synced: 2, deferred: 0, failed: 0, valuesWritten: 8, labelsWritten: 2, ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Dripify sync cron", () => {
  it.each([
    ["no header", undefined],
    ["the wrong secret", "Bearer not-the-secret"],
  ])("refuses %s before contacting Dripify", async (_label, authorization) => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const response = await GET(new Request("https://ajani.test/api/cron/sync-dripify", authorization ? { headers: { authorization } } : {}));
    expect(response.status).toBe(401);
    expect(syncDripifyMetrics).not.toHaveBeenCalled();
  });

  it("refuses every caller when no cron secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(new Request("https://ajani.test/api/cron/sync-dripify", { headers: { authorization: "Bearer " } }));
    expect(response.status).toBe(401);
    expect(syncDripifyMetrics).not.toHaveBeenCalled();
  });

  it.each([
    ["a full sync", "synced", 200],
    ["no key yet", "not_configured", 200],
    ["a partial sync", "partial", 503],
    ["a rejected key", "rejected", 503],
  ])("reports %s as HTTP %s", async (_label, status, httpStatus) => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    syncDripifyMetrics.mockResolvedValue(result({ status }));
    const log = vi.spyOn(console, httpStatus === 200 ? "info" : "error").mockImplementation(() => undefined);
    const response = await GET(authorized());
    expect(response.status).toBe(httpStatus);
    await expect(response.json()).resolves.toMatchObject({ status });
    expect(syncDripifyMetrics).toHaveBeenCalledWith({ deadlineAt: expect.any(Number) });
    log.mockRestore();
  });

  it("fails observably without leaking error detail", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    syncDripifyMetrics.mockRejectedValue(new Error("upsert failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(authorized());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Dripify sync could not run." });
    log.mockRestore();
  });
});
