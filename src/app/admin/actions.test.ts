import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  authorizeAdminAction: vi.fn(),
  revalidatePath: vi.fn(),
  syncDripifyMetrics: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// No sample-data cookie: these actions run against real numbers.
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: async () => ({ get: () => undefined, set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/session", () => ({
  clearAdminSessionCookie: vi.fn(),
  fingerprintRequest: vi.fn(),
  getAdminConfiguration: vi.fn(),
  keysMatch: vi.fn(),
  authorizeAdminAction: mocks.authorizeAdminAction,
  setAdminSessionCookie: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/connectors/dripify", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/connectors/dripify")>(),
  syncDripifyMetrics: mocks.syncDripifyMetrics,
}));

import {
  createExperimentAction,
  createOutreachBatchAction,
  deleteMetricValueAction,
  logExperimentMetricsAction,
  recordMetricValuesAction,
  syncDripifyAction,
  voidOutreachBatchAction,
} from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";

type Row = Record<string, unknown>;
/** The two tables a save reads: saved daily values and the definitions they belong to. */
let tables: Record<string, Row[]> = {};

/** Enough of Supabase's query builder for .from().select().eq().in(): each filter narrows the table's rows. */
function query(table: string) {
  let rows = tables[table] ?? [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return builder; },
    in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[column])); return builder; },
    then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return builder;
}

const definition = (key: string, label: string, aggregation: "sum" | "last", unit = "count") => ({ metric_key: key, label, unit, aggregation });
const definitions = [
  definition("cold_calls.dials", "Cold calls made", "sum"),
  definition("cold_calls.positive_replies", "Cold call positive replies", "sum"),
  definition("cold_calls.neutral_replies", "Cold call neutral replies", "sum"),
  definition("cold_calls.negative_replies", "Cold call negative replies", "sum"),
  definition("cold_calls.meetings_booked", "Cold call meetings booked", "sum"),
  definition("reddit.dms_sent", "Reddit DMs sent", "sum"),
  definition("revenue.cash_collected", "Cash collected", "sum", "currency_cents"),
  definition("youtube.subscribers", "YouTube subscribers", "last"),
  definition("youtube.views", "YouTube views", "sum"),
];

