import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

import {
  DRIPIFY_ACTOR, campaignsForRun, dripifySyncMessage, retryAfterMs, statisticCounts, syncDripifyMetrics,
  type DripifyCampaign, type DripifySyncResult,
} from "@/lib/connectors/dripify";

const NOW = Date.parse("2026-10-16T22:10:00Z");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const stats = (campaignId: number, overrides: Record<string, unknown> = {}) => ({
  campaignId, totalLeads: 200, contactedLeads: 150, acceptanceRate: 30.0, acceptanceRateLeads: 45,
  replyRate: 12.5, replyRateLeads: 12, leadStatusBreakdown: { inProgress: 80 }, active: true, ...overrides,
});

/** Routes Dripify paths to handlers; anything unexpected fails the test. */
function dripify(routes: Record<string, (url: URL) => Response>) {
  mocks.fetch.mockImplementation(async (input: string) => {
    const url = new URL(input);
    const route = routes[url.pathname.replace("/v1/open-api", "")];
    if (!route) throw new Error(`unexpected request ${url.pathname}`);
    return route(url);
  });
}

function writes(name: string) {
  return mocks.rpc.mock.calls.filter(([rpc]) => rpc === name).map(([, args]) => args);
}

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("DRIPIFY_API_KEY", "dripify-test-key");
  mocks.rpc.mockImplementation(async (_name: string, args: { p_values?: unknown[]; p_labels?: unknown[] }) => ({
    data: (args.p_values ?? args.p_labels ?? []).length, error: null,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.rpc.mockReset();
  mocks.fetch.mockReset();
});

describe("Dripify sync", () => {
  it("does nothing until a key is configured", async () => {
    vi.stubEnv("DRIPIFY_API_KEY", "  ");
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "not_configured", date: "2026-10-16", valuesWritten: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("snapshots every launched campaign as exact per-campaign counts under the run's UTC day", async () => {
    dripify({
      "/campaigns": (url) => url.searchParams.get("cursor") === "page 2"
        ? json({ items: [{ id: 30, name: "Paused  \n agents", status: "NOT_ACTIVE" }], nextCursor: null, limit: 100 })
        : json({ items: [
          { id: 10, name: "Insurance owners TX", status: "ACTIVE" },
          { id: 20, name: "Never launched", status: "DRAFT" },
        ], nextCursor: "page 2", limit: 100 }),
      "/campaigns/10/statistics": () => json(stats(10)),
      "/campaigns/30/statistics": () => json(stats(30, { totalLeads: 90 })),
    });

    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });

    expect(result).toEqual({
      status: "synced", reason: null, date: "2026-10-16", campaigns: 2, synced: 2, deferred: 0, failed: 0, valuesWritten: 8, labelsWritten: 2,
    } satisfies DripifySyncResult);
    const [first] = mocks.fetch.mock.calls;
    expect(first[0]).toBe("https://api.dripify.com/v1/open-api/campaigns?limit=100");
    expect(first[1].headers).toMatchObject({ "x-api-key": "dripify-test-key" });
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toContain("https://api.dripify.com/v1/open-api/campaigns?limit=100&cursor=page%202");
    expect(mocks.fetch.mock.calls.map(([url]) => url)).not.toContain("https://api.dripify.com/v1/open-api/campaigns/20/statistics");

    const [values] = writes("upsert_analytics_metric_values");
    expect(values).toMatchObject({ p_origin: "connector", p_actor: DRIPIFY_ACTOR });
    expect(values.p_values).toEqual(expect.arrayContaining([
      { metricKey: "dripify.leads_total", date: "2026-10-16", dimension: "dripify:10", value: 200 },
      { metricKey: "dripify.leads_contacted", date: "2026-10-16", dimension: "dripify:10", value: 150 },
      { metricKey: "dripify.leads_accepted", date: "2026-10-16", dimension: "dripify:10", value: 45 },
      { metricKey: "dripify.leads_replied", date: "2026-10-16", dimension: "dripify:10", value: 12 },
      { metricKey: "dripify.leads_total", date: "2026-10-16", dimension: "dripify:30", value: 90 },
      { metricKey: "dripify.leads_contacted", date: "2026-10-16", dimension: "dripify:30", value: 150 },
    ]));
    expect(values.p_values).toHaveLength(8);
    // Percentages are never stored.
    expect(JSON.stringify(values.p_values)).not.toMatch(/rate/i);
    const [labels] = writes("upsert_analytics_dimension_labels");
    expect(labels.p_labels).toHaveLength(2);
    expect(labels.p_labels).toEqual(expect.arrayContaining([
      { dimension: "dripify:10", label: "Insurance owners TX" },
      { dimension: "dripify:30", label: "Paused agents" },
    ]));
  });

  it("stores nothing for a campaign whose statistics come back incomplete", async () => {
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "Complete", status: "ACTIVE" }, { id: 30, name: "Incomplete", status: "ACTIVE" }], nextCursor: null, limit: 100 }),
      "/campaigns/10/statistics": () => json(stats(10)),
      // A count Dripify leaves out is never stored as zero, and the others are not stored without it.
      "/campaigns/30/statistics": () => json(stats(30, { replyRateLeads: undefined, totalLeads: -1 })),
    });

    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });

    expect(result).toMatchObject({ status: "partial", reason: "failures", synced: 1, failed: 1, valuesWritten: 4 });
    const [values] = writes("upsert_analytics_metric_values");
    expect(values.p_values).toHaveLength(4);
    expect(JSON.stringify(values.p_values)).not.toContain("dripify:30");
  });

  it.each([
    [401, "invalid_key"],
    [403, "plan_without_api"],
    [404, "api_disabled"],
  ])("explains a %i from Dripify without writing anything", async (status, reason) => {
    dripify({ "/campaigns": () => json({ status, error: "Error", message: "No" }, status) });
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "rejected", reason, valuesWritten: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("treats a campaign deleted mid-run as gone, not as a failure", async () => {
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "A", status: "ACTIVE" }, { id: 11, name: "B", status: "ACTIVE" }], nextCursor: null }),
      "/campaigns/10/statistics": () => json(stats(10)),
      "/campaigns/11/statistics": () => json({ status: 404, error: "Not Found", message: "Missing" }, 404),
    });
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "synced", campaigns: 2, synced: 1, deferred: 0, failed: 0 });
  });

  it("keeps the readable campaigns when one keeps failing, and reports the gap", async () => {
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "A", status: "ACTIVE" }, { id: 11, name: "B", status: "ACTIVE" }], nextCursor: null }),
      "/campaigns/10/statistics": () => json(stats(10)),
      "/campaigns/11/statistics": () => json({ status: 500 }, 500),
    });
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "partial", reason: "failures", synced: 1, failed: 1, valuesWritten: 4 });
    // Two retries (one, then two seconds apart), then the failure is counted.
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/campaigns/11/statistics"))).toHaveLength(3);
  }, 10_000);

  it("waits out a rate limit for the whole key, then continues", async () => {
    let limited = false;
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "A", status: "ACTIVE" }], nextCursor: null }),
      "/campaigns/10/statistics": () => {
        if (limited) return json(stats(10));
        limited = true;
        return json({ status: 429 }, 429, { "retry-after": "0" });
      },
    });
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "synced", synced: 1 });
  });

  it("stops politely when Dripify keeps rate limiting", async () => {
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "A", status: "ACTIVE" }], nextCursor: null }),
      "/campaigns/10/statistics": () => json({ status: 429 }, 429, { "retry-after": "600" }),
    });
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "partial", reason: "rate_limited", synced: 0, deferred: 1, valuesWritten: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never starts a request it cannot finish before the write reserve", async () => {
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 5_000, now: NOW });
    expect(result).toMatchObject({ status: "partial", reason: "deadline", campaigns: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("caps one run at the request budget and defers the rest instead of failing", async () => {
    const items = Array.from({ length: 60 }, (_, index) => ({ id: index + 1, name: `C${index + 1}`, status: "ACTIVE" }));
    mocks.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input);
      const match = url.pathname.match(/\/campaigns\/(\d+)\/statistics$/);
      return match ? json(stats(Number(match[1]))) : json({ items, nextCursor: null });
    });
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "synced", campaigns: 60, synced: 49, deferred: 11 });
    expect(mocks.fetch).toHaveBeenCalledTimes(50);
  });

  it("rejects a cursor that repeats instead of looping", async () => {
    dripify({ "/campaigns": () => json({ items: [], nextCursor: "same" }) });
    await expect(syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW })).rejects.toThrow("dripify_cursor_repeated");
  });

  it("saves the counts even when campaign names cannot be saved", async () => {
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "A", status: "ACTIVE" }], nextCursor: null }),
      "/campaigns/10/statistics": () => json(stats(10)),
    });
    mocks.rpc.mockImplementation(async (name: string) => name === "upsert_analytics_dimension_labels"
      ? { data: null, error: { code: "PGRST202" } }
      : { data: 4, error: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW });
    expect(result).toMatchObject({ status: "synced", valuesWritten: 4, labelsWritten: null });
    log.mockRestore();
  });

  it("surfaces a database failure so the run is retried", async () => {
    dripify({
      "/campaigns": () => json({ items: [{ id: 10, name: "A", status: "ACTIVE" }], nextCursor: null }),
      "/campaigns/10/statistics": () => json(stats(10)),
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    await expect(syncDripifyMetrics({ deadlineAt: Date.now() + 50_000, now: NOW })).rejects.toMatchObject({ code: "PGRST202" });
  });
});

