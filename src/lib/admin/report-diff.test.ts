import { describe, expect, it } from "vitest";
import { flagRows, indexSaved, planImport, removalKeys, savedFlags, type PlanMetric, type SavedValue } from "@/lib/admin/report-diff";
import type { MergedReportRow } from "@/lib/admin/report-merge";
import { readDailyTable } from "@/lib/admin/report-table";
import { SAMPLE_DEFINITIONS } from "@/lib/admin/sample-data";
import { SOCIAL_COMBINED_CSV } from "@/lib/admin/testing/social-combined";

const metrics = SAMPLE_DEFINITIONS.filter((metric) => metric.entryMode === "manual" && metric.unit !== "ratio");
const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
const planMetrics: ReadonlyMap<string, PlanMetric> = new Map(metrics.map((metric) => [metric.key, { label: metric.label, unit: metric.unit }]));
const row = (metricKey: string, date: string, value: number, doubt: string | null = null): MergedReportRow => {
  const metric = byKey.get(metricKey)!;
  return { metricKey, label: metric.label, unit: metric.unit, aggregation: metric.aggregation, date, value, evidence: "table", doubt, file: "file.csv" };
};
const saved = (metricKey: string, date: string, value: number, synced = false): SavedValue => ({ metricKey, date, value, synced });
const days = (from: number, count: number) => Array.from({ length: count }, (_, index) => `2026-10-${String(from + index).padStart(2, "0")}`);

describe("re-importing the file that put LinkedIn's followers on Instagram", () => {
  const rows = readDailyTable(SOCIAL_COMBINED_CSV, "social-analytics-combined-2026-09-18_to_2026-10-17.csv", metrics)!.values.map((value) => row(value.metricKey, value.date, value.value));
  const value = (metricKey: string, date: string) => rows.find((item) => item.metricKey === metricKey && item.date === date)?.value;
  // What the faulty import saved on 2026-10-18: LinkedIn's follower counts as Instagram's, Instagram's own
  // columns as they were, and interactions and posts only on the days both platforms happened to agree.
  const live: SavedValue[] = rows.flatMap((item) => {
    if (item.metricKey === "linkedin.followers") return [saved("instagram.followers", item.date, item.value)];
    if (["instagram.interactions", "instagram.posts_published"].includes(item.metricKey)) {
      const linkedin = value(item.metricKey === "instagram.interactions" ? "linkedin.engagements" : "linkedin.posts_published", item.date);
      const own = SOCIAL_COMBINED_CSV.split("\n").find((line) => line.startsWith(`linkedin,UTC,${item.date},`))!.split(",");
      const linkedinValue = item.metricKey === "instagram.interactions" ? Number(own[6]) : linkedin;
      return linkedinValue === item.value ? [saved(item.metricKey, item.date, item.value)] : [];
    }
    return item.metricKey.startsWith("instagram.") && item.metricKey !== "instagram.views" ? [saved(item.metricKey, item.date, item.value)] : [];
  });
  const plan = planImport(rows, live, planMetrics);

  it("offers to remove the 30 wrong Instagram follower counts, and nothing else", () => {
    expect(live.filter((item) => item.metricKey === "instagram.followers")).toHaveLength(30);
    expect(plan.removals).toHaveLength(1);
    expect(plan.removals[0]).toMatchObject({ metricKey: "instagram.followers", label: "Instagram followers", copies: { metricKey: "linkedin.followers", label: "LinkedIn followers" } });
    expect(plan.removals[0].rows).toHaveLength(30);
    expect(plan.removals[0].rows[0]).toEqual({ date: "2026-09-18", value: 2362 });
    expect(plan.removals[0].rows.at(-1)).toEqual({ date: "2026-10-17", value: 2533 });
  });

  it("fills the days the faulty import dropped, confirms the ones it got right by luck, and flags nothing", () => {
    const count = (change: string, metricKey?: string) => plan.rows.filter((item) => item.change === change && (!metricKey || item.metricKey === metricKey)).length;
    expect(count("new", "instagram.views")).toBe(30);
    expect(count("same", "instagram.interactions") + count("new", "instagram.interactions")).toBe(30);
    expect(count("same", "instagram.interactions")).toBeGreaterThan(0);
    expect(count("new", "linkedin.followers")).toBe(30);
    expect(count("same", "instagram.reach")).toBe(30);
    expect(count("replaces")).toBe(0);
    expect(plan.rows.filter((item) => item.flags.length)).toEqual([]);
  });
});

