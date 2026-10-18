import { describe, expect, it, vi } from "vitest";
import { adminPageNumber, aggregateExperimentPerformance, buildContentDemand, loadAdminDashboardData, loadOutreachChannelSeries, outreachTouchCount, shapeAdminAnalytics } from "@/lib/admin/dashboard";
import type { OutreachExperiment } from "@/lib/admin/types";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/admin/session", () => ({ requireAdminSession: mocks.authorize }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

describe("exact admin analytics read model", () => {
  it("keeps SQL totals independent of paginated lists and reports historical coverage", () => {
    const result = shapeAdminAnalytics({
      coverage_started_at: "2026-09-05T12:00:00.000Z",
      metrics: { saved_current: 12050, builds_current: 5000, cohort_submitted_current: 5000, outreach_current: 31000 },
      funnel: { saved: 12050, submitted: 5000 }, trend: [], experiments: [], recent_batches: [],
      experiment_count: 31, batch_count: 100, outreach: { initial_dms: 31000, replies: 3100 },
    }, "2026-09-05T12:00:00.000Z", { experimentPage: 1, batchPage: 2 });
    expect(result.metrics[0].value).toBe("12,050");
    expect(result.outreach.initialDms).toBe(31000);
    expect(result.outreach.replyRate).toBe(10);
    expect(result.pagination).toEqual({ experimentPage: 1, batchPage: 2, experimentCount: 31, batchCount: 100 });
    expect(result.dataNotice).toContain("already-deleted history cannot be reconstructed");
    expect(result.dataStatus).toBe("partial");
  });
  it("measures reply rate against reply_base so follow-up experiments cannot exceed 100%", () => {
    const result = shapeAdminAnalytics({
      coverage_started_at: "2026-01-01T00:00:00.000Z",
      metrics: { replies_current: 30, initial_dms_current: 0, reply_base_current: 160 },
      funnel: {}, trend: [], experiments: [], recent_batches: [],
      outreach: { initial_dms: 0, f1_sent: 160, replies: 30, reply_base: 160 },
    }, "2026-09-05T12:00:00.000Z", { experimentPage: 0, batchPage: 0 });
    expect(result.outreach.replyBase).toBe(160);
    expect(result.outreach.replyRate).toBe(18.75);
    expect(result.metrics.find((metric) => metric.label === "Replies")?.detail).toBe("18.8% reply rate");
  });
  it("does not present missing infrastructure as zero or healthy statistics", async () => {
    mocks.authorize.mockResolvedValue("user_admin");
    mocks.rpc.mockResolvedValue({ error: { code: "PGRST202" }, data: null });
    const result = await loadAdminDashboardData();
    expect(mocks.authorize).toHaveBeenCalled();
    expect(result.dataStatus).toBe("unavailable");
    expect(result.metrics).toEqual([]);
    expect(result.funnel).toEqual([]);
    expect(result.dataConnected).toBe(false);
  });
  it("bounds untrusted page input and rejects incomplete aggregate payloads", () => {
    expect(adminPageNumber("2")).toBe(2);
    expect(adminPageNumber(-1)).toBe(0);
    expect(adminPageNumber("oops")).toBe(0);
    expect(() => shapeAdminAnalytics({}, "now", { experimentPage: 0, batchPage: 0 })).toThrow("analytics_payload_incomplete");
  });
});