describe("Dripify sync helpers", () => {
  const campaign = (id: number, status = "ACTIVE"): DripifyCampaign => ({ id, name: `C${id}`, status });

  it("reads active campaigns first and rotates the rest so every campaign is refreshed in turn", () => {
    const campaigns = [campaign(1, "NOT_ACTIVE"), campaign(2), campaign(3, "NOT_ACTIVE"), campaign(4, "NOT_ACTIVE"), campaign(5, "NOT_ACTIVE")];
    expect(campaignsForRun(campaigns, 10, 0).map((item) => item.id)).toEqual([2, 1, 3, 4, 5]);
    const covered = new Set([0, 1, 2, 3].flatMap((day) => campaignsForRun(campaigns, 3, day).map((item) => item.id)));
    expect(campaignsForRun(campaigns, 3, 0)[0].id).toBe(2);
    expect(covered).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(campaignsForRun(campaigns, 0, 4)).toEqual([]);
  });

  it("accepts only whole, non-negative counts for the requested campaign", () => {
    expect(statisticCounts(stats(7), 8)).toBeNull();
    expect(statisticCounts({ campaignId: 7, totalLeads: 1.5, contactedLeads: "4", acceptanceRateLeads: -2 }, 7)).toBeNull();
    expect(statisticCounts(stats(7, { totalLeads: 0, contactedLeads: 0, acceptanceRateLeads: 0, replyRateLeads: 0 }), 7)).toEqual([
      ["dripify.leads_total", 0], ["dripify.leads_contacted", 0], ["dripify.leads_accepted", 0], ["dripify.leads_replied", 0],
    ]);
  });

  it("records a campaign's rate counts together or not at all, so a rate never mixes days", () => {
    expect(statisticCounts(stats(7, { contactedLeads: null }), 7)).toBeNull();
    expect(statisticCounts(stats(7, { replyRateLeads: 1.5 }), 7)).toBeNull();
    // Leads loaded feeds no rate, so its absence does not hold back the others.
    expect(statisticCounts({ campaignId: 7, contactedLeads: 150, acceptanceRateLeads: 45, replyRateLeads: 12 }, 7)).toEqual([
      ["dripify.leads_contacted", 150], ["dripify.leads_accepted", 45], ["dripify.leads_replied", 12],
    ]);
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("2")).toBe(2_000);
    expect(retryAfterMs("Fri, 16 Oct 2026 22:10:30 GMT", NOW)).toBe(30_000);
    expect(retryAfterMs("soon")).toBe(5_000);
    expect(retryAfterMs(null)).toBe(5_000);
  });

  it("explains every outcome in plain language without provider detail", () => {
    const base: DripifySyncResult = { status: "synced", reason: null, date: "2026-10-16", campaigns: 3, synced: 3, deferred: 0, failed: 0, valuesWritten: 12, labelsWritten: 3 };
    expect(dripifySyncMessage(base)).toEqual({ status: "success", message: "Synced 3 of 3 campaigns for 2026-10-16 (UTC)." });
    expect(dripifySyncMessage({ ...base, campaigns: 0, synced: 0 }).message).toMatch(/no launched campaigns/);
    expect(dripifySyncMessage({ ...base, status: "not_configured" }).message).toMatch(/DRIPIFY_API_KEY/);
    expect(dripifySyncMessage({ ...base, status: "rejected", reason: "invalid_key" }).message).toMatch(/did not accept the API key/);
    expect(dripifySyncMessage({ ...base, status: "rejected", reason: "plan_without_api" }).message).toMatch(/plan does not include API access/);
    expect(dripifySyncMessage({ ...base, status: "rejected", reason: "api_disabled" }).message).toMatch(/switched off/);
    expect(dripifySyncMessage({ ...base, status: "partial", reason: "rate_limited", synced: 1 })).toEqual({
      status: "error", message: "Synced 1 of 3 campaigns; Dripify asked us to slow down. The rest keep their last numbers until the next sync.",
    });
  });
});
