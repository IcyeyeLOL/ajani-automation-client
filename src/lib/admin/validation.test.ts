import { describe, expect, it } from "vitest";
import { experimentMetricEntrySchema, outreachBatchSchema, outreachExperimentSchema, outreachMetricSchema } from "@/lib/admin/validation";

const validMetric = {
  variantId: null,
  variantLabel: "No variant",
  connectionRequests: 100,
  connectionsAccepted: 40,
  initialDms: 80,
  f1Sent: 50,
  f2Sent: 20,
  customSent: 0,
  replies: 12,
  attributedReplies: 10,
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
    ["attributed replies", { attributedReplies: 13 }],
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
      messageStep: "initial_dm",
      primaryMetric: "reply_rate",
      variants: "Outcome hook, Compliance hook",
    }).success).toBe(true);
  });

  it("validates a complete per-variant experiment update", () => {
    expect(experimentMetricEntrySchema.safeParse({
      experimentId: "b7053867-3ad5-483f-90ba-d542abbd6ebd",
      messageStep: "initial_dm",
      activityDate: "2026-08-26",
      teamMember: "Ajani team",
      notes: "August cohort",
      metrics: [{
        variantId: "5210b79a-90eb-4218-82c2-32d7eea6f429",
        variantLabel: "A",
        sent: 100,
        replies: 18,
        positiveReplies: 7,
        callsBooked: 3,
        connectionRequests: 120,
        connectionsAccepted: 54,
      }],
    }).success).toBe(true);
  });

  it("uses requests sent as the acceptance denominator for connection-request tests", () => {
    const result = experimentMetricEntrySchema.safeParse({
      experimentId: "b7053867-3ad5-483f-90ba-d542abbd6ebd",
      messageStep: "connection_request",
      activityDate: "2026-08-26",
      teamMember: "Ajani team",
      notes: "",
      metrics: [{
        variantId: "5210b79a-90eb-4218-82c2-32d7eea6f429",
        variantLabel: "A",
        sent: 20,
        replies: 0,
        positiveReplies: 0,
        callsBooked: 0,
        connectionRequests: 0,
        connectionsAccepted: 21,
      }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Accepted connections cannot exceed connection requests");
  });
});
