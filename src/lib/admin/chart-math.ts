import type { OperationsStatus } from "@/lib/admin/types";

export function percentOf(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Bar length as a share of the largest bar. Anything above zero stays visible. */
export function barWidth(value: number, max: number, floor = 1.5) {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.max(floor, (value / max) * 100));
}

export function healthSummary(systems: OperationsStatus[]) {
  const healthy = systems.reduce((sum, item) => sum + item.healthy, 0);
  const attention = systems.reduce((sum, item) => sum + item.attention, 0);
  return { healthy, attention, checked: healthy + attention, share: percentOf(healthy, healthy + attention), flagged: systems.filter((item) => item.attention > 0).length };
}
