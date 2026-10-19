import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  authorizeAdminAction: vi.fn(),
  clearAdminSessionCookie: vi.fn(),
  setAdminSessionCookie: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  headers: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  syncDripifyMetrics: vi.fn(),
  syncConnector: vi.fn(),
  requireAdminClerkUser: vi.fn(),
  consumeAdminLoginAllowance: vi.fn(),
  loadMetricCatalog: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/session", () => ({
  clearAdminSessionCookie: mocks.clearAdminSessionCookie,
  fingerprintRequest: vi.fn(() => "fingerprint"),
  getAdminConfiguration: vi.fn(() => ({ accessKey: "team-access-key", sessionSecret: "s".repeat(32) })),
  keysMatch: vi.fn(() => true),
  authorizeAdminAction: mocks.authorizeAdminAction,
  setAdminSessionCookie: mocks.setAdminSessionCookie,
}));
vi.mock("@/lib/admin/clerk", () => ({ requireAdminClerkUser: mocks.requireAdminClerkUser }));
vi.mock("@/lib/admin/login-throttle", () => ({ consumeAdminLoginAllowance: mocks.consumeAdminLoginAllowance }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createClient }));
vi.mock("@/lib/admin/metrics", () => ({ loadMetricCatalog: mocks.loadMetricCatalog }));
vi.mock("@/lib/admin/report-saved", () => ({ loadSavedValues: vi.fn(async () => []) }));
vi.mock("@/lib/connectors/dripify", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/connectors/dripify")>(),
  syncDripifyMetrics: mocks.syncDripifyMetrics,
}));
vi.mock("@/lib/connectors/registry", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/connectors/registry")>(),
  syncConnector: mocks.syncConnector,
}));

import * as actions from "@/app/admin/actions";
import { initialAdminActionState, type AdminActionState } from "@/app/admin/action-state";

const REFUSAL = { status: "error", message: "Sample data was switched on in another tab, so nothing was saved. Refresh the page." };
const STALE_REFUSAL = { status: "error", message: "This page is showing sample data, so nothing was saved. Refresh the page to work with real numbers." };

/** Fields every form adds, such as sample=1 from a page rendered with sample data. */
let extraFields: Record<string, string> = {};

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries({ ...values, ...extraFields }).forEach(([key, value]) => data.set(key, value));
  return data;
}

/** Valid input for every action that writes: without the guard, each one would reach the database or a sync. */
const writes: Record<string, () => Promise<AdminActionState>> = {
  createExperimentAction: () => actions.createExperimentAction(initialAdminActionState, form({
    title: "Outcome hook comparison", audience: "Insurance owners", campaign: "August outreach", channel: "linkedin",
    method: "manual", messageStep: "initial_dm", primaryMetric: "reply_rate", variants: "Outcome hook, Compliance hook",
  })),
  createOutreachBatchAction: () => actions.createOutreachBatchAction(initialAdminActionState, form({
    activityDate: "2026-10-15", teamMember: "Owner", channel: "linkedin", method: "manual", audience: "Insurance owners",
    campaign: "", experimentId: "", notes: "",
    metrics: JSON.stringify([{ variantId: null, variantLabel: "No variant", connectionRequests: 10, connectionsAccepted: 4, initialDms: 8, f1Sent: 3, f2Sent: 0, customSent: 0, replies: 2, attributedReplies: 2, positiveReplies: 1, callsBooked: 1 }]),
  })),
  logExperimentMetricsAction: () => actions.logExperimentMetricsAction(initialAdminActionState, form({
    experimentId: "5210b79a-90eb-4218-82c2-32d7eea6f429", messageStep: "initial_dm", activityDate: "2026-10-15", teamMember: "Owner", notes: "",
    metrics: JSON.stringify([{ variantId: "b7053867-3ad5-483f-90ba-d542abbd6ebd", variantLabel: "A", sent: 40, replies: 6, positiveReplies: 2, callsBooked: 1, connectionRequests: 0, connectionsAccepted: 0 }]),
  })),
  voidOutreachBatchAction: () => actions.voidOutreachBatchAction(initialAdminActionState, form({ batchId: "5210b79a-90eb-4218-82c2-32d7eea6f429", reason: "Logged twice" })),
  recordMetricValuesAction: () => actions.recordMetricValuesAction(initialAdminActionState, form({
    date: "2026-10-15", dimension: "@ajani", values: JSON.stringify([{ metricKey: "linkedin.followers", value: 3_400 }]),
  })),
  deleteMetricValueAction: () => actions.deleteMetricValueAction(initialAdminActionState, form({ metricKey: "linkedin.followers", date: "2026-10-15", dimension: "@ajani" })),
  saveReportValuesAction: () => actions.saveReportValuesAction(initialAdminActionState, form({
    platform: "instagram", rows: JSON.stringify([{ metricKey: "instagram.followers", date: "2026-10-17", value: 73 }]),
  })),
  syncDripifyAction: () => actions.syncDripifyAction(initialAdminActionState, form({})),
  syncConnectorAction: () => actions.syncConnectorAction(initialAdminActionState, form({ connector: "youtube" })),
};

/** Actions that never write business numbers: signing in and out, and the switch itself. */
const notWrites = ["unlockAdminAction", "logoutAdminAction", "setSampleModeAction"];

function sampleCookie(on: boolean) {
  mocks.cookieGet.mockImplementation((name: string) => on && name === "ajani_admin_sample" ? { name, value: "1" } : undefined);
}