describe("admin server actions", () => {
  beforeEach(() => {
    tables = { analytics_metric_daily: [], analytics_metric_definitions: definitions };
    mocks.from.mockReset();
    mocks.from.mockImplementation(query);
    mocks.rpc.mockReset();
    mocks.authorizeAdminAction.mockReset();
    mocks.authorizeAdminAction.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.revalidatePath.mockReset();
  });

  it("authorizes and persists a flexible experiment", async () => {
    mocks.rpc.mockResolvedValue({ data: "b7053867-3ad5-483f-90ba-d542abbd6ebd", error: null });
    const form = new FormData();
    Object.entries({
      title: "Outcome hook comparison",
      audience: "Insurance owners",
      campaign: "August outreach",
      channel: "linkedin",
      method: "manual",
      messageStep: "initial_dm",
      primaryMetric: "reply_rate",
      variants: "Outcome hook, Compliance hook",
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createExperimentAction(initialAdminActionState, form);

    expect(mocks.authorizeAdminAction).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_experiment", expect.objectContaining({
      p_title: "Outcome hook comparison",
      p_created_by: "user_admin",
      p_message_step: "initial_dm",
      p_variants: [{ label: "A", title: "Outcome hook" }, { label: "B", title: "Compliance hook" }],
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "b7053867-3ad5-483f-90ba-d542abbd6ebd" });
  });

  it("authorizes and persists an aggregate outreach batch", async () => {
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f429", error: null });
    const metrics = [{
      variantId: null,
      variantLabel: "No variant",
      connectionRequests: 100,
      connectionsAccepted: 40,
      initialDms: 80,
      f1Sent: 50,
      f2Sent: 20,
      customSent: 0,
      replies: 12,
      attributedReplies: 12,
      positiveReplies: 6,
      callsBooked: 3,
    }];
    const form = new FormData();
    Object.entries({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "August outreach",
      experimentId: "",
      notes: "",
      metrics: JSON.stringify(metrics),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(mocks.authorizeAdminAction).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_batch", expect.objectContaining({ p_actor: "user_admin", p_metrics: metrics }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "5210b79a-90eb-4218-82c2-32d7eea6f429" });
  });

  it("accepts a batch whose only activity is a custom message step", async () => {
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f430", error: null });
    const form = new FormData();
    Object.entries({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "Custom follow-up",
      experimentId: "",
      notes: "",
      metrics: JSON.stringify([{
        variantId: null,
        variantLabel: "No variant",
        connectionRequests: 0,
        connectionsAccepted: 0,
        initialDms: 0,
        f1Sent: 0,
        f2Sent: 0,
        customSent: 7,
        replies: 0,
        attributedReplies: 0,
        positiveReplies: 0,
        callsBooked: 0,
      }]),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(result.status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_batch", expect.objectContaining({
      p_metrics: [expect.objectContaining({ customSent: 7 })],
    }));
  });

  it("rejects impossible counts before contacting the database", async () => {
    const form = new FormData();
    Object.entries({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "",
      experimentId: "",
      notes: "",
      metrics: JSON.stringify([{
        variantId: null,
        variantLabel: "No variant",
        connectionRequests: 10,
        connectionsAccepted: 11,
        initialDms: 10,
        f1Sent: 0,
        f2Sent: 0,
        customSent: 0,
        replies: 0,
        attributedReplies: 0,
        positiveReplies: 0,
        callsBooked: 0,
      }]),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(result).toEqual({ status: "error", message: "Accepted connections cannot exceed connection requests" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("persists the focused counts for every experiment variant", async () => {
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f431", error: null });
    const metrics = [{
      variantId: "b7053867-3ad5-483f-90ba-d542abbd6ebd",
      variantLabel: "A",
      sent: 125,
      replies: 19,
      positiveReplies: 8,
      callsBooked: 4,
      connectionRequests: 150,
      connectionsAccepted: 63,
    }];
    const form = new FormData();
    Object.entries({
      experimentId: "5210b79a-90eb-4218-82c2-32d7eea6f429",
      messageStep: "initial_dm",
      activityDate: "2026-08-26",
      teamMember: "Ajani team",
      notes: "August cohort",
      metrics: JSON.stringify(metrics),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await logExperimentMetricsAction(initialAdminActionState, form);

    expect(mocks.authorizeAdminAction).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_experiment_metric_snapshot", {
      p_experiment_id: "5210b79a-90eb-4218-82c2-32d7eea6f429",
      p_activity_date: "2026-08-26",
      p_team_member: "Ajani team",
      p_notes: "August cohort",
      p_metrics: metrics,
      p_actor: "user_admin",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "5210b79a-90eb-4218-82c2-32d7eea6f431" });
  });

  it("records platform numbers as idempotent upserts for one day and account", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const form = new FormData();
    form.set("date", "2026-10-15");
    form.set("dimension", " @AjaniFlow ");
    form.set("values", JSON.stringify([
      { metricKey: "youtube.subscribers", value: 1250 },
      { metricKey: "youtube.views", value: 8400 },
    ]));

    const result = await recordMetricValuesAction(initialAdminActionState, form);

    expect(mocks.authorizeAdminAction).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_analytics_metric_values", {
      p_values: [
        { metricKey: "youtube.subscribers", value: 1250, date: "2026-10-15", dimension: "@ajaniflow" },
        { metricKey: "youtube.views", value: 8400, date: "2026-10-15", dimension: "@ajaniflow" },
      ],
      p_origin: "manual",
      p_actor: "user_admin",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", message: expect.stringContaining("Saved 2 numbers") });
  });

  it("asks to save again, without redirecting or writing, while the sign-in renews", async () => {
    const renewing = { status: "error", message: "Your sign-in was renewing, so nothing was saved. Press save again." } as const;
    mocks.authorizeAdminAction.mockResolvedValue({ status: "refused", state: renewing });
    const form = new FormData();
    form.set("date", "2026-10-15");
    form.set("values", JSON.stringify([{ metricKey: "cold_calls.dials", value: 30 }]));

    expect(await recordMetricValuesAction(initialAdminActionState, form)).toBe(renewing);
    expect(await deleteMetricValueAction(initialAdminActionState, form)).toBe(renewing);
    expect(await syncDripifyAction()).toBe(renewing);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.syncDripifyMetrics).not.toHaveBeenCalled();
  });

  it("rejects negative or malformed platform numbers before the database", async () => {
    const form = new FormData();
    form.set("date", "2026-10-15");
    form.set("values", JSON.stringify([{ metricKey: "youtube.views", value: -4 }]));
    const result = await recordMetricValuesAction(initialAdminActionState, form);
    expect(result.status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();

    form.set("values", "not json");
    expect((await recordMetricValuesAction(initialAdminActionState, form)).status).toBe("error");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces database validation messages for platform numbers", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Metric youtube.views must be a whole number" } });
    const form = new FormData();
    form.set("date", "2026-10-15");
    form.set("values", JSON.stringify([{ metricKey: "youtube.views", value: 1.5 }]));
    const result = await recordMetricValuesAction(initialAdminActionState, form);
    expect(result).toEqual({ status: "error", message: "Metric youtube.views must be a whole number" });
  });

  it("removes one manual metric entry", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const form = new FormData();
    form.set("metricKey", "tiktok.followers");
    form.set("date", "2026-10-14");
    form.set("dimension", "");
    const result = await deleteMetricValueAction(initialAdminActionState, form);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_analytics_metric_value", {
      p_metric_key: "tiktok.followers",
      p_metric_date: "2026-10-14",
      p_dimension_key: "",
      p_actor: "user_admin",
    });
    expect(result.status).toBe("success");
  });

  it("voids an outreach entry with an audited reason", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const form = new FormData();
    form.set("batchId", "5210b79a-90eb-4218-82c2-32d7eea6f429");
    form.set("reason", "Logged twice");
    const result = await voidOutreachBatchAction(initialAdminActionState, form);
    expect(mocks.rpc).toHaveBeenCalledWith("void_outreach_batch", {
      p_batch_id: "5210b79a-90eb-4218-82c2-32d7eea6f429",
      p_reason: "Logged twice",
      p_actor: "user_admin",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result.status).toBe("success");

    form.set("reason", "x");
    mocks.rpc.mockClear();
    expect((await voidOutreachBatchAction(initialAdminActionState, form)).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("syncs Dripify on demand only for an admin and reports the outcome plainly", async () => {
    mocks.syncDripifyMetrics.mockResolvedValue({
      status: "synced", reason: null, date: "2026-10-16", campaigns: 2, synced: 2, deferred: 0, failed: 0, valuesWritten: 8, labelsWritten: 2,
    });
    const result = await syncDripifyAction();
    expect(mocks.authorizeAdminAction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "success", message: "Synced 2 of 2 campaigns for 2026-10-16 (UTC).", entityId: expect.stringMatching(/^dripify:/) });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");

    mocks.syncDripifyMetrics.mockResolvedValue({
      status: "rejected", reason: "plan_without_api", date: "2026-10-16", campaigns: 0, synced: 0, deferred: 0, failed: 0, valuesWritten: 0, labelsWritten: null,
    });
    expect(await syncDripifyAction()).toMatchObject({ status: "error", message: expect.stringMatching(/plan does not include API access/) });

    mocks.authorizeAdminAction.mockRejectedValue(new Error("NEXT_REDIRECT"));
    mocks.syncDripifyMetrics.mockClear();
    await expect(syncDripifyAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.syncDripifyMetrics).not.toHaveBeenCalled();
  });

  it("never shows provider or database errors from a failed Dripify sync", async () => {
    mocks.syncDripifyMetrics.mockRejectedValue(new Error("relation analytics_dimension_labels does not exist"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await syncDripifyAction();
    expect(result.status).toBe("error");
    expect(result.message).not.toMatch(/relation|analytics_/);
    log.mockRestore();
  });
});

describe("logging a day that already has numbers", () => {
  /** What the store does: a changed or new value is written and counted; the same value is skipped. */
  function upsert(_name: string, args: { p_values: Array<{ metricKey: string; value: number; date: string; dimension: string }> }) {
    let written = 0;
    for (const item of args.p_values) {
      const row = tables.analytics_metric_daily.find((saved) => saved.metric_key === item.metricKey && saved.metric_date === item.date && saved.dimension_key === item.dimension);
      if (row && Number(row.value) === item.value) continue;
      if (row) row.value = item.value;
      else tables.analytics_metric_daily.push({ metric_key: item.metricKey, metric_date: item.date, dimension_key: item.dimension, value: item.value });
      written += 1;
    }
    return { data: written, error: null };
  }

  function log(values: Record<string, number>, options: { date?: string; dimension?: string; onExisting?: string } = {}) {
    const form = new FormData();
    form.set("date", options.date ?? "2026-10-18");
    form.set("dimension", options.dimension ?? "");
    form.set("values", JSON.stringify(Object.entries(values).map(([metricKey, value]) => ({ metricKey, value }))));
    if (options.onExisting) form.set("onExisting", options.onExisting);
    return recordMetricValuesAction(initialAdminActionState, form);
  }

  /** Saved numbers, as the store returns them: Postgres numerics arrive as strings. */
  function saved(values: Record<string, number>, options: { date?: string; dimension?: string } = {}) {
    for (const [key, value] of Object.entries(values)) {
      tables.analytics_metric_daily.push({ metric_key: key, metric_date: options.date ?? "2026-10-18", dimension_key: options.dimension ?? "", value: String(value) });
    }
  }

  const day = (key: string, date = "2026-10-18", dimension = "") => Number(tables.analytics_metric_daily.find((row) => row.metric_key === key && row.metric_date === date && row.dimension_key === dimension)?.value);

  beforeEach(() => {
    // 10pm on Oct 18 in New York is already Oct 19 in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T02:00:00Z"));
    tables = { analytics_metric_daily: [], analytics_metric_definitions: definitions };
    mocks.from.mockReset();
    mocks.from.mockImplementation(query);
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name, args) => upsert(name, args));
    mocks.authorizeAdminAction.mockReset();
    mocks.authorizeAdminAction.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.revalidatePath.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("saves a first calling session, then asks before a second one would replace it", async () => {
    expect(await log({ "cold_calls.dials": 30, "cold_calls.positive_replies": 2 })).toMatchObject({ status: "success", message: "Saved 2 numbers for Oct 18. Trends are updated." });
    // The second session the same day: nothing is saved until the owner chooses.
    expect(await log({ "cold_calls.dials": 20, "cold_calls.positive_replies": 2 })).toEqual({
      status: "error",
      code: "existing",
      message: "Oct 18 already has 30 cold calls made and 2 positive replies. Add these to them, or replace them?",
      entityId: expect.stringMatching(/^existing:/),
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(day("cold_calls.dials")).toBe(30);
  });

  it("adds the second session to the first when asked to", async () => {
    saved({ "cold_calls.dials": 30, "cold_calls.positive_replies": 2 });
    const result = await log({ "cold_calls.dials": 20, "cold_calls.positive_replies": 2, "cold_calls.meetings_booked": 1 }, { onExisting: "add" });
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_analytics_metric_values", {
      p_values: [
        { metricKey: "cold_calls.dials", value: 50, date: "2026-10-18", dimension: "" },
        { metricKey: "cold_calls.positive_replies", value: 4, date: "2026-10-18", dimension: "" },
        { metricKey: "cold_calls.meetings_booked", value: 1, date: "2026-10-18", dimension: "" },
      ],
      p_origin: "manual",
      p_actor: "user_admin",
    });
    expect(result).toMatchObject({ status: "success", message: "Added to Oct 18: now 50 cold calls made and 4 positive replies. Also saved 1 meetings booked. Trends are updated." });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("replaces the saved numbers when asked to", async () => {
    saved({ "cold_calls.dials": 30, "cold_calls.positive_replies": 2 });
    const result = await log({ "cold_calls.dials": 20, "cold_calls.positive_replies": 2 }, { onExisting: "replace" });
    expect(mocks.rpc.mock.calls[0][1].p_values.map((item: { value: number }) => item.value)).toEqual([20, 2]);
    expect(day("cold_calls.dials")).toBe(20);
    expect(result).toMatchObject({ status: "success", message: "Saved 1 number for Oct 18, replacing what was there. Trends are updated." });
  });

  it("never asks about a total shown today, like subscribers, and replaces it even when adding", async () => {
    saved({ "youtube.subscribers": 1200 }, { dimension: "@ajaniflow" });
    expect(await log({ "youtube.subscribers": 1250 }, { dimension: "@ajaniflow" })).toMatchObject({ status: "success", message: "Saved 1 number for Oct 18 on @ajaniflow. Trends are updated." });
    expect(day("youtube.subscribers", "2026-10-18", "@ajaniflow")).toBe(1250);

    saved({ "youtube.views": 300 }, { dimension: "@ajaniflow" });
    expect(await log({ "youtube.subscribers": 1260, "youtube.views": 100 }, { dimension: "@ajaniflow" })).toMatchObject({
      code: "existing", message: "Oct 18 on @ajaniflow already has 300 views. Add these to them, or replace them?",
    });
    expect(await log({ "youtube.subscribers": 1260, "youtube.views": 100 }, { dimension: "@ajaniflow", onExisting: "add" })).toMatchObject({
      status: "success", message: "Added to Oct 18 on @ajaniflow: now 400 views. Also saved 1,260 subscribers. Trends are updated.",
    });
    expect(day("youtube.subscribers", "2026-10-18", "@ajaniflow")).toBe(1260);
  });

  it("asks only about this day and account, keeps capitals and money, and skips a saved zero", async () => {
    saved({ "reddit.dms_sent": 12, "revenue.cash_collected": 395000, "cold_calls.dials": 0 }, { date: "2025-10-18" });
    expect((await log({ "reddit.dms_sent": 3, "revenue.cash_collected": 5000 }, { date: "2025-10-18" })).message)
      .toBe("Oct 18, 2025 already has 12 DMs sent and $3,950 cash collected. Add these to them, or replace them?");
    // Calls made was saved as 0: adding to it and replacing it are the same.
    expect(await log({ "cold_calls.dials": 9 }, { date: "2025-10-18" })).toMatchObject({ status: "success" });
    // Another day, or another account, is not this one.
    expect(await log({ "reddit.dms_sent": 3 }, { date: "2025-10-17" })).toMatchObject({ status: "success" });
    expect(await log({ "reddit.dms_sent": 3 }, { date: "2025-10-18", dimension: "@second" })).toMatchObject({ status: "success" });
  });

  it("refuses more answers than calls made", async () => {
    expect(await log({ "cold_calls.dials": 5, "cold_calls.positive_replies": 8, "cold_calls.negative_replies": 9 })).toEqual({
      status: "error", message: "Answers (17) can't be more than calls made (5) for Oct 18.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    // Calls made unknown: nothing to check against.
    expect(await log({ "cold_calls.positive_replies": 3 })).toMatchObject({ status: "success" });
  });

  it("checks answers against the day's totals: saved calls, after adding, and after replacing", async () => {
    saved({ "cold_calls.dials": 8, "cold_calls.positive_replies": 5 });
    // Answers logged on their own still count against the calls saved earlier, and the message says so.
    const countsSaved = "Answers (9) can't be more than calls made (8) for Oct 18. That counts what's already saved for that day. If a saved number is wrong, log only the right number for it and choose Replace them.";
    expect(await log({ "cold_calls.neutral_replies": 4 })).toEqual({ status: "error", message: countsSaved });
    expect((await log({ "cold_calls.positive_replies": 4 })).code).toBe("existing");
    expect(await log({ "cold_calls.positive_replies": 4 }, { onExisting: "add" })).toEqual({ status: "error", message: countsSaved });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await log({ "cold_calls.positive_replies": 4 }, { onExisting: "replace" })).toMatchObject({ status: "success" });
    // Adding calls along with the answers fits.
    expect(await log({ "cold_calls.dials": 10, "cold_calls.negative_replies": 3 }, { onExisting: "add" })).toMatchObject({ status: "success", message: "Added to Oct 18: now 18 cold calls made. Also saved 3 negative replies. Trends are updated." });
    expect(day("cold_calls.negative_replies")).toBe(3);
  });

  it("saves nothing when the saved numbers can't be read", async () => {
    mocks.from.mockImplementation(() => {
      const builder = { select: () => builder, eq: () => builder, in: () => builder, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "57014", message: "timeout" } }).then(resolve) };
      return builder;
    });
    expect(await log({ "cold_calls.dials": 5 })).toEqual({ status: "error", message: "The saved numbers couldn't be checked, so nothing was saved. Retry in a moment." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
