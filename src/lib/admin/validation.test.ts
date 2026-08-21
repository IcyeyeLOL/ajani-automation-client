import { describe, expect, it } from "vitest";
import { outreachBatchSchema, outreachExperimentSchema, outreachMetricSchema } from "@/lib/admin/validation";

const validMetric = {
  variantId: null,
  variantLabel: "No variant",
  connectionRequests: 100,
  connectionsAccepted: 40,
  initialDms: 80,
  f1Sent: 50,
  f2Sent: 20,
  replies: 12,
  positiveReplies: 6,
  callsBooked: 3,
};

describe("admin outreach validation", () => {
  it("accepts internally consistent aggregate metrics", () => {
    expect(outreachMetricSchema.safeParse(validMetric).success).toBe(true);
  });

  it.each([
    ["accepted connections", { connectionsAccepted: 101 }],
    ["replies", { replies: 81 }],
    ["second follow-ups", { f2Sent: 51 }],
    ["positive replies", { positiveReplies: 13 }],
    ["bookings", { callsBooked: 13 }],
  ])("rejects impossible %s counts", (_label, changes) => {
    expect(outreachMetricSchema.safeParse({ ...validMetric, ...changes }).success).toBe(false);
  });

  it("validates the complete batch and flexible experiment inputs", () => {
    expect(outreachBatchSchema.safeParse({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "August outreach",
      experimentId: null,
      notes: "",
      metrics: [validMetric],
    }).success).toBe(true);
    expect(outreachExperimentSchema.safeParse({
      title: "Outcome hook comparison",
      audience: "Insurance owners",
      campaign: "August outreach",
      channel: "linkedin",
      method: "manual",
      primaryMetric: "reply_rate",
      createdBy: "Ajani team",
      variants: "Outcome hook, Compliance hook",
    }).success).toBe(true);
  });
});
