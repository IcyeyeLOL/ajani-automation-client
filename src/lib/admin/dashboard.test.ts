import { describe, expect, it, vi } from "vitest";
import { aggregateExperimentPerformance, buildContentDemand, outreachTouchCount } from "@/lib/admin/dashboard";
import type { OutreachExperiment } from "@/lib/admin/types";

vi.mock("server-only", () => ({}));

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
