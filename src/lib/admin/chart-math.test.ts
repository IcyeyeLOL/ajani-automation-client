import { describe, expect, it } from "vitest";
import { barWidth, healthSummary, percentOf } from "@/lib/admin/chart-math";

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

  it("sums health across systems and counts the ones needing review", () => {
    expect(healthSummary([
      { label: "AI workflow", healthy: 140, attention: 2, detail: "" },
      { label: "Transcription", healthy: 56, attention: 0, detail: "" },
      { label: "Live systems", healthy: 4, attention: 1, detail: "" },
    ])).toEqual({ healthy: 200, attention: 3, checked: 203, share: (200 / 203) * 100, flagged: 2 });
    expect(healthSummary([])).toEqual({ healthy: 0, attention: 0, checked: 0, share: null, flagged: 0 });
  });
});
