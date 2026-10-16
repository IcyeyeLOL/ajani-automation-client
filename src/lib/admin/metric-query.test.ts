import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  dayCount,
  formatMetricValue,
  metricChange,
  metricSeriesSearch,
  parseMetricSeriesQuery,
  periodStart,
  rangeForPreset,
} from "@/lib/admin/metric-query";

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