describe("outreach channels", () => {
  const series = (args: Record<string, unknown>) => ({ grain: "day", from: args.p_from, to: args.p_to, previous_from: "2026-08-20", previous_to: "2026-09-18", today: "2026-10-18", dimension: args.p_dimension, buckets: [], series: [] });

  it("says the Outreach touches card adds up only Dripify, Reddit DMs and cold calls, and rates replies on people reached", () => {
    const result = shapeAdminAnalytics({
      coverage_started_at: "2026-01-01T00:00:00.000Z",
      metrics: { outreach_current: 400, replies_current: 18, reply_base_current: 400, initial_dms_current: 0 },
      funnel: {}, trend: [], experiments: [], recent_batches: [], outreach: {},
    }, "2026-09-05T12:00:00.000Z", { experimentPage: 0, batchPage: 0 });
    expect(result.metrics.find((metric) => metric.label === "Outreach touches")?.detail).toBe("All channels: Dripify, Reddit DMs and cold calls");
    expect(result.metrics.find((metric) => metric.label === "Replies")?.detail).toBe("4.5% reply rate");
  });

  it("loads each channel's last 30 days, after authorizing, filtered to that channel", async () => {
    mocks.rpc.mockReset();
    mocks.authorize.mockResolvedValue("user_admin");
    mocks.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ error: null, data: series(args) }));
    const result = await loadOutreachChannelSeries("2026-10-18");
    expect(mocks.authorize).toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name, args]) => [name, args.p_dimension, args.p_grain, args.p_from, args.p_to, args.p_metric_keys])).toEqual(["linkedin/dripify", "reddit/dm", "phone/cold_call"].map((dimension) => [
      "load_analytics_series", dimension, "day", "2026-09-19", "2026-10-18", ["outreach.touches", "outreach.replies", "outreach.reply_base", "outreach.calls_booked"],
    ]));
    expect(result?.map((item) => item.dimension)).toEqual(["linkedin/dripify", "reddit/dm", "phone/cold_call"]);
  });

  it("reports the channels unavailable, not zero, when any series fails", async () => {
    mocks.rpc.mockReset();
    mocks.authorize.mockResolvedValue("user_admin");
    mocks.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => args.p_dimension === "reddit/dm" ? { error: { code: "PGRST202" }, data: null } : { error: null, data: series(args) });
    expect(await loadOutreachChannelSeries("2026-10-18")).toBeNull();
  });
});

describe("admin experiment performance", () => {
  it("includes custom-step sends in outreach totals and charts", () => {
    expect(outreachTouchCount({
      connection_requests: 10,
      initial_dms: 8,
      f1_sent: 6,
      f2_sent: 4,
      custom_sent: 3,
    })).toBe(31);
  });

  it("uses the selected message-step exposure and attributed replies", () => {
    const experiment: OutreachExperiment = {
      id: "experiment-1",
      title: "Follow-up test",
      audience: "Agency owners",
      campaign: null,
      channel: "linkedin",
      method: "manual",
      messageStep: "follow_up_1",
      primaryMetric: "reply_rate",
      status: "active",
      variants: [{ id: "variant-a", label: "A", title: "Outcome hook" }],
    };
    const result = aggregateExperimentPerformance(
      [experiment],
      [{ id: "batch-1", experiment_id: experiment.id }],
      [{
        batch_id: "batch-1",
        variant_id: "variant-a",
        initial_dms: 100,
        f1_sent: 50,
        replies: 20,
        attributed_replies: 10,
      }],
    );

    expect(result[experiment.id]?.[0]).toMatchObject({
      sent: 50,
      replies: 10,
      primaryNumerator: 10,
      primaryDenominator: 50,
      primaryRate: 20,
    });
  });
});

describe("admin AI demand aggregation", () => {
  it("counts only successful AI classifications and groups requested outcomes", () => {
    expect(buildContentDemand([
      { latest_extraction: { demand: { method: "ai", demandCategory: "Lead Follow-up", confidence: 0.91 } } },
      { latest_extraction: { demand: { method: "ai", demandCategory: "Lead Follow-up", confidence: 0.84 } } },
      { latest_extraction: { demand: { method: "ai", demandCategory: "Scheduling and Reminders", confidence: 0.73 } } },
      { latest_extraction: { demand: { method: "ai", demandCategory: "Document Collection", confidence: 0.22 } } },
      { latest_extraction: { demand: { method: "deterministic_fallback", demandCategory: "Client Intake" } } },
      { latest_extraction: { source: "customer_approved_website_flow" } },
    ])).toEqual([
      { label: "Lead Follow-up", value: 2 },
      { label: "Scheduling and Reminders", value: 1 },
    ]);
  });
});
