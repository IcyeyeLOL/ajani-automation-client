import { describe, expect, it } from "vitest";
import {
  MAX_TREND_PICKS,
  TREND_GRAINS,
  axisDateLabel,
  axisLabels,
  axisTicks,
  bucketLabel,
  channelLabel,
  dayCount,
  formatMetricValue,
  goalProgress,
  goalRateLabel,
  grainForPeriod,
  isEarlyTracking,
  isLifetimeRate,
  metricChange,
  metricSeriesSearch,
  missingValueLabel,
  niceCeiling,
  parseMetricSeriesQuery,
  periodStart,
  rangeForPreset,
  rangeLabel,
  readTrendPreferences,
  shortBucketLabel,
  shortMetricLabel,
  sourceLabel,
  trendBasis,
  trendChange,
  trendPeriods,
  trendRange,
  trendViews,
  viewPicks,
} from "@/lib/admin/metric-query";
import type { Goal } from "@/lib/admin/metric-types";

describe("early tracking", () => {
  const today = "2026-10-16";
  const stored = (firstDate: string | null, entryMode: "manual" | "connector" | "derived" = "connector") => ({ entryMode, firstDate });

  it("is early with nothing stored, or with only recent numbers and little outreach", () => {
    expect(isEarlyTracking([], 0, today)).toBe(true);
    // The live desk on 2026-10-16: one Dripify sync, no outreach logged.
    expect(isEarlyTracking([stored("2026-10-16"), stored(null, "manual")], 0, today)).toBe(true);
    expect(isEarlyTracking([stored("2026-10-03")], 13, today)).toBe(true);
  });

  it("stops once any logged or synced number goes back two weeks", () => {
    expect(isEarlyTracking([stored("2026-10-02")], 0, today)).toBe(false);
    expect(isEarlyTracking([stored("2026-01-05", "manual")], 0, today)).toBe(false);
  });

  it("stops once outreach was logged on 14 days", () => {
    expect(isEarlyTracking([], 14, today)).toBe(false);
  });

  it("ignores live-derived metrics, which carry no first date", () => {
    expect(isEarlyTracking([stored("2025-01-01", "derived")], 0, today)).toBe(true);
  });
});

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
    expect(formatMetricValue(250000, "currency_cents")).toBe("$2,500");
    expect(formatMetricValue(395000, "currency_cents")).toBe("$3,950");
    expect(formatMetricValue(1999, "currency_cents")).toBe("$19.99");
    expect(formatMetricValue(250050, "currency_cents")).toBe("$2,500.50");
    expect(formatMetricValue(1_250_050, "currency_cents", "compact")).toBe("$12,501");
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

describe("trend periods", () => {
  const today = "2026-10-16"; // Friday

  it("offers only the grains each period's table allows", () => {
    const offered = Object.fromEntries(trendPeriods.map((period) => [period.id, TREND_GRAINS.filter((grain) => period.counts[grain])]));
    expect(offered).toEqual({ "7d": ["day"], "30d": ["day", "week"], "3m": ["day", "week", "month"], "6m": ["week", "month"], "12m": ["week", "month"] });
  });

  it("keeps the grain when the new period offers it, otherwise uses the period's default", () => {
    expect(grainForPeriod("3m", "day")).toBe("day");
    expect(grainForPeriod("6m", "day")).toBe("week");
    expect(grainForPeriod("7d", "month")).toBe("day");
    expect(grainForPeriod("12m", "quarter")).toBe("month");
  });

  it("turns a period and grain into the existing preset range", () => {
    expect(trendRange("3m", "week", today)).toEqual({ grain: "week", from: "2026-07-20", to: today });
    expect(trendRange("7d", "day", today)).toEqual({ grain: "day", ...rangeForPreset("day", 7, today) });
    expect(trendRange("12m", "month", today)).toEqual({ grain: "month", from: "2025-11-01", to: today });
    expect(trendRange("6m", "day", today).grain).toBe("week");
  });

  it("labels the range without the year unless it crosses one", () => {
    expect(rangeLabel("2026-07-20", today)).toBe("Jul 20 – Oct 16");
    expect(rangeLabel("2025-11-01", today)).toBe("Nov 1, 2025 – Oct 16, 2026");
  });
});

