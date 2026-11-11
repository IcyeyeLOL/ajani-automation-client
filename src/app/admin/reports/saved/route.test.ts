import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), sample: vi.fn(), catalog: vi.fn(), saved: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/session", () => ({ resolveAdminSession: mocks.session }));
vi.mock("@/lib/admin/sample-mode", () => ({ isSampleMode: mocks.sample }));
vi.mock("@/lib/admin/metrics", () => ({ loadMetricCatalog: mocks.catalog }));
vi.mock("@/lib/admin/report-saved", () => ({ loadSavedValues: mocks.saved }));

import { POST } from "@/app/admin/reports/saved/route";

const definition = (key: string, label: string, aggregation = "sum", entryMode = "manual") => ({
  key, source: key.split(".")[0], category: "content", label, description: "", unit: "count", aggregation,
  numeratorKey: null, denominatorKey: null, entryMode, higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions: [],
});
const request = (body: unknown) => new Request("https://ajani.test/admin/reports/saved", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("saved numbers for an import's review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.sample.mockResolvedValue(false);
    mocks.catalog.mockResolvedValue({
      status: "available", today: "2026-10-17", recentEntries: [], dimensionLabels: {}, connectors: { dripify: false },
      metrics: [
        definition("instagram.followers", "Instagram followers", "last"), definition("linkedin.followers", "LinkedIn followers", "last"),
        definition("instagram.views", "Instagram views"), definition("youtube.total_views", "YouTube views, all time", "last", "connector"),
      ],
    });
    mocks.saved.mockResolvedValue([{ metricKey: "instagram.followers", date: "2026-09-18", value: 2362, synced: false }]);
  });

  it("needs an admin session and real data", async () => {
    mocks.session.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await POST(request({ keys: ["linkedin.followers"], from: "2026-09-18", to: "2026-10-17" }))).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ status: "forbidden" });
    expect((await POST(request({ keys: ["linkedin.followers"], from: "2026-09-18", to: "2026-10-17" }))).status).toBe(404);
    mocks.sample.mockResolvedValueOnce(true);
    expect((await POST(request({ keys: ["linkedin.followers"], from: "2026-09-18", to: "2026-10-17" }))).status).toBe(409);
    expect(mocks.saved).not.toHaveBeenCalled();
  });

  it("refuses requests it can't read", async () => {
    for (const body of ["not json", { keys: [], from: "2026-09-18", to: "2026-10-17" }, { keys: ["Bad Key"], from: "2026-09-18", to: "2026-10-17" }, { keys: ["linkedin.followers"], from: "2026-10-17", to: "2026-09-18" }]) {
      expect((await POST(request(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.saved).not.toHaveBeenCalled();
  });

  it("returns the import's saved numbers and the other platforms' same-named ones, five weeks either side", async () => {
    const response = await POST(request({ keys: ["linkedin.followers", "youtube.total_views"], from: "2026-09-18", to: "2026-10-17" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.saved).toHaveBeenCalledWith(["instagram.followers", "linkedin.followers"], "2026-08-14", "2026-11-21");
    expect(await response.json()).toEqual({
      saved: [{ metricKey: "instagram.followers", date: "2026-09-18", value: 2362, synced: false }],
      metrics: {
        "instagram.followers": { label: "Instagram followers", unit: "count", aggregation: "last" },
        "linkedin.followers": { label: "LinkedIn followers", unit: "count", aggregation: "last" },
      },
    });
  });

  it("says when the saved numbers can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.saved.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "57014" }));
    const response = await POST(request({ keys: ["linkedin.followers"], from: "2026-09-18", to: "2026-10-17" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/can't be compared/);
  });
});