describe("removal proposals", () => {
  const linkedin = (values: number[], from = 8) => values.map((followers, index) => row("linkedin.followers", days(from, values.length)[index], followers));
  const instagramRows = (count: number, from = 8) => days(from, count).map((date) => row("instagram.reach", date, 100));

  it("never come from a blank cell alone, a match on fewer than three days, or small numbers", () => {
    expect(planImport([...instagramRows(3), ...linkedin([2400, 2401, 2402])], [saved("instagram.followers", "2026-10-08", 73)], planMetrics).removals).toEqual([]);
    expect(planImport([...instagramRows(3), ...linkedin([2400, 2401, 2402])], [saved("instagram.followers", "2026-10-08", 2400), saved("instagram.followers", "2026-10-09", 2401)], planMetrics).removals).toEqual([]);
    expect(planImport([...instagramRows(3), ...linkedin([4, 5, 6])], [4, 5, 6].map((count, index) => saved("instagram.followers", days(8, 3)[index], count)), planMetrics).removals).toEqual([]);
  });

  it("never touch synced numbers, days the import gives itself, or platforms the import doesn't cover that day", () => {
    const copies = [2400, 2401, 2402].map((count, index) => saved("instagram.followers", days(8, 3)[index], count));
    expect(planImport([...instagramRows(3), ...linkedin([2400, 2401, 2402])], copies.map((item) => ({ ...item, synced: true })), planMetrics).removals).toEqual([]);
    expect(planImport([...linkedin([2400, 2401, 2402])], copies, planMetrics).removals).toEqual([]);
    const given = [...instagramRows(3), ...linkedin([2400, 2401, 2402]), row("instagram.followers", "2026-10-08", 70), row("instagram.followers", "2026-10-09", 71), row("instagram.followers", "2026-10-10", 72)];
    const plan = planImport(given, copies, planMetrics);
    expect(plan.removals).toEqual([]);
    expect(plan.rows.filter((item) => item.metricKey === "instagram.followers").map((item) => [item.change, item.previous?.value])).toEqual([["replaces", 2400], ["replaces", 2401], ["replaces", 2402]]);
  });
});

describe("flags that make a row start unticked", () => {
  it("catch a running total far from the saved one nearby, unless that saved number is being removed", () => {
    const rows = [row("instagram.followers", "2026-10-17", 2533)];
    const near = [saved("instagram.followers", "2026-10-16", 73)];
    expect(flagRows(rows, near, new Set())[0].flags).toEqual(["35 times the 73 saved for Oct 16."]);
    expect(flagRows(rows, near, removalKeys([{ metricKey: "instagram.followers", rows: [{ date: "2026-10-16", value: 73 }] }]))[0].flags).toEqual([]);
    expect(flagRows([row("instagram.followers", "2026-10-17", 73)], [saved("instagram.followers", "2026-10-16", 2533)], new Set())[0].flags).toEqual(["Far below the 2,533 saved for Oct 16."]);
    expect(flagRows([row("instagram.followers", "2026-10-17", 80)], near, new Set())[0].flags).toEqual([]);
    // Saved more than 35 days away is too far to compare.
    expect(flagRows(rows, [saved("instagram.followers", "2026-09-01", 73)], new Set())[0].flags).toEqual([]);
  });

  it("catch a replacement very different from the saved number, but not a small correction", () => {
    expect(flagRows([row("instagram.views", "2026-10-08", 2219)], [saved("instagram.views", "2026-10-08", 20)], new Set())[0]).toMatchObject({
      change: "replaces", previous: { value: 20, synced: false }, flags: ["Very different from the 20 saved for this day."],
    });
    expect(flagRows([row("instagram.views", "2026-10-08", 30)], [saved("instagram.views", "2026-10-08", 20)], new Set())[0].flags).toEqual([]);
  });

  it("catch the same number on two platforms day after day, and keep the agent's doubts", () => {
    const flagged = flagRows([
      ...days(8, 3).map((date, index) => row("instagram.followers", date, 2400 + index)),
      ...days(8, 3).map((date, index) => row("linkedin.followers", date, 2400 + index)),
      row("instagram.reach", "2026-10-08", 50, "The AI agent had to interpret a heading or label for this number."),
    ], [], new Set());
    expect(flagged[0].flags).toEqual(["Same number as LinkedIn followers that day, and on 2 other days. One may be the other's numbers."]);
    expect(flagged[3].flags).toEqual(["Same number as Instagram followers that day, and on 2 other days. One may be the other's numbers."]);
    expect(flagged[6].flags).toEqual(["The AI agent had to interpret a heading or label for this number."]);
  });

  it("are the same on the server, which only knows the saved numbers", () => {
    const index = indexSaved([saved("instagram.followers", "2026-10-16", 73), saved("instagram.followers", "2026-10-10", 70)]);
    expect(savedFlags({ metricKey: "instagram.followers", date: "2026-10-17", value: 2533, unit: "count", aggregation: "last" }, index)).toEqual(["35 times the 73 saved for Oct 16."]);
    expect(savedFlags({ metricKey: "instagram.followers", date: "2026-10-17", value: 74, unit: "count", aggregation: "last" }, index)).toEqual([]);
  });
});