describe("admin actions while sample data is on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extraFields = {};
    mocks.authorizeAdminAction.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f429", error: null });
    mocks.syncDripifyMetrics.mockResolvedValue({ status: "synced", reason: null, date: "2026-10-16", campaigns: 1, synced: 1, deferred: 0, failed: 0, valuesWritten: 4, labelsWritten: 1 });
    mocks.syncConnector.mockResolvedValue({ connector: "youtube", status: "synced", reason: null, date: "2026-10-16", valuesWritten: 3, details: {} });
    mocks.loadMetricCatalog.mockResolvedValue({
      status: "available", today: "2026-10-17", recentEntries: [], dimensionLabels: {}, connectors: { dripify: false },
      metrics: [{ key: "instagram.followers", source: "instagram", category: "content", label: "Instagram followers", description: "", unit: "count", aggregation: "last", numeratorKey: null, denominatorKey: null, entryMode: "manual", higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions: [] }],
    });
  });

  it("guards every exported action that writes", () => {
    const exported = Object.entries(actions).filter(([, value]) => typeof value === "function").map(([name]) => name).sort();
    expect(exported).toEqual([...Object.keys(writes), ...notWrites].sort());
  });

  it.each(Object.keys(writes))("%s refuses before touching the database", async (name) => {
    sampleCookie(true);
    const result = await writes[name]();
    expect(result).toEqual(REFUSAL);
    // Still authorized first, then refused: no database client, RPC, sync or revalidation.
    expect(mocks.authorizeAdminAction).toHaveBeenCalledOnce();
    expect(mocks.loadMetricCatalog).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.syncDripifyMetrics).not.toHaveBeenCalled();
    expect(mocks.syncConnector).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(Object.keys(writes))("%s still writes real numbers when sample data is off", async (name) => {
    sampleCookie(false);
    const result = await writes[name]();
    expect(result).not.toEqual(REFUSAL);
    expect(mocks.rpc.mock.calls.length + mocks.syncDripifyMetrics.mock.calls.length + mocks.syncConnector.mock.calls.length).toBeGreaterThan(0);
  });

  // Sample data switched off in another tab: this tab still shows made-up rows.
  it.each(Object.keys(writes))("%s refuses a page rendered with sample data after the switch is turned off", async (name) => {
    sampleCookie(false);
    extraFields = { sample: "1" };
    expect(await writes[name]()).toEqual(STALE_REFUSAL);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.syncDripifyMetrics).not.toHaveBeenCalled();
    expect(mocks.syncConnector).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the sign-in check ahead of the sample-data check", async () => {
    sampleCookie(true);
    mocks.authorizeAdminAction.mockRejectedValue(new Error("NEXT_REDIRECT"));
    for (const name of Object.keys(writes)) await expect(writes[name](), name).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.cookieGet).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("still lets the team unlock and lock the desk", async () => {
    sampleCookie(true);
    mocks.requireAdminClerkUser.mockResolvedValue("user_admin");
    mocks.consumeAdminLoginAllowance.mockResolvedValue(true);
    mocks.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.9" }));
    await actions.unlockAdminAction(initialAdminActionState, form({ accessKey: "team-access-key" }));
    expect(mocks.setAdminSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
    // Every session starts on real numbers.
    expect(mocks.cookieSet).toHaveBeenCalledWith("ajani_admin_sample", "", expect.objectContaining({ maxAge: 0, path: "/admin" }));

    await actions.logoutAdminAction();
    expect(mocks.clearAdminSessionCookie).toHaveBeenCalledOnce();
    // Locking the desk also turns sample data off for the next session.
    expect(mocks.cookieSet).toHaveBeenCalledWith("ajani_admin_sample", "", expect.objectContaining({ maxAge: 0, path: "/admin" }));
    expect(mocks.redirect).toHaveBeenLastCalledWith("/admin/login");
  });
});

describe("sample data switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extraFields = {};
    mocks.authorizeAdminAction.mockResolvedValue({ status: "allowed", userId: "user_admin" });
  });

  it("turns sample data on and off with a cookie, without the database", async () => {
    const on = await actions.setSampleModeAction(initialAdminActionState, form({ enabled: "1" }));
    expect(on).toMatchObject({ status: "success", entityId: expect.stringMatching(/^sample:1:/) });
    expect(mocks.cookieSet).toHaveBeenCalledWith("ajani_admin_sample", "1", expect.objectContaining({
      httpOnly: true, sameSite: "strict", path: "/admin", maxAge: 8 * 60 * 60,
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");

    sampleCookie(true);
    const off = await actions.setSampleModeAction(initialAdminActionState, form({ enabled: "0" }));
    expect(off).toMatchObject({ status: "success", entityId: expect.stringMatching(/^sample:0:/) });
    expect(mocks.cookieSet).toHaveBeenLastCalledWith("ajani_admin_sample", "", expect.objectContaining({ maxAge: 0, path: "/admin" }));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects anything but on or off", async () => {
    for (const enabled of ["", "yes", "true"]) {
      expect((await actions.setSampleModeAction(initialAdminActionState, form({ enabled }))).status).toBe("error");
    }
    expect((await actions.setSampleModeAction(initialAdminActionState, new FormData())).status).toBe("error");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("is only for a signed-in admin", async () => {
    mocks.authorizeAdminAction.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(actions.setSampleModeAction(initialAdminActionState, form({ enabled: "1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
