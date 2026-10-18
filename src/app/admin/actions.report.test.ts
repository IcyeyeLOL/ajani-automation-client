import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), requireAdminSession: vi.fn(), revalidatePath: vi.fn(), cookieGet: vi.fn(), loadMetricCatalog: vi.fn(), loadSavedValues: vi.fn(),
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
vi.mock("@/lib/admin/report-saved", () => ({ loadSavedValues: mocks.loadSavedValues }));

import { saveReportValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";

const definition = (key: string, entryMode = "manual") => ({
  key, source: key.split(".")[0], category: "content", label: key, description: "", unit: "count", aggregation: key.endsWith(".followers") ? "last" : "sum",
  numeratorKey: null, denominatorKey: null, entryMode, higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions: [],
});

function save(rows: unknown, extra: { removals?: unknown; confirmed?: unknown } = {}) {
  const form = new FormData();
  form.set("rows", typeof rows === "string" ? rows : JSON.stringify(rows));
  if (extra.removals !== undefined) form.set("removals", JSON.stringify(extra.removals));
  if (extra.confirmed !== undefined) form.set("confirmed", JSON.stringify(extra.confirmed));
  return saveReportValuesAction(initialAdminActionState, form);
}

describe("saving reviewed report rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue("user_admin");
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    mocks.loadSavedValues.mockResolvedValue([]);
    mocks.loadMetricCatalog.mockResolvedValue({
      status: "available", today: "2026-10-17", recentEntries: [], dimensionLabels: {}, connectors: { dripify: false },
      metrics: [definition("instagram.reach"), definition("instagram.followers"), definition("instagram.synced", "connector"), definition("youtube.views"), { ...definition("revenue.cash_collected"), unit: "currency_cents" }, { ...definition("instagram.rate", "derived"), unit: "ratio" }],
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

  it("saves any platform's hand-logged numbers, money in cents", async () => {
    await save([{ metricKey: "youtube.views", date: "2026-10-08", value: 320 }, { metricKey: "revenue.cash_collected", date: "2026-10-14", value: 125050 }]);
    expect(mocks.rpc.mock.calls[0][1].p_values).toEqual([
      { metricKey: "youtube.views", date: "2026-10-08", value: 320, dimension: "" },
      { metricKey: "revenue.cash_collected", date: "2026-10-14", value: 125050, dimension: "" },
    ]);
  });

  it("checks the rows again instead of trusting the browser", async () => {
    for (const rows of [
      [{ metricKey: "tiktok.views", date: "2026-10-08", value: 1 }],
      [{ metricKey: "instagram.rate", date: "2026-10-08", value: 1 }],
      [{ metricKey: "revenue.cash_collected", date: "2026-10-08", value: 1250.5 }],
      [{ metricKey: "instagram.synced", date: "2026-10-08", value: 1 }],
      [{ metricKey: "instagram.reach", date: "2026-10-18", value: 1 }],
      [{ metricKey: "instagram.reach", date: "2026-10-08", value: 1, dimension: "@prospect" }],
      [],
      "not json",
    ]) expect((await save(rows)).status, JSON.stringify(rows)).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the store's own refusal through and hides other database errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Metric instagram.reach must be a whole number" } });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toEqual({ status: "error", message: "Metric instagram.reach must be a whole number" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal detail" } });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toEqual({ status: "error", message: "These numbers could not be saved. Retry in a moment." });
  });

  /** 600 rows: six metrics over the 100 days before today, more than one store call takes. */
  function sixHundredRows() {
    const keys = ["instagram.reach", "instagram.followers", "instagram.views", "instagram.likes", "instagram.saves", "instagram.shares"];
    mocks.loadMetricCatalog.mockResolvedValue({
      status: "available", today: "2026-10-17", recentEntries: [], dimensionLabels: {}, connectors: { dripify: false },
      metrics: keys.map((key) => definition(key)),
    });
    return keys.flatMap((metricKey) => Array.from({ length: 100 }, (_, back) => ({
      metricKey, date: new Date(Date.UTC(2026, 9, 17 - back)).toISOString().slice(0, 10), value: back,
    })));
  }

  it("saves several files' numbers in batches of 500, the store's limit", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 500, error: null }).mockResolvedValueOnce({ data: 90, error: null });
    const result = await save(sixHundredRows());
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_values.length)).toEqual([500, 100]);
    expect(result).toMatchObject({ status: "success", message: "Saved 590 numbers across 100 days. Trends are updated." });
  });

  it("says how far a batched save got when a later batch fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 500, error: null }).mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal detail" } });
    expect(await save(sixHundredRows())).toEqual({
      status: "error",
      message: "Saved 500 of 600 numbers, then the rest failed. Save again to finish; numbers already saved are simply replaced.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("says nothing changed when every number was already recorded", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 0, error: null });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toMatchObject({ status: "success", message: "Those numbers were already recorded. Nothing changed." });
  });
});

