import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  dayCount,
  formatMetricValue,
  goalProgress,
  goalRateLabel,
  metricChange,
  metricSeriesSearch,
  parseMetricSeriesQuery,
  periodStart,
  rangeForPreset,
} from "@/lib/admin/metric-query";
import type { Goal } from "@/lib/admin/metric-types";

describe("trend ranges", () => {
  it("ends today and starts on a complete period boundary for every grain", () => {
    const today = "2026-10-16"; // Friday
    expect(rangeForPreset("day", 7, today)).toEqual({ from: "2026-10-10", to: today });
    expect(rangeForPreset("week", 12, today)).toEqual({ from: "2026-07-27", to: today });
    expect(rangeForPreset("month", 12, today)).toEqual({ from: "2025-11-01", to: today });
    expect(rangeForPreset("quarter", 4, today)).toEqual({ from: "2026-01-01", to: today });
    expect(rangeForPreset("year", 3, today)).toEqual({ from: "2024-01-01", to: today });
  });

  it("uses Monday-start ISO weeks, matching Postgres date_trunc", () => {
    expect(periodStart("week", new Date(Date.UTC(2026, 9, 18))).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(periodStart("week", new Date(Date.UTC(2026, 9, 12))).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(periodStart("quarter", new Date(Date.UTC(2026, 10, 30))).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("counts inclusive days", () => {
    expect(dayCount("2026-10-01", "2026-10-16")).toBe(16);
  });
});

describe("trend query parsing", () => {
  it("deduplicates metrics and normalizes the account filter", () => {
    const parsed = parseMetricSeriesQuery(new URLSearchParams("metrics=youtube.views,youtube.views,tiktok.followers&grain=month&from=2026-01-01&to=2026-10-16&dimension=@AjaniFlow"));
    expect(parsed.success && parsed.data).toEqual({
      metrics: ["youtube.views", "tiktok.followers"],
      grain: "month",
      from: "2026-01-01",
      to: "2026-10-16",
      dimension: "@ajaniflow",
    });
  });

  it("rejects unknown grains, reversed ranges, injected keys and too many metrics", () => {
    expect(parseMetricSeriesQuery(new URLSearchParams("metrics=youtube.views&grain=decade&from=2026-01-01&to=2026-10-16")).success).toBe(false);
    expect(parseMetricSeriesQuery(new URLSearchParams("metrics=youtube.views&grain=day&from=2026-10-16&to=2026-01-01")).success).toBe(false);
    expect(parseMetricSeriesQuery(new URLSearchParams("metrics=youtube.views;drop&grain=day&from=2026-10-01&to=2026-10-16")).success).toBe(false);
    const thirteen = Array.from({ length: 13 }, (_, index) => `youtube.metric_${index}`).join(",");
    expect(parseMetricSeriesQuery(new URLSearchParams(`metrics=${thirteen}&grain=day&from=2026-10-01&to=2026-10-16`)).success).toBe(false);
  });

  it("builds an order-independent cache key", () => {
    const base = { grain: "week" as const, from: "2026-07-27", to: "2026-10-16", dimension: null };
    expect(metricSeriesSearch({ ...base, metrics: ["b.two", "a.one"] })).toBe(metricSeriesSearch({ ...base, metrics: ["a.one", "b.two"] }));
  });
});

describe("trend formatting", () => {
  it("formats each unit for people, never inventing zeros for unknown values", () => {
    expect(formatMetricValue(null, "count")).toBe("—");
    expect(formatMetricValue(1234, "count")).toBe("1,234");
    expect(formatMetricValue(125000, "count", "compact")).toBe("125K");
    expect(formatMetricValue(0.1875, "ratio")).toBe("18.8%");
    expect(formatMetricValue(250000, "currency_cents")).toBe("$2,500.00");
    expect(formatMetricValue(12.25, "hours")).toBe("12.3 h");
  });

  it("compares rates in points and everything else relatively, respecting direction", () => {
    expect(metricChange({ unit: "ratio", higherIsBetter: true }, 0.2, 0.15)).toEqual({ label: "+5.0 pts", tone: "good" });
    expect(metricChange({ unit: "count", higherIsBetter: true }, 80, 100)).toEqual({ label: "−20.0%", tone: "bad" });
    expect(metricChange({ unit: "count", higherIsBetter: false }, 80, 100)).toEqual({ label: "−20.0%", tone: "good" });
    expect(metricChange({ unit: "count", higherIsBetter: true }, 5, 0)).toBeNull();
    expect(metricChange({ unit: "count", higherIsBetter: true }, 5, null)).toBeNull();
  });

  it("labels buckets by grain", () => {
    expect(bucketLabel("2026-07-01", "quarter")).toBe("Q3 2026");
    expect(bucketLabel("2026-01-01", "year")).toBe("2026");
    expect(bucketLabel("2026-10-01", "month")).toBe("Oct 2026");
  });
});

describe("growth goal pace", () => {
  // Friday 2026-10-16; the goal sheet runs 174 days, Jul 12 to Jan 1 inclusive, so 97 days have passed.
  const today = "2026-10-16";
  const weekStart = "2026-10-12";
  const goal = (overrides: Partial<Goal> = {}): Goal => ({
    key: "clients_signed", metricKey: "sales.deals_won", label: "Clients signed", description: "", measure: "total",
    unit: "count", entryMode: "manual", target: 5, startDate: "2026-07-12", dueDate: "2027-01-01",
    current: 2, baseline: null, lastWeek: null, lastRecorded: "2026-10-16", ...overrides,
  });

  it("judges a running total against a straight line, rounding counts down", () => {
    expect(goalProgress(goal(), today, weekStart)).toEqual({ status: "on_pace", share: 0.4, expected: 2, expectedShare: 0.4, remaining: 3, daysLeft: 77 });
    expect(goalProgress(goal({ current: 1 }), today, weekStart).status).toBe("behind");
    const money = goalProgress(goal({ unit: "currency_cents", target: 500_000, current: 100_000 }), today, weekStart);
    expect(money.status).toBe("behind");
    expect(money.expected).toBeCloseTo(500_000 * 97 / 174, 6);
  });

  it("starts a latest value from its recorded baseline and gives no verdict without one", () => {
    const followers = { measure: "latest" as const, metricKey: "linkedin.followers", target: 4000, current: 2500 };
    const paced = goalProgress(goal({ ...followers, baseline: 1000 }), today, weekStart);
    expect(paced.expected).toBe(Math.floor(1000 + 3000 * 97 / 174));
    expect(paced.status).toBe("behind");
    expect(goalProgress(goal({ ...followers, baseline: null }), today, weekStart)).toMatchObject({ status: "no_pace", expected: null, expectedShare: null, remaining: 1500 });
  });

  it("paces a weekly goal across Monday to Sunday", () => {
    const weekly = { measure: "weekly" as const, metricKey: "linkedin.posts_published", target: 3, dueDate: null };
    expect(goalProgress(goal({ ...weekly, current: 2 }), today, weekStart)).toMatchObject({ status: "on_pace", expected: 2, remaining: 1, daysLeft: 2 });
    expect(goalProgress(goal({ ...weekly, current: 1 }), today, weekStart).status).toBe("behind");
    expect(goalProgress(goal({ ...weekly, current: 1 }), "2026-10-13", weekStart).status).toBe("on_pace");
  });

  it("never turns missing data into progress, and closes out finished goals", () => {
    expect(goalProgress(goal({ current: null }), today, weekStart)).toMatchObject({ status: "not_logged", share: null, remaining: null });
    expect(goalProgress(goal({ startDate: "2026-10-20" }), today, weekStart).status).toBe("not_started");
    expect(goalProgress(goal({ current: 6 }), today, weekStart)).toMatchObject({ status: "reached", share: 1, remaining: 0 });
    expect(goalProgress(goal({ dueDate: "2026-10-01", current: 3 }), today, weekStart)).toMatchObject({ status: "missed", daysLeft: 0 });
  });

  it("phrases the pace still needed in the goal's own unit", () => {
    expect(goalRateLabel({ unit: "count" }, 4, 77)).toBe("about 1 every 2.8 weeks");
    expect(goalRateLabel({ unit: "count" }, 30, 77)).toBe("about 3 a week");
    expect(goalRateLabel({ unit: "currency_cents" }, 400_000, 77)).toBe("about $364 a week");
    expect(goalRateLabel({ unit: "count" }, 0, 77)).toBeNull();
    expect(goalRateLabel({ unit: "count" }, 3, 5)).toBeNull();
  });
});
