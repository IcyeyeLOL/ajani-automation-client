import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dayCount, goalProgress, parseDay } from "@/lib/admin/metric-query";
import type { MetricDefinition, MetricSeries, MetricSeriesQuery, MetricSeriesResult } from "@/lib/admin/metric-types";
import {
  SAMPLE_DEFINITIONS, SAMPLE_DIMENSION_LABELS, SAMPLE_GOALS, sampleDashboardData, sampleGoalBoard, sampleHistoryStart,
  sampleMetricCatalog, sampleMetricRows, sampleMetricSeries, type SampleRow,
} from "@/lib/admin/sample-data";

// A Friday, so the current ISO week is partial and today's manual numbers are not logged yet.
const TODAY = "2026-10-16";
const YESTERDAY = "2026-10-15";
const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

function query(metrics: string[], overrides: Partial<MetricSeriesQuery> = {}): MetricSeriesQuery {
  return { metrics, grain: "week", from: "2026-07-01", to: TODAY, dimension: null, ...overrides };
}

function run(metrics: string[], overrides: Partial<MetricSeriesQuery> = {}, definitions: MetricDefinition[] = SAMPLE_DEFINITIONS) {
  return sampleMetricSeries(query(metrics, overrides), definitions, TODAY);
}

function seriesOf(result: MetricSeriesResult, key: string): MetricSeries {
  const found = result.series.find((item) => item.metricKey === key);
  if (!found) throw new Error(`missing series ${key}`);
  return found;
}

function addDays(day: string, days: number) {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Hand-computed expectations straight from the daily rows, independent of the series code. */
function expectedSum(rows: SampleRow[], from: string, to: string) {
  const inRange = rows.filter((row) => row.date >= from && row.date <= to);
  return inRange.length ? inRange.reduce((sum, row) => sum + row.value, 0) : null;
}

function expectedLatest(rows: SampleRow[], day: string) {
  const latest = new Map<string, SampleRow>();
  for (const row of rows) {
    if (row.date > day) continue;
    const current = latest.get(row.dimension);
    if (!current || row.date > current.date) latest.set(row.dimension, row);
  }
  return latest.size ? [...latest.values()].reduce((sum, row) => sum + row.value, 0) : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  return denominator !== null && denominator > 0 && numerator !== null ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : null;
}

function expectClose(actual: Array<number | null>, expected: Array<number | null>) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    if (expected[index] === null) expect(value, `index ${index}`).toBeNull();
    else expect(value, `index ${index}`).toBeCloseTo(expected[index] as number, 6);
  });
}

function weekday(day: string) {
  const dow = parseDay(day).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function totalsByDate(rows: SampleRow[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) => totals.set(row.date, (totals.get(row.date) ?? 0) + row.value));
  return totals;
}

