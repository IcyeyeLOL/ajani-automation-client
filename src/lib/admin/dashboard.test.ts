import { describe, expect, it, vi } from "vitest";
import { adminPageNumber, aggregateExperimentPerformance, buildContentDemand, loadAdminDashboardData, outreachTouchCount, shapeAdminAnalytics } from "@/lib/admin/dashboard";
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
