import { describe, expect, it } from "vitest";
import { barWidth, healthSummary, outreachSteps, percentOf } from "@/lib/admin/chart-math";
import type { OutreachTotals } from "@/lib/admin/types";

const totals = (overrides: Partial<OutreachTotals> = {}): OutreachTotals => ({
  connectionRequests: 0, connectionsAccepted: 0, initialDms: 0, f1Sent: 0, f2Sent: 0, customSent: 0,
  replies: 0, replyBase: 0, positiveReplies: 0, callsBooked: 0, acceptanceRate: null, replyRate: null, ...overrides,
});

describe("section chart math", () => {
  it("returns no rate without a denominator", () => {
    expect(percentOf(3, 12)).toBe(25);
    expect(percentOf(3, 0)).toBeNull();
  });

  it("keeps small non-zero bars visible and caps at full width", () => {
    expect(barWidth(0, 100)).toBe(0);
    expect(barWidth(5, 0)).toBe(0);
    expect(barWidth(1, 1000)).toBe(1.5);
    expect(barWidth(50, 200)).toBe(25);
    expect(barWidth(300, 200)).toBe(100);
  });

  it("measures each outreach step against the step that feeds it", () => {
    const steps = outreachSteps(totals({ connectionRequests: 200, connectionsAccepted: 50, initialDms: 120, replies: 30, replyBase: 150, positiveReplies: 12, callsBooked: 3 }));
    expect(steps.map((step) => step.value)).toEqual([200, 50, 120, 30, 12, 3]);
    expect(steps.map((step) => step.rate)).toEqual([null, 25, null, 20, 40, 10]);
    expect(steps[1].note).toBe("25.0% of requests");
    expect(steps[3].note).toBe("20.0% of people messaged");
    expect(steps[5].note).toBe("10.0% of replies");
  });

  it("measures calls against replies, so more calls than positive replies stays under 100%", () => {
    const calls = outreachSteps(totals({ replies: 10, replyBase: 40, positiveReplies: 1, callsBooked: 3 }))[5];
    expect(calls.rate).toBe(30);
    expect(calls.note).toBe("30.0% of replies");
  });

  it("still rates logged calls when no reply was marked positive", () => {
    const steps = outreachSteps(totals({ replies: 8, replyBase: 40, positiveReplies: 0, callsBooked: 2 }));
    expect(steps[4].note).toBe("0.0% of replies");
    expect(steps[5].note).toBe("25.0% of replies");
  });

  it("never invents a rate for empty outreach", () => {
    const steps = outreachSteps(totals());
    expect(steps.every((step) => step.value === 0 && step.rate === null)).toBe(true);
    expect(steps[1].note).toBe("No requests yet to compare");
  });

  it("sums health across systems and counts the ones needing review", () => {
    expect(healthSummary([
      { label: "AI workflow", healthy: 140, attention: 2, detail: "" },
      { label: "Transcription", healthy: 56, attention: 0, detail: "" },
      { label: "Live systems", healthy: 4, attention: 1, detail: "" },
    ])).toEqual({ healthy: 200, attention: 3, checked: 203, share: (200 / 203) * 100, flagged: 2 });
    expect(healthSummary([])).toEqual({ healthy: 0, attention: 0, checked: 0, share: null, flagged: 0 });
  });
});