function finiteNumbers(value: unknown, trail = "root"): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [trail];
  if (Array.isArray(value)) return value.flatMap((item, index) => finiteNumbers(item, `${trail}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => finiteNumbers(item, `${trail}.${key}`));
  return [];
}

/** The final state of analytics_metric_definitions after every migration. */
function migrationDefinitions() {
  const text = "'((?:[^']|'')*)'";
  const nullable = "(null|'[a-z0-9_.]+')";
  const row = new RegExp(`\\(${text},\\s*${text},\\s*${text},\\s*${text},\\s*${text},\\s*${text},\\s*${text},\\s*${nullable},\\s*${nullable},\\s*${text},\\s*(true|false),\\s*(true|false),\\s*\\d+\\)`, "g");
  const unquote = (value: string) => value.replaceAll("''", "'");
  const definitions = new Map<string, Omit<MetricDefinition, "firstDate" | "lastDate" | "dimensions"> & { active: boolean }>();
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(migrations, file), "utf8").replaceAll("\r\n", "\n").split(/;\s*\n/)) {
      if (statement.includes("insert into public.analytics_metric_definitions")) {
        for (const match of statement.matchAll(row)) {
          const [, key, source, category, label, description, unit, aggregation, numerator, denominator, entryMode, higher, chartable] = match;
          definitions.set(key, {
            key, source, category: category as MetricDefinition["category"], label: unquote(label), description: unquote(description),
            unit: unit as MetricDefinition["unit"], aggregation: aggregation as MetricDefinition["aggregation"],
            numeratorKey: numerator === "null" ? null : numerator.slice(1, -1), denominatorKey: denominator === "null" ? null : denominator.slice(1, -1),
            entryMode: entryMode as MetricDefinition["entryMode"], higherIsBetter: higher === "true", chartable: chartable === "true", active: true,
          });
        }
      }
      const update = statement.match(/update public\.analytics_metric_definitions set ([\s\S]*?)\s*where (metric_key|source) = '([^']+)'\s*$/);
      if (!update) continue;
      const [, assignments, column, value] = update;
      const targets = [...definitions.values()].filter((item) => (column === "metric_key" ? item.key : item.source) === value);
      for (const [, field, raw] of assignments.matchAll(/(label|description|active) = ('(?:[^']|'')*'|true|false)/g)) {
        for (const target of targets) {
          if (field === "active") target.active = raw === "true";
          else target[field as "label" | "description"] = unquote(raw.slice(1, -1));
        }
      }
    }
  }
  return [...definitions.values()];
}

describe("built-in sample definitions", () => {
  it("mirror every active metric definition in the migrations, field for field", () => {
    const parsed = migrationDefinitions();
    expect(parsed.length).toBeGreaterThan(80);
    const active = parsed.filter((item) => item.active);
    expect(SAMPLE_DEFINITIONS.map((item) => item.key).sort()).toEqual(active.map((item) => item.key).sort());
    for (const expected of active) {
      const actual = SAMPLE_DEFINITIONS.find((item) => item.key === expected.key);
      const fields: Partial<typeof expected> = { ...expected };
      delete fields.active;
      expect(actual, expected.key).toMatchObject(fields);
    }
    // X was retired by the growth goals migration.
    expect(SAMPLE_DEFINITIONS.some((item) => item.source === "x")).toBe(false);
  });

  it("define both parts of every ratio", () => {
    for (const item of SAMPLE_DEFINITIONS.filter((candidate) => candidate.aggregation === "ratio")) {
      const parts = [item.numeratorKey, item.denominatorKey].map((key) => SAMPLE_DEFINITIONS.find((candidate) => candidate.key === key));
      expect(parts.every((part) => part && part.aggregation !== "ratio"), item.key).toBe(true);
    }
  });
});

describe("sample daily values", () => {
  it("are deterministic: the same inputs always give the same numbers", () => {
    const first = sampleMetricRows("linkedin.impressions", TODAY);
    // Another day's cache in between must not change anything.
    sampleMetricRows("linkedin.impressions", "2026-11-02");
    expect(sampleMetricRows("linkedin.impressions", TODAY)).toEqual(first);
    const keys = ["linkedin.followers", "outreach.reply_rate", "dripify.reply_rate", "revenue.cash_collected", "ajani.brief_to_build_rate"];
    expect(run(keys, { grain: "day", from: "2026-08-01" })).toEqual(run(keys, { grain: "day", from: "2026-08-01" }));
    const now = new Date(`${TODAY}T15:30:00.000Z`);
    expect(sampleDashboardData({}, now)).toEqual(sampleDashboardData({ experimentPage: 3 }, now));
    expect(sampleMetricCatalog(SAMPLE_DEFINITIONS, TODAY)).toEqual(sampleMetricCatalog(SAMPLE_DEFINITIONS, TODAY));
    expect(sampleGoalBoard(TODAY)).toEqual(sampleGoalBoard(TODAY));
  });

  it("vary by metric, account and date", () => {
    const impressions = sampleMetricRows("linkedin.impressions", TODAY);
    expect(new Set(impressions.map((row) => row.value)).size).toBeGreaterThan(100);
    const personal = impressions.filter((row) => row.dimension === "@ajani").map((row) => row.value);
    const page = impressions.filter((row) => row.dimension === "ajani-automation").map((row) => row.value);
    expect(personal).not.toEqual(page);
    expect(sampleMetricRows("youtube.views", TODAY).map((row) => row.value)).not.toEqual(sampleMetricRows("instagram.reach", TODAY).map((row) => row.value));
  });

  it("are whole counts, whole cents and hours with at most two decimals, never negative", () => {
    for (const item of SAMPLE_DEFINITIONS) {
      const rows = sampleMetricRows(item.key, TODAY);
      if (item.aggregation === "ratio") {
        // Ratios are never generated: they come out of their numerator and denominator.
        expect(rows, item.key).toEqual([]);
        continue;
      }
      expect(rows.length, item.key).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Number.isFinite(row.value) && row.value >= 0, `${item.key} ${row.date}`).toBe(true);
        if (item.unit === "hours") expect(Math.abs(row.value * 100 - Math.round(row.value * 100)), `${item.key} ${row.date}`).toBeLessThan(1e-6);
        else expect(Number.isInteger(row.value), `${item.key} ${row.date}`).toBe(true);
      }
    }
  });

  it("cover the last 180 days: manual numbers end yesterday, synced and live numbers end today", () => {
    const start = sampleHistoryStart(TODAY);
    expect(dayCount(start, TODAY)).toBe(181);
    for (const item of SAMPLE_DEFINITIONS.filter((candidate) => candidate.aggregation !== "ratio")) {
      const dates = sampleMetricRows(item.key, TODAY).map((row) => row.date);
      expect(dates.every((date) => date >= start && date <= TODAY), item.key).toBe(true);
      if (item.entryMode === "manual") expect(dates.reduce((latest, date) => date > latest ? date : latest), item.key).toBe(YESTERDAY);
    }
    expect(sampleMetricRows("dripify.leads_contacted", TODAY).some((row) => row.date === TODAY)).toBe(true);
    expect(sampleMetricRows("outreach.touches", TODAY).some((row) => row.date === TODAY)).toBe(true);
  });

  it("look like a small agency's numbers", () => {
    const followers = sampleMetricRows("linkedin.followers", TODAY);
    expect(new Set(followers.map((row) => row.dimension))).toEqual(new Set(["@ajani", "ajani-automation"]));
    const followersByDate = totalsByDate(followers);
    expect(followersByDate.get(sampleHistoryStart(TODAY))).toBeGreaterThanOrEqual(3_100);
    expect(followersByDate.get(sampleHistoryStart(TODAY))).toBeLessThanOrEqual(3_350);
    expect(followersByDate.get(YESTERDAY)).toBeGreaterThanOrEqual(3_750);
    expect(followersByDate.get(YESTERDAY)).toBeLessThanOrEqual(4_000);

    const posts = totalsByDate(sampleMetricRows("linkedin.posts_published", TODAY));
    expect(Math.max(...sampleMetricRows("linkedin.posts_published", TODAY).map((row) => row.value))).toBeLessThanOrEqual(2);
    // Complete ISO weeks inside the history: 3-4 posts a week on average.
    const weeks: number[] = [];
    for (let monday = "2026-04-20"; addDays(monday, 6) <= YESTERDAY; monday = addDays(monday, 7)) {
      weeks.push(Array.from({ length: 7 }, (_, offset) => posts.get(addDays(monday, offset)) ?? 0).reduce((sum, value) => sum + value, 0));
    }
    const averagePosts = weeks.reduce((sum, value) => sum + value, 0) / weeks.length;
    expect(averagePosts).toBeGreaterThanOrEqual(3);
    expect(averagePosts).toBeLessThanOrEqual(4.5);

    const impressions = [...totalsByDate(sampleMetricRows("linkedin.impressions", TODAY)).values()];
    expect(Math.min(...impressions)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...impressions)).toBeLessThan(10_000);

    // Outreach adds every channel: logged batches, Dripify, Reddit DMs and cold calls, all on workdays.
    const touches = totalsByDate(sampleMetricRows("outreach.touches", TODAY));
    for (const [date, value] of touches) {
      if (weekday(date)) {
        expect(value, date).toBeGreaterThanOrEqual(30);
        expect(value, date).toBeLessThanOrEqual(200);
      } else {
        expect(value, date).toBeLessThan(10);
      }
    }
    const sumOf = (key: string) => sampleMetricRows(key, TODAY).reduce((sum, row) => sum + row.value, 0);
    for (const channel of ["linkedin/manual", "instagram/manual", "linkedin/dripify", "reddit/dm", "phone/cold_call"]) {
      expect(sampleMetricRows("outreach.touches", TODAY).some((row) => row.dimension === channel && row.value > 0), channel).toBe(true);
    }
    const replyShare = sumOf("outreach.replies") / sumOf("outreach.reply_base");
    expect(replyShare).toBeGreaterThanOrEqual(0.05);
    expect(replyShare).toBeLessThanOrEqual(0.15);
    const callsPerWeek = (sumOf("outreach.calls_booked") / 181) * 7;
    expect(callsPerWeek).toBeGreaterThanOrEqual(2);
    expect(callsPerWeek).toBeLessThanOrEqual(8);

    // About one or two clients a month, each paying a $1,500-$3,000 setup fee.
    const deals = sampleMetricRows("sales.deals_won", TODAY).filter((row) => row.value > 0);
    expect(deals.length).toBeGreaterThanOrEqual(5);
    expect(deals.length).toBeLessThanOrEqual(12);
    const cash = sampleMetricRows("revenue.cash_collected", TODAY);
    for (const deal of deals) {
      const paid = cash.find((row) => row.date === deal.date)?.value ?? 0;
      expect(paid, deal.date).toBeGreaterThanOrEqual(150_000);
      expect(paid, deal.date).toBeLessThanOrEqual(300_000 + 50_000);
    }
    const mrr = sampleMetricRows("revenue.mrr", TODAY);
    expect(mrr[mrr.length - 1].value).toBeGreaterThan(mrr[0].value);
    expect(Math.max(...sampleMetricRows("ajani.drafts_saved", TODAY).map((row) => row.value))).toBeLessThanOrEqual(6);
  });

  it("keep Dripify's per-campaign running totals consistent, with new activity equal to their daily change", () => {
    const keys = ["leads_total", "leads_contacted", "leads_accepted", "leads_replied", "leads_remaining", "leads_in_progress", "leads_finished", "leads_failed", "new_contacted", "new_accepted", "new_replies"];
    const rows = Object.fromEntries(keys.map((key) => [key, sampleMetricRows(`dripify.${key}`, TODAY)]));
    const campaigns = [...new Set(rows.leads_contacted.map((row) => row.dimension))].sort();
    expect(campaigns).toEqual(["dripify:101", "dripify:202", "dripify:303"]);
    campaigns.forEach((campaign) => expect(SAMPLE_DIMENSION_LABELS[campaign]).toBeTruthy());
    for (const campaign of campaigns) {
      const value = (key: string, date: string) => rows[key].find((row) => row.dimension === campaign && row.date === date)?.value;
      const dates = rows.leads_total.filter((row) => row.dimension === campaign).map((row) => row.date);
      expect(dates.length).toBeGreaterThan(20);
      // A campaign's first sync has no earlier total, so its first day has no new activity.
      for (const key of ["new_contacted", "new_accepted", "new_replies"]) expect(value(key, dates[0]), `${campaign} ${key}`).toBeUndefined();
      dates.forEach((date, index) => {
        const total = value("leads_total", date) as number;
        const contacted = value("leads_contacted", date) as number;
        const accepted = value("leads_accepted", date) as number;
        const replied = value("leads_replied", date) as number;
        expect(contacted).toBeLessThanOrEqual(total);
        expect(accepted).toBeLessThanOrEqual(contacted);
        expect(replied).toBeLessThanOrEqual(accepted);
        expect(value("leads_remaining", date)).toBe(total - contacted);
        expect(value("leads_in_progress", date)).toBeGreaterThanOrEqual(0);
        expect((value("leads_finished", date) as number) + (value("leads_failed", date) as number)).toBeLessThanOrEqual(contacted);
        if (!index) return;
        const before = dates[index - 1];
        for (const key of ["leads_total", "leads_contacted", "leads_accepted", "leads_replied", "leads_finished", "leads_failed"]) {
          expect(value(key, date) as number, `${campaign} ${key} ${date}`).toBeGreaterThanOrEqual(value(key, before) as number);
        }
        expect(value("new_contacted", date)).toBe(contacted - (value("leads_contacted", before) as number));
        expect(value("new_accepted", date)).toBe(accepted - (value("leads_accepted", before) as number));
        expect(value("new_replies", date)).toBe(replied - (value("leads_replied", before) as number));
      });
    }
  });

  it("drain Dripify's unsent leads and top them up, so the pool never sits empty", () => {
    const remaining = seriesOf(run(["dripify.leads_remaining"], { grain: "week", from: addDays(TODAY, -90) }), "dripify.leads_remaining").values;
    expect(remaining.every((value) => value !== null && value > 40)).toBe(true);
    const refills = remaining.filter((value, index) => index > 0 && (value as number) > (remaining[index - 1] as number) + 200).length;
    expect(refills).toBeGreaterThanOrEqual(2);
    // The newest campaign still runs low today, which is what Connections warns about.
    expect(sampleMetricRows("dripify.leads_remaining", TODAY).find((row) => row.dimension === "dripify:303" && row.date === TODAY)?.value).toBeLessThan(40);
  });

  it("let followers dip while they grow: some days lose followers, and a posting break gives a down week and a down month", () => {
    for (const key of ["linkedin.followers", "instagram.followers", "youtube.subscribers", "reddit.karma"]) {
      const daily = [...totalsByDate(sampleMetricRows(key, TODAY)).entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
      const changes = daily.slice(1).map((value, index) => value - daily[index]);
      const lossShare = changes.filter((change) => change < 0).length / changes.length;
      expect(lossShare, key).toBeGreaterThanOrEqual(key === "reddit.karma" ? 0.05 : 0.15);
      expect(lossShare, key).toBeLessThanOrEqual(0.32);
      expect(daily.at(-1), key).toBeGreaterThan(daily[0]);
      for (const [grain, from] of [["week", addDays(TODAY, -90)], ["month", "2026-05-01"]] as const) {
        const values = seriesOf(run([key], { grain, from, to: grain === "month" ? "2026-09-30" : TODAY }), key).values.filter((value): value is number => value !== null);
        expect(values.slice(1).some((value, index) => value < values[index]), `${key} ${grain}`).toBe(true);
        expect(values.slice(1).some((value, index) => value > values[index]), `${key} ${grain}`).toBe(true);
      }
    }
  });

  it("move money and clients both ways: an upgrade, new clients and clients leaving", () => {
    for (const key of ["revenue.mrr", "revenue.active_clients"]) {
      const values = sampleMetricRows(key, TODAY).map((row) => row.value);
      // Every three-month window of the history, and the last 30 days, has a rise and a fall.
      for (let start = 0; start + 64 <= values.length; start += 5) {
        const window = values.slice(start, start + 64);
        expect(window.slice(1).some((value, index) => value > window[index]), `${key} rise from row ${start}`).toBe(true);
        if (key === "revenue.mrr") expect(window.slice(1).some((value, index) => value < window[index]), `${key} fall from row ${start}`).toBe(true);
      }
      const recent = sampleMetricRows(key, TODAY).filter((row) => row.date >= addDays(TODAY, -30)).map((row) => row.value);
      expect(recent.slice(1).some((value, index) => value > recent[index]), key).toBe(true);
      expect(recent.slice(1).some((value, index) => value < recent[index]), key).toBe(true);
    }
    // Still about $1,550 a month against the $2,000 goal, from a handful of clients, never above the goal.
    const mrr = sampleMetricRows("revenue.mrr", TODAY);
    expect(mrr.at(-1)?.value).toBe(155_000);
    expect(Math.max(...mrr.map((row) => row.value))).toBeLessThan(200_000);
    expect(sampleMetricRows("revenue.active_clients", TODAY).at(-1)?.value).toBe(4);
  });

  it("start, pause and end Dripify campaigns, and add lead lists every few weeks", () => {
    const recent = (key: string) => seriesOf(run([key], { grain: "day", from: addDays(TODAY, -29) }), key).values as number[];
    const active = recent("dripify.active_campaigns");
    expect(active.slice(1).some((value, index) => value > active[index])).toBe(true);
    expect(active.slice(1).some((value, index) => value < active[index])).toBe(true);
    const monthly = seriesOf(run(["dripify.active_campaigns"], { grain: "month", from: "2026-05-01", to: "2026-09-30" }), "dripify.active_campaigns").values as number[];
    expect(new Set(monthly).size).toBeGreaterThanOrEqual(2);
    expect(monthly.slice(1).some((value, index) => value < monthly[index])).toBe(true);
    // At least one new list in any 30 days, and every campaign that is topped up gets a list within three and a half weeks of the last.
    const total = recent("dripify.leads_total");
    expect(total.slice(1).some((value, index) => value > total[index])).toBe(true);
    const loads = sampleMetricRows("dripify.leads_total", TODAY).filter((row) => row.dimension === "dripify:202");
    const loadDays = loads.filter((row, index) => index && row.value > loads[index - 1].value).map((row) => row.date);
    loadDays.slice(1).forEach((day, index) => expect(dayCount(loadDays[index], day), day).toBeLessThanOrEqual(26));
  });

  it("keep Dripify's lifetime rates in plausible bands, drifting as lists answer better or worse", () => {
    const result = run(["dripify.reply_rate", "dripify.acceptance_rate"], { grain: "day", from: sampleHistoryStart(TODAY) });
    for (const [key, low, high] of [["dripify.reply_rate", 0.04, 0.08], ["dripify.acceptance_rate", 0.25, 0.4]] as const) {
      const values = seriesOf(result, key).values.filter((value): value is number => value !== null);
      values.forEach((value) => {
        expect(value, key).toBeGreaterThanOrEqual(low);
        expect(value, key).toBeLessThanOrEqual(high);
      });
      const lastMonth = values.slice(-30);
      expect((Math.max(...lastMonth) - Math.min(...lastMonth)) / Math.max(...lastMonth), key).toBeGreaterThanOrEqual(0.03);
      const weekly = seriesOf(run([key], { grain: "week", from: addDays(TODAY, -90) }), key).values as number[];
      expect(weekly.slice(1).some((value, index) => value < weekly[index]), key).toBe(true);
      expect(weekly.slice(1).some((value, index) => value > weekly[index]), key).toBe(true);
    }
  });

  it("vary daily counts: no bar chart of the last 30 days is mostly the same height", () => {
    const keys = ["dripify.new_replies", "youtube.subscribers_gained", "youtube.shares", "youtube.comments", "instagram.saves", "reddit.upvotes", "reddit.comments", "reddit.dm_replies"];
    for (const key of keys) {
      const counts = new Map<number, number>();
      const values = [...totalsByDate(sampleMetricRows(key, TODAY)).entries()].filter(([date]) => date >= addDays(TODAY, -30) && date < TODAY).map(([, value]) => value).filter((value) => value > 0);
      values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      expect(values.length, key).toBeGreaterThanOrEqual(8);
      expect(Math.max(...counts.values()) / values.length, key).toBeLessThanOrEqual(0.55);
    }
    // A call booked from Reddit now and then.
    expect(expectedSum(sampleMetricRows("reddit.dm_calls_booked", TODAY), addDays(TODAY, -30), TODAY)).toBeGreaterThanOrEqual(1);
  });

  it("keep close rate plausible: signing days have calls held, and no week closes more than two in five", () => {
    const close = seriesOf(run(["sales.close_rate"], { grain: "week", from: addDays(TODAY, -175) }), "sales.close_rate");
    const rates = close.values.filter((value): value is number => value !== null);
    expect(rates.some((value) => value > 0)).toBe(true);
    rates.forEach((value) => expect(value).toBeLessThanOrEqual(0.4));
    const held = new Map(sampleMetricRows("sales.calls_held", TODAY).map((row) => [row.date, row.value]));
    sampleMetricRows("sales.deals_won", TODAY).filter((row) => row.value > 0).forEach((row) => expect(held.get(row.date), row.date).toBeGreaterThanOrEqual(3 * row.value));
  });
});

describe("sample metric series", () => {
  it("truncates the range to the grain and aligns weeks to ISO Mondays", () => {
    // 2026-07-01 is a Wednesday; its ISO week starts Monday 2026-06-29.
    const result = run(["linkedin.impressions"]);
    expect(result.from).toBe("2026-06-29");
    expect(result.to).toBe(TODAY);
    expect(result.buckets[0].start).toBe("2026-06-29");
    result.buckets.forEach((bucket, index) => {
      expect(parseDay(bucket.start).getUTCDay(), bucket.start).toBe(1);
      if (index) expect(dayCount(result.buckets[index - 1].start, bucket.start)).toBe(8);
      if (index < result.buckets.length - 1) {
        expect(bucket.end).toBe(addDays(bucket.start, 6));
        expect(bucket.partial, bucket.start).toBe(false);
      }
    });
    // The week containing today is in progress and cut at the range end.
    expect(result.buckets.at(-1)).toEqual({ start: "2026-10-12", end: TODAY, partial: true });
  });

  it("marks a bucket partial when the range end cuts it, and not when it is complete", () => {
    const complete = run(["linkedin.impressions"], { to: "2026-10-11" });
    expect(complete.buckets.at(-1)).toEqual({ start: "2026-10-05", end: "2026-10-11", partial: false });
    expect(complete.buckets.some((bucket) => bucket.partial)).toBe(false);
    const cut = run(["linkedin.impressions"], { to: "2026-10-07" });
    expect(cut.buckets.at(-1)).toEqual({ start: "2026-10-05", end: "2026-10-07", partial: true });
  });

  it("aligns days, months, quarters and years", () => {
    const days = run(["outreach.touches"], { grain: "day", from: "2026-09-17" });
    expect(days.buckets).toHaveLength(30);
    expect(days.buckets.filter((bucket) => bucket.partial).map((bucket) => bucket.start)).toEqual([TODAY]);
    const months = run(["outreach.touches"], { grain: "month", from: "2026-05-20" });
    expect(months.buckets.map((bucket) => [bucket.start, bucket.end, bucket.partial])).toEqual([
      ["2026-05-01", "2026-05-31", false], ["2026-06-01", "2026-06-30", false], ["2026-07-01", "2026-07-31", false],
      ["2026-08-01", "2026-08-31", false], ["2026-09-01", "2026-09-30", false], ["2026-10-01", TODAY, true],
    ]);
    const quarters = run(["outreach.touches"], { grain: "quarter", from: "2026-02-10" });
    expect(quarters.buckets.map((bucket) => [bucket.start, bucket.end])).toEqual([
      ["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"], ["2026-07-01", "2026-09-30"], ["2026-10-01", TODAY],
    ]);
    const years = run(["outreach.touches"], { grain: "year", from: "2025-06-01" });
    expect(years.buckets).toEqual([{ start: "2025-01-01", end: "2025-12-31", partial: false }, { start: "2026-01-01", end: TODAY, partial: true }]);
  });

  it("compares with the equal-length window ending the day before the range", () => {
    for (const [grain, from] of [["day", "2026-09-17"], ["week", "2026-07-01"], ["month", "2026-01-15"], ["quarter", "2025-11-03"]] as const) {
      const result = run(["outreach.touches"], { grain, from });
      expect(result.previousTo).toBe(addDays(result.from, -1));
      expect(dayCount(result.previousFrom, result.previousTo)).toBe(dayCount(result.from, result.to));
    }
  });

  it("adds daily values for flows, per bucket, across the range and across the previous window", () => {
    const keys = ["linkedin.impressions", "youtube.watch_hours", "outreach.touches", "revenue.cash_collected"];
    for (const grain of ["day", "week", "month"] as const) {
      const result = run(keys, { grain, from: grain === "day" ? "2026-09-01" : "2026-07-01" });
      for (const key of keys) {
        const rows = sampleMetricRows(key, TODAY);
        const zeroFilled = key.startsWith("outreach.");
        const own = seriesOf(result, key);
        expectClose(own.values, result.buckets.map((bucket) => expectedSum(rows, bucket.start, bucket.end) ?? (zeroFilled ? 0 : null)));
        expectClose([own.current, own.previous], [expectedSum(rows, result.from, result.to), expectedSum(rows, result.previousFrom, result.previousTo)]);
        expect(own.numerators).toBeNull();
        expect(own.currentNumerator).toBeNull();
      }
    }
  });

  it("carries each account's latest value forward for stocks and adds accounts together", () => {
    for (const key of ["linkedin.followers", "revenue.mrr", "dripify.leads_contacted"]) {
      const rows = sampleMetricRows(key, TODAY);
      const result = run([key], { grain: "week", from: "2026-03-02" });
      const own = seriesOf(result, key);
      expect(own.values).toEqual(result.buckets.map((bucket) => expectedLatest(rows, bucket.end)));
      expect(own.current).toBe(expectedLatest(rows, result.to));
      expect(own.previous).toBe(expectedLatest(rows, result.previousTo));
      // Weeks before anything was recorded are unknown, not zero.
      expect(own.values[0]).toBeNull();
      expect(own.values.at(-1)).toBeGreaterThan(0);
    }
    // MRR is logged on workdays: Saturday still shows Friday's value, while
    // cash collected (a flow) is simply not recorded that day.
    const weekend = run(["revenue.mrr", "revenue.cash_collected"], { grain: "day", from: "2026-10-10", to: "2026-10-10" });
    expect(seriesOf(weekend, "revenue.mrr").values[0]).toBe(sampleMetricRows("revenue.mrr", TODAY).find((row) => row.date === "2026-10-09")?.value);
    expect(seriesOf(weekend, "revenue.cash_collected").values[0]).toBeNull();
  });

  it("computes ratios from their numerator and denominator, each aggregated by its own rule", () => {
    const pairs = [
      ["outreach.reply_rate", "outreach.replies", "outreach.reply_base"],
      ["dripify.reply_rate", "dripify.leads_replied", "dripify.leads_contacted"],
      ["sales.close_rate", "sales.deals_won", "sales.calls_held"],
      ["ajani.brief_to_build_rate", "ajani.cohort_submitted", "ajani.drafts_saved"],
    ] as const;
    for (const grain of ["day", "week", "month"] as const) {
      const result = run(pairs.flat(), { grain, from: grain === "day" ? "2026-09-01" : "2026-06-01" });
      for (const [key, numeratorKey, denominatorKey] of pairs) {
        const rate = seriesOf(result, key);
        const numerator = seriesOf(result, numeratorKey);
        const denominator = seriesOf(result, denominatorKey);
        expect(rate.numerators).toEqual(numerator.values);
        expect(rate.denominators).toEqual(denominator.values);
        expect(rate.values).toEqual(numerator.values.map((value, index) => ratio(value, denominator.values[index])));
        expect([rate.currentNumerator, rate.currentDenominator, rate.previousNumerator, rate.previousDenominator])
          .toEqual([numerator.current, denominator.current, numerator.previous, denominator.previous]);
        expect(rate.current).toBe(ratio(numerator.current, denominator.current));
        expect(rate.previous).toBe(ratio(numerator.previous, denominator.previous));
        expect(rate.values.some((value) => value !== null && value > 0), `${key} ${grain}`).toBe(true);
      }
    }
    // Lifetime Dripify rate: replies over contacts, carried forward per campaign.
    const lifetime = seriesOf(run(["dripify.reply_rate"]), "dripify.reply_rate");
    const replied = sampleMetricRows("dripify.leads_replied", TODAY);
    const contacted = sampleMetricRows("dripify.leads_contacted", TODAY);
    expect(lifetime.current).toBe(ratio(expectedLatest(replied, TODAY), expectedLatest(contacted, TODAY)));
  });

  it("leaves a ratio null when its denominator is zero or unknown", () => {
    // Dripify sends on workdays, so weekend syncs contact nobody new.
    const period = run(["dripify.period_reply_rate"], { grain: "day", from: "2026-09-01" });
    const rate = seriesOf(period, "dripify.period_reply_rate");
    const zeroDays = (rate.denominators ?? []).flatMap((value, index) => value === 0 ? [index] : []);
    expect(zeroDays.length).toBeGreaterThan(4);
    zeroDays.forEach((index) => expect(rate.values[index]).toBeNull());
    // Sales are logged on workdays: a weekend has no calls held recorded at all.
    const close = seriesOf(run(["sales.close_rate"], { grain: "day", from: "2026-09-01" }), "sales.close_rate");
    const unknownDays = (close.denominators ?? []).flatMap((value, index) => value === null ? [index] : []);
    expect(unknownDays.length).toBeGreaterThan(4);
    unknownDays.forEach((index) => expect(close.values[index]).toBeNull());
    (close.denominators ?? []).forEach((value, index) => { if (value === 0) expect(close.values[index]).toBeNull(); });
  });

  it("filters to one account, and leaves metrics without that account unknown", () => {
    const rows = sampleMetricRows("linkedin.followers", TODAY);
    const personal = run(["linkedin.followers"], { dimension: " @AJANI " });
    expect(personal.dimension).toBe("@ajani");
    const own = seriesOf(personal, "linkedin.followers");
    const personalRows = rows.filter((row) => row.dimension === "@ajani");
    expect(own.values).toEqual(personal.buckets.map((bucket) => expectedLatest(personalRows, bucket.end)));
    const page = seriesOf(run(["linkedin.followers"], { dimension: "ajani-automation" }), "linkedin.followers");
    const both = seriesOf(run(["linkedin.followers"]), "linkedin.followers");
    expect((own.current as number) + (page.current as number)).toBe(both.current);

    // Outreach has channels, so quiet days on the chosen channel are true zeros.
    const channel = run(["outreach.touches"], { grain: "day", from: "2026-09-01", dimension: "instagram/manual" });
    const channelRows = sampleMetricRows("outreach.touches", TODAY).filter((row) => row.dimension === "instagram/manual");
    expect(seriesOf(channel, "outreach.touches").values).toEqual(channel.buckets.map((bucket) => expectedSum(channelRows, bucket.start, bucket.end) ?? 0));

    // Website numbers have no accounts: a filter makes them unknown, never zero.
    const website = seriesOf(run(["ajani.drafts_saved"], { dimension: "@ajani" }), "ajani.drafts_saved");
    expect(website.values.every((value) => value === null)).toBe(true);
    expect([website.current, website.previous]).toEqual([null, null]);
    const missing = seriesOf(run(["youtube.views"], { dimension: "@someone-else" }), "youtube.views");
    expect(missing.values.every((value) => value === null)).toBe(true);
  });

  it("keeps cohort numbers unknown before tracking began, and other history unknown before it was recorded", () => {
    const coverage = sampleHistoryStart(TODAY);
    const result = run(["ajani.drafts_saved", "ajani.brief_to_build_rate", "youtube.views"], { grain: "month", from: "2025-11-01" });
    const drafts = seriesOf(result, "ajani.drafts_saved");
    expect(drafts.coverageFrom).toBe(coverage);
    expect(seriesOf(result, "ajani.brief_to_build_rate").coverageFrom).toBe(coverage);
    expect(seriesOf(result, "youtube.views").coverageFrom).toBeNull();
    result.buckets.forEach((bucket, index) => {
      if (bucket.end < coverage) {
        expect(drafts.values[index], bucket.start).toBeNull();
        expect(seriesOf(result, "youtube.views").values[index], bucket.start).toBeNull();
      } else {
        expect(drafts.values[index], bucket.start).not.toBeNull();
      }
    });
    // A comparison window reaching before tracking began would be biased.
    expect(drafts.previous).toBeNull();
    // Live-derived flows after tracking began are zero on quiet days, never unknown.
    const quiet = seriesOf(run(["ajani.builds_submitted"], { grain: "day", from: "2026-09-01" }), "ajani.builds_submitted");
    expect(quiet.values.every((value) => value !== null)).toBe(true);
    expect(quiet.values.some((value) => value === 0)).toBe(true);
  });

  it("orders series by key, skips unknown metrics and refuses impossible ranges", () => {
    const result = run(["youtube.views", "linkedin.followers", "nope.metric", "youtube.views"]);
    expect(result.series.map((item) => item.metricKey)).toEqual(["linkedin.followers", "youtube.views"]);
    expect(() => run(["youtube.views"], { from: "2026-10-10", to: "2026-10-01" })).toThrow("Invalid date range");
    expect(() => run(["youtube.views"], { to: "2026-10-20" })).toThrow("Invalid date range");
    expect(() => run(["youtube.views"], { grain: "day", from: "2023-01-01" })).toThrow("Too many periods");
  });

  it("uses the definitions it is given, including metrics added after this file was written", () => {
    const extra: MetricDefinition = {
      key: "newsource.signups", source: "newsource", category: "business", label: "Signups", description: "New signups.",
      unit: "count", aggregation: "sum", numeratorKey: null, denominatorKey: null, entryMode: "manual",
      higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions: [],
    };
    const stock: MetricDefinition = { ...extra, key: "linkedin.newsletter_subscribers", source: "linkedin", unit: "count", aggregation: "last", label: "Newsletter subscribers" };
    const result = run(["newsource.signups", "linkedin.newsletter_subscribers"], {}, [...SAMPLE_DEFINITIONS, extra, stock]);
    for (const key of ["newsource.signups", "linkedin.newsletter_subscribers"]) {
      const own = seriesOf(result, key);
      expect(own.values.filter((value) => value !== null).length, key).toBeGreaterThan(5);
      expect(own.current, key).not.toBeNull();
    }
  });
});

describe("sample metric catalog", () => {
  it("dates, accounts and labels every metric the way the real catalog does", () => {
    const catalog = sampleMetricCatalog(SAMPLE_DEFINITIONS, TODAY);
    expect(catalog).toMatchObject({ status: "available", today: TODAY, connectors: { dripify: true } });
    expect(catalog.metrics.map((item) => item.key)).toEqual(SAMPLE_DEFINITIONS.map((item) => item.key));
    const byKey = new Map(catalog.metrics.map((item) => [item.key, item]));
    const start = sampleHistoryStart(TODAY);
    expect(byKey.get("linkedin.followers")).toMatchObject({ firstDate: start, lastDate: YESTERDAY, dimensions: ["@ajani", "ajani-automation"] });
    expect(byKey.get("dripify.leads_contacted")).toMatchObject({ firstDate: start, lastDate: TODAY, dimensions: ["dripify:101", "dripify:202", "dripify:303"] });
    // A ratio shows its numerator's stored history; live-derived metrics have none.
    expect(byKey.get("dripify.reply_rate")).toMatchObject({ firstDate: start, lastDate: TODAY, dimensions: ["dripify:101", "dripify:202", "dripify:303"] });
    expect(byKey.get("sales.close_rate")).toMatchObject({ firstDate: expect.any(String), lastDate: YESTERDAY, dimensions: [] });
    expect(byKey.get("outreach.reply_rate")).toMatchObject({ firstDate: null, lastDate: null, dimensions: ["instagram/manual", "linkedin/dripify", "linkedin/manual", "phone/cold_call", "reddit/dm"] });
    expect(byKey.get("ajani.drafts_saved")).toMatchObject({ firstDate: null, lastDate: null, dimensions: [] });
    for (const item of catalog.metrics) {
      if (item.entryMode === "manual" || item.entryMode === "connector") expect(item.lastDate === TODAY || item.lastDate === YESTERDAY, item.key).toBe(true);
      item.dimensions.filter((key) => key.startsWith("dripify")).forEach((key) => expect(catalog.dimensionLabels[key], key).toBeTruthy());
    }
    expect(catalog.dimensionLabels["dripify:101"]).toBe("Insurance owners TX");
  });

  it("lists a dozen plausible manual entries, newest first", () => {
    const catalog = sampleMetricCatalog(SAMPLE_DEFINITIONS, TODAY);
    expect(catalog.recentEntries).toHaveLength(12);
    const manual = new Set(SAMPLE_DEFINITIONS.filter((item) => item.entryMode === "manual").map((item) => item.key));
    catalog.recentEntries.forEach((entry, index) => {
      expect(manual.has(entry.metricKey), entry.metricKey).toBe(true);
      expect(entry.date <= YESTERDAY).toBe(true);
      expect(entry.value).toBeGreaterThan(0);
      expect(sampleMetricRows(entry.metricKey, TODAY).some((row) => row.date === entry.date && row.dimension === entry.dimension && row.value === entry.value)).toBe(true);
      expect(entry.recordedAt.slice(0, 10)).toBe(entry.date);
      if (index) expect(entry.recordedAt < catalog.recentEntries[index - 1].recordedAt).toBe(true);
    });
  });

  it("keeps the real definitions it is given and falls back to the built-in ones", () => {
    const relabelled = SAMPLE_DEFINITIONS.map((item) => item.key === "sales.deals_won" ? { ...item, label: "Deals closed", firstDate: "2020-01-01", dimensions: ["real"] } : item);
    const catalog = sampleMetricCatalog(relabelled, TODAY);
    // Sales are logged on workdays, so the fake history starts on the first workday.
    const firstLogged = sampleMetricRows("sales.deals_won", TODAY)[0].date;
    expect(firstLogged >= sampleHistoryStart(TODAY)).toBe(true);
    expect(catalog.metrics.find((item) => item.key === "sales.deals_won")).toMatchObject({ label: "Deals closed", firstDate: firstLogged, lastDate: YESTERDAY, dimensions: [] });
    expect(sampleMetricCatalog([], TODAY).metrics.map((item) => item.key)).toEqual(SAMPLE_DEFINITIONS.map((item) => item.key));
  });
});

describe("sample growth goals", () => {
  it("are the five goals seeded by the growth goals migration", () => {
    const sql = readFileSync(path.join(migrations, "20261016030000_growth_goals.sql"), "utf8").replaceAll("\r\n", "\n");
    const seeded = [...sql.matchAll(/\('([a-z_]+)', '([a-z_.]+)', '((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'(total|latest|weekly)', (\d+), date '([\d-]+)', (null|date '[\d-]+'), \d+\)/g)]
      .map(([, key, metricKey, label, description, measure, target, startDate, dueDate]) => ({
        key, metricKey, label, description: description.replaceAll("''", "'"), measure, target: Number(target), startDate,
        dueDate: dueDate === "null" ? null : dueDate.slice(6, -1),
      }));
    expect(seeded).toHaveLength(5);
    expect(SAMPLE_GOALS).toEqual(seeded);
  });

  it("are measured from the same sample series as Trends, with some on pace and some behind", () => {
    const board = sampleGoalBoard(TODAY);
    expect(board).toMatchObject({ status: "available", today: TODAY, weekStart: "2026-10-12" });
    expect(board.goals.map((goal) => goal.key)).toEqual(SAMPLE_GOALS.map((goal) => goal.key));
    expect(finiteNumbers(board)).toEqual([]);
    const goal = (key: string) => board.goals.find((item) => item.key === key)!;

    expect(goal("clients_signed").current).toBe(expectedSum(sampleMetricRows("sales.deals_won", TODAY), "2026-07-12", TODAY));
    expect(goal("revenue_collected").current).toBe(expectedSum(sampleMetricRows("revenue.cash_collected", TODAY), "2026-07-12", TODAY));
    const followers = sampleMetricRows("linkedin.followers", TODAY);
    expect(goal("linkedin_followers")).toMatchObject({ current: expectedLatest(followers, TODAY), baseline: expectedLatest(followers, "2026-07-11"), lastRecorded: YESTERDAY, unit: "count", entryMode: "manual" });
    expect(goal("monthly_recurring_revenue")).toMatchObject({ unit: "currency_cents", baseline: expectedLatest(sampleMetricRows("revenue.mrr", TODAY), "2026-07-11") });
    const posts = sampleMetricRows("linkedin.posts_published", TODAY);
    expect(goal("linkedin_posts_weekly")).toMatchObject({ current: expectedSum(posts, "2026-10-12", TODAY), lastWeek: expectedSum(posts, "2026-10-05", "2026-10-11"), dueDate: null });

    const statuses = board.goals.map((item) => goalProgress(item, board.today, board.weekStart).status);
    expect(statuses).toContain("on_pace");
    expect(statuses).toContain("behind");
  });
});

describe("sample dashboard", () => {
  const now = new Date(`${TODAY}T15:30:00.000Z`);
  const data = sampleDashboardData({ experimentPage: 0, batchPage: 0 }, now);

  it("fills every section the dashboard shows", () => {
    expect(data).toMatchObject({ generatedAt: now.toISOString(), dataConnected: true, dataStatus: "available", dataNotice: null, outreachSchemaReady: true });
    expect(finiteNumbers(data)).toEqual([]);
    expect(data.metrics.map((item) => [item.label, item.tone])).toEqual([["Saved drafts", "neutral"], ["Submitted builds", "brand"], ["Outreach touches", "brand"], ["Replies", "success"]]);
    data.metrics.forEach((item) => expect(item.value).toMatch(/^\d[\d,]*$/));
    expect(data.metrics[0].detail).toMatch(/^\d+ new business accounts in the last 30 days, by UTC date$/);
    expect(data.metrics[1].detail).toMatch(/^\d+\.\d% of drafts saved in the last 30 days became builds$/);
    expect(data.metrics[3].detail).toMatch(/^\d+\.\d% reply rate$/);

    expect(data.trend).toHaveLength(90);
    data.trend.forEach((point, index) => expect(point.date).toBe(addDays(TODAY, index - 89)));
    expect(data.trend.some((point) => point.outreach > 0 && point.drafts > 0)).toBe(true);

    expect(data.funnel.map((stage) => stage.label)).toEqual(["Brief saved", "AI processed", "Scope approved", "Account claimed", "Build submitted"]);
    data.funnel.forEach((stage, index) => {
      expect(stage.value).toBeGreaterThan(0);
      if (index) expect(stage.value).toBeLessThanOrEqual(data.funnel[index - 1].value);
      expect(stage.rate).toBeCloseTo((stage.value / data.funnel[0].value) * 100, 6);
    });

    const outreach = data.outreach;
    expect(outreach.connectionsAccepted).toBeLessThanOrEqual(outreach.connectionRequests);
    expect(outreach.acceptanceRate).toBeCloseTo((outreach.connectionsAccepted / outreach.connectionRequests) * 100, 6);
    expect(outreach.replyRate).toBeCloseTo((outreach.replies / outreach.replyBase) * 100, 6);
    expect(outreach.positiveReplies).toBeLessThanOrEqual(outreach.replies);

    expect(data.operations).toHaveLength(4);
    expect(data.contentDemand.length).toBeGreaterThan(0);
    data.contentDemand.forEach((item, index) => { if (index) expect(item.value).toBeLessThanOrEqual(data.contentDemand[index - 1].value); });
    expect(data.recentBatches.length).toBeGreaterThan(0);
    data.recentBatches.forEach((batch) => {
      expect(["Owner", "Setter"]).toContain(batch.teamMember);
      expect(batch.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(batch.replies).toBeLessThanOrEqual(batch.sent);
    });
    expect(data.pagination).toEqual({ experimentPage: 0, batchPage: 0, experimentCount: data.experiments.length, batchCount: data.recentBatches.length });
  });

  it("runs the real experiment math over made-up variant totals", () => {
    expect(data.experiments.length).toBeGreaterThanOrEqual(2);
    expect(data.experiments.length).toBeLessThanOrEqual(3);
    expect(Object.keys(data.experimentPerformance).sort()).toEqual(data.experiments.map((item) => item.id).sort());
    for (const experiment of data.experiments) {
      expect(experiment.variants.length).toBeGreaterThanOrEqual(2);
      expect(data.experimentPerformance[experiment.id].map((item) => item.label)).toEqual(experiment.variants.map((item) => item.label));
    }
    const statuses = Object.values(data.experimentPerformance).flat().map((item) => item.status);
    expect(statuses).toContain("leading");
    expect(statuses).toContain("early signal");
    expect(statuses).toContain("not enough data");
    expect(data.experiments.some((item) => item.status === "active")).toBe(true);
  });

  it("agrees with the Trends numbers for the same days", () => {
    const touches = seriesOf(sampleMetricSeries({ metrics: ["outreach.touches", "ajani.drafts_saved"], grain: "day", from: addDays(TODAY, -29), to: TODAY, dimension: null }, SAMPLE_DEFINITIONS, TODAY), "outreach.touches");
    const lastThirty = data.trend.slice(-30);
    expect(lastThirty.map((point) => point.outreach)).toEqual(touches.values);
    expect(data.metrics[2].value).toBe(new Intl.NumberFormat("en-US").format(touches.current as number));
    expect(Number(data.metrics[0].value.replaceAll(",", ""))).toBe(lastThirty.reduce((sum, point) => sum + point.drafts, 0));
  });
});