describe("trend saved view", () => {
  const known = new Set(["sales.deals_won", "linkedin.followers", "youtube.views", "revenue.mrr"]);

  it("starts on Key numbers, last 3 months by week", () => {
    expect(readTrendPreferences(null, null)).toEqual({ view: "key", period: "3m", grain: "week", picks: {} });
  });

  it("restores a v3 view, dropping unknown views, duplicates and anything that is not a metric key", () => {
    const stored = { view: "linkedin", period: "12m", grain: "month", picks: { linkedin: ["linkedin.followers", "linkedin.followers", "retired.metric", 7, "not a key"], bogus: ["revenue.mrr"], key: "not a list" } };
    expect(readTrendPreferences(stored, null)).toEqual({ view: "linkedin", period: "12m", grain: "month", picks: { linkedin: ["linkedin.followers", "retired.metric"] } });
    expect(readTrendPreferences({ view: "nope", period: "7d", grain: "month" }, null)).toEqual({ view: "key", period: "7d", grain: "day", picks: {} });
    const many = Array.from({ length: 12 }, (_, index) => `a.m${index}`);
    expect(readTrendPreferences({ picks: { key: many } }, null).picks.key).toEqual(many.slice(0, MAX_TREND_PICKS));
  });

  it("keeps saved picks while the catalog is unavailable; charting skips what the catalog lacks", () => {
    const stored = { view: "key", period: "3m", grain: "week", picks: { key: ["linkedin.followers", "retired.metric"], sales: ["revenue.mrr"] } };
    const read = readTrendPreferences(stored, null);
    expect(read.picks).toEqual(stored.picks);
    // An empty catalog (load failure) charts nothing but changes nothing saved.
    expect(viewPicks(read, trendViews[0], new Set())).toEqual([]);
    expect(viewPicks(read, trendViews[0], known)).toEqual(["linkedin.followers"]);
  });

  it("migrates v2 once: its metrics become Key numbers and its range the nearest period", () => {
    const legacy = (grain: string, count: number) => ({ grain, count, metrics: ["youtube.views", "unknown.metric", "sales.deals_won"] });
    // Not filtered by the catalog, so a migration during an outage keeps every v2 key.
    expect(readTrendPreferences(null, legacy("week", 12))).toEqual({ view: "key", period: "3m", grain: "week", picks: { key: ["youtube.views", "unknown.metric", "sales.deals_won"] } });
    expect(readTrendPreferences(null, legacy("week", 26))).toMatchObject({ period: "6m", grain: "week" });
    expect(readTrendPreferences(null, legacy("week", 52))).toMatchObject({ period: "12m", grain: "week" });
    expect(readTrendPreferences(null, legacy("day", 90))).toMatchObject({ period: "30d", grain: "day" });
    for (const grain of ["month", "quarter", "year"]) expect(readTrendPreferences(null, legacy(grain, 8))).toMatchObject({ period: "12m", grain: "month" });
    // v3 wins once it exists.
    expect(readTrendPreferences({ view: "key", period: "7d", grain: "day", picks: {} }, legacy("week", 52)).period).toBe("7d");
    expect(readTrendPreferences(null, { grain: "fortnight", metrics: [] }).picks).toEqual({});
    expect(readTrendPreferences(null, { grain: "week", count: 12, metrics: [] }).picks).toEqual({});
  });

  it("charts a view's picks, or its suggested numbers that exist, at most eight", () => {
    const view = trendViews.find((item) => item.id === "sales")!;
    expect(viewPicks({ picks: {} }, view, known)).toEqual(["sales.deals_won", "revenue.mrr"]);
    expect(viewPicks({ picks: { sales: [] } }, view, known)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) => `a.m${index}`);
    expect(viewPicks({ picks: { key: many } }, trendViews[0], new Set(many))).toEqual(many.slice(0, MAX_TREND_PICKS));
    expect(trendViews.every((item) => item.suggested.length <= MAX_TREND_PICKS)).toBe(true);
  });
});