describe("removing saved numbers an import shows are wrong", () => {
  const wrong = [
    { metricKey: "instagram.followers", date: "2026-09-18", value: 2362 },
    { metricKey: "instagram.followers", date: "2026-09-19", value: 2364 },
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue("user_admin");
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "delete_analytics_metric_value" ? true : 1, error: null }));
    mocks.loadSavedValues.mockResolvedValue(wrong.map((item) => ({ ...item, synced: false })));
    mocks.loadMetricCatalog.mockResolvedValue({
      status: "available", today: "2026-10-17", recentEntries: [], dimensionLabels: {}, connectors: { dripify: false },
      metrics: [definition("instagram.reach"), definition("instagram.followers"), definition("linkedin.followers")],
    });
  });

  it("saves the new rows, then removes each wrong number through the store, which records it", async () => {
    const result = await save([{ metricKey: "linkedin.followers", date: "2026-09-18", value: 2362 }], { removals: wrong });
    expect(mocks.loadSavedValues).toHaveBeenCalledWith(["linkedin.followers", "instagram.followers"], "2026-08-14", "2026-10-24");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["upsert_analytics_metric_values", "delete_analytics_metric_value", "delete_analytics_metric_value"]);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_analytics_metric_value", { p_metric_key: "instagram.followers", p_metric_date: "2026-09-18", p_dimension_key: "", p_actor: "user_admin" });
    expect(result).toMatchObject({ status: "success", message: "Saved 1 number across 1 day and removed 2 wrong numbers. Trends are updated." });
  });

  it("can only remove, when the file has nothing new to save", async () => {
    expect(await save([], { removals: wrong })).toMatchObject({ status: "success", message: "Removed 2 wrong numbers. Trends are updated." });
    expect(await save([], { removals: [] })).toEqual({ status: "error", message: "Pick at least one number to save" });
  });

  it("removes nothing that changed since the review, was synced, or is also being saved", async () => {
    mocks.loadSavedValues.mockResolvedValueOnce([{ ...wrong[0], value: 73, synced: false }, { ...wrong[1], synced: false }]);
    expect(await save([], { removals: wrong })).toEqual({ status: "error", message: "A saved number changed after you reviewed it, so nothing was saved. Read the file again." });
    mocks.loadSavedValues.mockResolvedValueOnce(wrong.map((item) => ({ ...item, synced: true })));
    expect((await save([], { removals: wrong })).status).toBe("error");
    expect((await save([{ metricKey: "instagram.followers", date: "2026-09-18", value: 70 }], { removals: wrong })).status).toBe("error");
    expect((await save([], { removals: [{ metricKey: "instagram.followers", date: "2026-10-18", value: 1 }] })).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a number that looks wrong next to the saved ones unless it was ticked on purpose", async () => {
    mocks.loadSavedValues.mockResolvedValue([{ metricKey: "instagram.followers", date: "2026-10-16", value: 73, synced: false }]);
    const row = { metricKey: "instagram.followers", date: "2026-10-17", value: 2533 };
    expect(await save([row])).toEqual({
      status: "error",
      message: "Nothing was saved: instagram.followers on 2026-10-17 needs a second look. 35 times the 73 saved for Oct 16. Read the file again and tick it if it's right.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await save([row], { confirmed: ["instagram.followers|2026-10-17"] })).toMatchObject({ status: "success" });
  });

  it("checks against the numbers left after the removals, and saves nothing when the store can't be read", async () => {
    mocks.loadSavedValues.mockResolvedValue([{ metricKey: "instagram.followers", date: "2026-10-16", value: 2531, synced: false }]);
    // Instagram's real count next to LinkedIn's wrongly saved one is fine once that one is removed.
    expect(await save([{ metricKey: "instagram.followers", date: "2026-10-17", value: 73 }], { removals: [{ metricKey: "instagram.followers", date: "2026-10-16", value: 2531 }] })).toMatchObject({ status: "success" });
    mocks.loadSavedValues.mockRejectedValueOnce(new Error("timeout"));
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }])).toEqual({ status: "error", message: "The saved numbers couldn't be checked, so nothing was saved. Retry in a moment." });
  });

  it("says how far the removals got when one fails", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { p_metric_date?: string }) => name === "delete_analytics_metric_value" && args.p_metric_date === "2026-09-19"
      ? { data: null, error: { code: "XX000", message: "internal" } }
      : { data: name === "delete_analytics_metric_value" ? true : 1, error: null });
    expect(await save([{ metricKey: "instagram.reach", date: "2026-10-08", value: 1 }], { removals: wrong })).toEqual({
      status: "error", message: "Saved 1 number, but removing the wrong numbers stopped after 1 of 2. Read the file again to finish.",
    });
  });
});
