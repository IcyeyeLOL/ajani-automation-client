import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), requireAdminSession: vi.fn(), revalidatePath: vi.fn(), cookieGet: vi.fn(), loadMetricCatalog: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: async () => ({ get: mocks.cookieGet, set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/session", () => ({
  clearAdminSessionCookie: vi.fn(), fingerprintRequest: vi.fn(), getAdminConfiguration: vi.fn(), keysMatch: vi.fn(),
  requireAdminSession: mocks.requireAdminSession, setAdminSessionCookie: vi.fn(),
}));
vi.mock("@/lib/admin/clerk", () => ({ requireAdminClerkUser: vi.fn() }));
vi.mock("@/lib/admin/login-throttle", () => ({ consumeAdminLoginAllowance: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/admin/metrics", () => ({ loadMetricCatalog: mocks.loadMetricCatalog }));

import { saveReportValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";

const definition = (key: string, entryMode = "manual") => ({
  key, source: key.split(".")[0], category: "content", label: key, description: "", unit: "count", aggregation: "sum",
  numeratorKey: null, denominatorKey: null, entryMode, higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions: [],
});

function save(rows: unknown, platform = "instagram") {
  const form = new FormData();
  form.set("platform", platform);
  form.set("rows", typeof rows === "string" ? rows : JSON.stringify(rows));
  return saveReportValuesAction(initialAdminActionState, form);
}

describe("saving reviewed report rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue("user_admin");
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    mocks.loadMetricCatalog.mockResolvedValue({
      status: "available", today: "2026-10-17", recentEntries: [], dimensionLabels: {}, connectors: { dripify: false },
      metrics: [definition("instagram.reach"), definition("instagram.followers"), definition("instagram.synced", "connector"), definition("youtube.views")],
    });
  });

  it("writes the rows as manual entries on the main account and refreshes the desk", async () => {
    const result = await save([
      { metricKey: "instagram.reach", date: "2026-10-08", value: 2219 },
      { metricKey: "instagram.reach", date: "2026-10-09", value: 1560 },
      { metricKey: "instagram.followers", date: "2026-10-17", value: 73 },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_analytics_metric_values", {
      p_values: [
        { metricKey: "instagram.reach", date: "2026-10-08", value: 2219, dimension: "" },
        { metricKey: "instagram.reach", date: "2026-10-09", value: 1560, dimension: "" },
        { metricKey: "instagram.followers", date: "2026-10-17", value: 73, dimension: "" },
      ],
      p_origin: "manual",
      p_actor: "user_admin",
    });
    expect(result).toMatchObject({ status: "success", message: "Saved 3 numbers across 3 days. Trends are updated." });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("checks the rows again instead of trusting the browser", async () => {
    for (const rows of [
      [{ metricKey: "youtube.views", date: "2026-10-08", value: 1 }],
      [{ metricKey: "instagram.synced", date: "2026-10-08", value: 1 }],
      [{ metricKey: "instagram.reach", date: "2026-10-18", value: 1 }],
      [{ metricKey: "instagram.reach", date: "2026-10-08", value: 1, dimension: "@prospect" }],
      [],
      "not json",
    ]) expect((await save(rows)).status, JSON.stringify(rows)).toBe("error");
    expect((await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }], "tiktok")).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the store's own refusal through and hides other database errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Metric instagram.reach must be a whole number" } });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toEqual({ status: "error", message: "Metric instagram.reach must be a whole number" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal detail" } });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toEqual({ status: "error", message: "These numbers could not be saved. Retry in a moment." });
  });

  it("says nothing changed when every number was already recorded", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 0, error: null });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toMatchObject({ status: "success", message: "Those numbers were already recorded. Nothing changed." });
  });
});