describe("trend cards", () => {
  it("strips the platform and lifetime wording that the card already shows", () => {
    expect(shortMetricLabel("LinkedIn followers")).toBe("Followers");
    expect(shortMetricLabel("Dripify reply rate (lifetime)")).toBe("Reply rate");
    expect(shortMetricLabel("Dripify acceptance (of contacted)")).toBe("Acceptance");
    expect(shortMetricLabel("Reddit DM reply rate")).toBe("DM reply rate");
    expect(shortMetricLabel("Clients signed")).toBe("Clients signed");
    expect(sourceLabel("revenue")).toBe("Sales & revenue");
    expect(sourceLabel("ajani")).toBe("Website");
    expect(sourceLabel("x")).toBe("X");
  });

  it("names outreach channels and methods", () => {
    expect(channelLabel("linkedin/dripify")).toBe("LinkedIn · Dripify");
    expect(channelLabel("instagram/manual")).toBe("Instagram · Manual");
    expect(channelLabel("constructor")).toBe("Constructor");
  });

  it("tags rates built from running totals as lifetime rates", () => {
    const lookup = (key: string) => ({ "dripify.leads_replied": { aggregation: "last" as const }, "dripify.new_replies": { aggregation: "sum" as const } })[key];
    expect(isLifetimeRate({ aggregation: "ratio", numeratorKey: "dripify.leads_replied" }, lookup)).toBe(true);
    expect(isLifetimeRate({ aggregation: "ratio", numeratorKey: "dripify.new_replies" }, lookup)).toBe(false);
    expect(isLifetimeRate({ aggregation: "last", numeratorKey: null }, lookup)).toBe(false);
  });

  it("states the change with an arrow and a sign, rates in points", () => {
    expect(trendChange({ unit: "count", higherIsBetter: true }, 104.1, 100)).toEqual({ direction: "up", label: "▲ +4.1%", tone: "good" });
    expect(trendChange({ unit: "ratio", higherIsBetter: true }, 0.05, 0.064)).toEqual({ direction: "down", label: "▼ −1.4 points", tone: "bad" });
    expect(trendChange({ unit: "count", higherIsBetter: false }, 80, 100)).toEqual({ direction: "down", label: "▼ −20.0%", tone: "good" });
    expect(trendChange({ unit: "count", higherIsBetter: true }, 0, 0)).toEqual({ direction: "same", label: "Same as previous", tone: "neutral" });
    expect(trendChange({ unit: "count", higherIsBetter: true }, 5, 0)).toBeNull();
    expect(trendChange({ unit: "count", higherIsBetter: true }, null, 3)).toBeNull();
  });

  it("says 'Same as previous' only when nothing changed, never for a tiny real move", () => {
    expect(trendChange({ unit: "count", higherIsBetter: true }, 3412, 3411)).toEqual({ direction: "up", label: "▲ <0.1%", tone: "neutral" });
    expect(trendChange({ unit: "count", higherIsBetter: true }, 3411, 3412)).toEqual({ direction: "down", label: "▼ <0.1%", tone: "neutral" });
    expect(trendChange({ unit: "ratio", higherIsBetter: true }, 0.0431, 0.0427)).toEqual({ direction: "up", label: "▲ <0.1 points", tone: "neutral" });
    expect(trendChange({ unit: "ratio", higherIsBetter: true }, 0.0427, 0.0431)).toEqual({ direction: "down", label: "▼ <0.1 points", tone: "neutral" });
    expect(trendChange({ unit: "count", higherIsBetter: true }, 3412, 3412)?.label).toBe("Same as previous");
    expect(trendChange({ unit: "ratio", higherIsBetter: true }, 0.0431, 0.0431)?.label).toBe("Same as previous");
    expect(trendChange({ unit: "count", higherIsBetter: true }, 100.1, 100)?.label).toBe("▲ +0.1%");
  });

  it("never calls an unknown period 'No activity'", () => {
    const rate = { aggregation: "ratio" as const, entryMode: "derived" as const };
    const manual = { entryMode: "manual" as const };
    const connector = { entryMode: "connector" as const };
    expect(missingValueLabel(rate, manual, null)).toBe("Not logged");
    expect(missingValueLabel(rate)).toBe("Not logged");
    expect(missingValueLabel(rate, manual, 12)).toBe("Not logged");
    expect(missingValueLabel(rate, manual, 0)).toBe("No activity");
    // Connector data was not synced rather than not typed in.
    expect(missingValueLabel(rate, connector, null)).toBe("Not synced");
    expect(missingValueLabel(rate, connector, 0)).toBe("No activity");
    expect(missingValueLabel({ aggregation: "sum", entryMode: "derived" })).toBe("No activity");
    expect(missingValueLabel({ aggregation: "sum", entryMode: "manual" })).toBe("Not logged");
    expect(missingValueLabel({ aggregation: "last", entryMode: "connector" })).toBe("Not synced");
    expect(missingValueLabel({ aggregation: "sum", entryMode: "connector" })).toBe("Not synced");
  });

  it("labels table rows briefly", () => {
    expect(shortBucketLabel("2026-08-10", "2026-08-16", "week", false)).toBe("Aug 10–16");
    expect(shortBucketLabel("2026-08-31", "2026-09-06", "week", false)).toBe("Aug 31 – Sep 6");
    expect(shortBucketLabel("2026-10-12", "2026-10-16", "week", false)).toBe("Oct 12–16");
    expect(shortBucketLabel("2025-12-29", "2026-01-04", "week", true)).toBe("Dec 29 – Jan 4 ’26");
    expect(shortBucketLabel("2026-08-10", "2026-08-10", "day", false)).toBe("Aug 10");
    expect(shortBucketLabel("2026-08-01", "2026-08-31", "month", false)).toBe("Aug 2026");
  });

  it("judges a rate by what it divides by", () => {
    const definitions = new Map([
      ["sales.close_rate", { key: "sales.close_rate", aggregation: "ratio" as const, denominatorKey: "sales.calls_held", entryMode: "derived" }],
      ["sales.calls_held", { key: "sales.calls_held", aggregation: "sum" as const, denominatorKey: null, entryMode: "manual" }],
      ["linkedin.followers", { key: "linkedin.followers", aggregation: "last" as const, denominatorKey: null, entryMode: "manual" }],
    ]);
    const lookup = (key: string) => definitions.get(key);
    expect(trendBasis(definitions.get("sales.close_rate")!, lookup).key).toBe("sales.calls_held");
    expect(trendBasis(definitions.get("linkedin.followers")!, lookup).key).toBe("linkedin.followers");
    expect(trendBasis({ key: "x.rate", aggregation: "ratio" as const, denominatorKey: "x.gone", entryMode: "derived" }, lookup).key).toBe("x.rate");
  });

  it("dates the x-axis, with years only when the chart spans two", () => {
    expect(axisDateLabel("2026-07-20", "week", false)).toBe("Jul 20");
    expect(axisDateLabel("2025-10-20", "week", true)).toBe("Oct 20 ’25");
    expect(axisDateLabel("2026-10-12", "day", true)).toBe("Oct 12 ’26");
    expect(axisDateLabel("2025-11-01", "month", false)).toBe("Nov 2025");
  });

  it("gives three round ticks, from zero for totals and rates, zoomed for stocks", () => {
    expect(axisTicks([3412, 3866], { fromZero: false, whole: true })).toEqual([3300, 3600, 3900]);
    expect(axisTicks([0, 12, 37], { fromZero: true, whole: true })).toEqual([0, 20, 40]);
    expect(axisTicks([1, 0, 1], { fromZero: true, whole: true })).toEqual([0, 1, 2]);
    expect(axisTicks([0, 5], { fromZero: true, whole: true })).toEqual([0, 3, 6]);
    expect(axisTicks([0, 5], { fromZero: true, whole: false })).toEqual([0, 2.5, 5]);
    expect(axisTicks([0.052, 0.061], { fromZero: true, whole: false })).toEqual([0, 0.04, 0.08]);
    expect(axisTicks([26, 480], { fromZero: false, whole: true })).toEqual([0, 250, 500]);
    expect(axisTicks([], { fromZero: true, whole: false })).toEqual([0, 0.5, 1]);
  });

  it("tops the axis at the first round number at or above the largest value", () => {
    const fromZero = (value: number, whole = true) => axisTicks([0, value], { fromZero: true, whole });
    expect(fromZero(53)).toEqual([0, 30, 60]);
    expect(fromZero(3866)).toEqual([0, 2000, 4000]);
    expect(fromZero(7)).toEqual([0, 4, 8]);
    expect(fromZero(1)).toEqual([0, 1, 2]);
    expect(fromZero(1, false)).toEqual([0, 0.5, 1]);
    expect(fromZero(0)).toEqual([0, 1, 2]);
    expect(fromZero(0, false)).toEqual([0, 0.5, 1]);
    expect(fromZero(0.004, false)).toEqual([0, 0.002, 0.004]);
    expect(axisLabels(fromZero(0.004, false), "ratio")).toEqual(["0%", "0.2%", "0.4%"]);
  });

  it("keeps ticks increasing, round and covering every value", () => {
    let seed = 7;
    const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
    const tops = [2, 4, 5, 6, 8, 10];
    for (let run = 0; run < 5000; run += 1) {
      const whole = run % 2 === 0;
      const scale = 10 ** Math.floor(random() * 9 - 3);
      const values = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
        const value = random() * 10 * scale;
        return whole ? Math.round(value) : value;
      });
      const fromZero = run % 3 !== 0;
      const ticks = axisTicks(values, { fromZero, whole });
      expect(ticks[0]).toBeLessThan(ticks[1]);
      expect(ticks[1]).toBeLessThan(ticks[2]);
      expect(ticks[2]).toBeGreaterThanOrEqual(Math.max(...values));
      expect(ticks[0]).toBeLessThanOrEqual(Math.min(...values));
      expect(Math.abs(ticks[2] - ticks[1] - (ticks[1] - ticks[0]))).toBeLessThan(1e-9 * ticks[2]);
      if (whole) expect(ticks.every(Number.isInteger)).toBe(true);
      if (ticks[0] === 0) {
        // The top is a round number, and the largest value reaches past the middle tick.
        const magnitude = 10 ** Math.floor(Math.log10(ticks[2]) + 1e-9);
        expect(tops.some((top) => Math.abs(top * magnitude / 10 - ticks[2]) < 1e-9 * ticks[2] || Math.abs(top * magnitude - ticks[2]) < 1e-9 * ticks[2])).toBe(true);
        if (fromZero && Math.max(...values) > (whole ? 2 : 0)) expect(ticks[1]).toBeLessThan(Math.max(...values));
      }
    }
  });

  it("starts a single point's axis at zero", () => {
    expect(axisTicks([624.6], { fromZero: false, whole: false })).toEqual([0, 400, 800]);
    expect(axisTicks([155_000, 155_000], { fromZero: false, whole: true })).toEqual([0, 100_000, 200_000]);
  });

  it("rounds up to 1, 2, 2.5, 3, 4 and 5 steps", () => {
    expect([0.7, 1, 1.5, 2.2, 3, 3.5, 4.2, 7, 0, -4].map(niceCeiling)).toEqual([1, 1, 2, 2.5, 3, 4, 5, 10, 1, 1]);
    expect(niceCeiling(0.0305)).toBe(0.04);
  });

  it("labels an axis in one notation", () => {
    expect(axisLabels([3000, 3500, 4000], "count")).toEqual(["3,000", "3,500", "4,000"]);
    expect(axisLabels([0, 10_000, 20_000], "count")).toEqual(["0", "10K", "20K"]);
    expect(axisLabels([0, 0.025, 0.05], "ratio")).toEqual(["0%", "2.5%", "5%"]);
    expect(axisLabels([0, 100_000, 200_000], "currency_cents")).toEqual(["$0", "$1,000", "$2,000"]);
    expect(axisLabels([0, 1_000_000, 2_000_000], "currency_cents")).toEqual(["$0", "$10K", "$20K"]);
    expect(axisLabels([0, 100, 200], "hours")).toEqual(["0 h", "100 h", "200 h"]);
  });

  it("never repeats an axis label, however small the step", () => {
    expect(axisLabels([0, 0.0005, 0.001], "ratio")).toEqual(["0%", "0.05%", "0.1%"]);
    expect(axisLabels([0, 0.00025, 0.0005], "ratio")).toEqual(["0%", "0.025%", "0.05%"]);
    expect(axisLabels([0, 0.05, 0.1], "hours")).toEqual(["0 h", "0.05 h", "0.1 h"]);
    expect(axisLabels([0, 5, 10], "currency_cents")).toEqual(["$0.00", "$0.05", "$0.10"]);
    expect(axisLabels([1_000_000, 1_000_250, 1_000_500], "count")).toEqual(["1,000,000", "1,000,250", "1,000,500"]);
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
    expect(goalProgress(goal({ dueDate: "2026-10-01", current: null }), today, weekStart)).toMatchObject({ status: "missed", share: null });
    expect(goalProgress(goal({ measure: "weekly", dueDate: null, startDate: "2026-10-20", current: 1 }), today, weekStart).status).toBe("not_started");
  });

  it("phrases the pace still needed in the goal's own unit", () => {
    expect(goalRateLabel({ unit: "count" }, 4, 77)).toBe("about 1 every 2.8 weeks");
    expect(goalRateLabel({ unit: "count" }, 30, 77)).toBe("about 3 a week");
    expect(goalRateLabel({ unit: "count" }, 10, 72)).toBe("about 1 a week");
    expect(goalRateLabel({ unit: "currency_cents" }, 400_000, 77)).toBe("about $364 a week");
    expect(goalRateLabel({ unit: "count" }, 0, 77)).toBeNull();
    expect(goalRateLabel({ unit: "count" }, 3, 5)).toBeNull();
  });
});
