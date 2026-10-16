import type { OperationsStatus, OutreachTotals } from "@/lib/admin/types";

export type OutreachStep = { key: string; label: string; value: number; rate: number | null; note: string };

export function percentOf(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Bar length as a share of the largest bar. Anything above zero stays visible. */
export function barWidth(value: number, max: number, floor = 1.5) {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.max(floor, (value / max) * 100));
}

/** Each rate is a share of an earlier step's summed count, never an average of daily rates. */
export function outreachSteps(totals: OutreachTotals): OutreachStep[] {
  const step = (key: string, label: string, value: number, base: number | null, of: string): OutreachStep => {
    const rate = base === null ? null : percentOf(value, base);
    return { key, label, value, rate, note: base === null ? of : rate === null ? `No ${of} yet to compare` : `${rate.toFixed(1)}% of ${of}` };
  };
  return [
    step("requests", "Connection requests", totals.connectionRequests, null, "Where outreach starts"),
    step("accepted", "Accepted", totals.connectionsAccepted, totals.connectionRequests, "requests"),
    // First messages also go to people who connected earlier, so this step can be larger than the one before.
    step("dms", "Initial DMs", totals.initialDms, null, "First messages, to new and older connections"),
    // The reply base is the people sent a first message (or the sends at a tested step).
    step("replies", "Replies", totals.replies, totals.replyBase, "people messaged"),
    step("positive", "Positive replies", totals.positiveReplies, totals.replies, "replies"),
    // Calls are measured against all replies, like the Trends "Replies → calls" rate: a call can be
    // logged without a positive reply, so a share of positive replies could pass 100%.
    step("calls", "Calls booked", totals.callsBooked, totals.replies, "replies"),
  ];
}

export function healthSummary(systems: OperationsStatus[]) {
  const healthy = systems.reduce((sum, item) => sum + item.healthy, 0);
  const attention = systems.reduce((sum, item) => sum + item.attention, 0);
  return { healthy, attention, checked: healthy + attention, share: percentOf(healthy, healthy + attention), flagged: systems.filter((item) => item.attention > 0).length };
}
