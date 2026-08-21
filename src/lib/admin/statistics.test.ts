import { describe, expect, it } from "vitest";
import { relativeGrowth, relativeLift, safeRate, twoProportionZScore, weightedRate } from "@/lib/admin/statistics";

describe("admin statistics", () => {
  it("uses the correct denominators and handles zero", () => {
    expect(safeRate(24, 300)).toBeCloseTo(0.08);
    expect(safeRate(0, 0)).toBeNull();
    expect(relativeGrowth(10, 0)).toBeNull();
  });

  it("calculates relative lift separately from percentage points", () => {
    expect(relativeLift(0.08, 0.05)).toBeCloseTo(0.6);
  });

  it("weights combined rates by their denominators", () => {
    expect(weightedRate([{ numerator: 1, denominator: 10 }, { numerator: 9, denominator: 90 }])).toBeCloseTo(0.1);
  });

  it("uses a pooled two-proportion z-score for A/B significance", () => {
    expect(twoProportionZScore(40, 300, 20, 300)).toBeGreaterThan(1.96);
    expect(Math.abs(twoProportionZScore(24, 300, 15, 300) ?? 0)).toBeLessThan(1.96);
    expect(twoProportionZScore(0, 0, 1, 10)).toBeNull();
  });
});
