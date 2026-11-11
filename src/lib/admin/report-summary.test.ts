import { describe, expect, it } from "vitest";
import { readDailyTable } from "@/lib/admin/report-table";
import { conclusionFacts, digestRows, renderNote, type SummaryRow } from "@/lib/admin/report-summary";
import { SAMPLE_DEFINITIONS } from "@/lib/admin/sample-data";
import { SOCIAL_COMBINED_CSV } from "@/lib/admin/testing/social-combined";

const metrics = SAMPLE_DEFINITIONS.filter((metric) => metric.entryMode === "manual" && metric.unit !== "ratio");
const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
const rowsOf = (text: string, fileName: string): SummaryRow[] => readDailyTable(text, fileName, metrics)!.values.map((value) => {
  const metric = byKey.get(value.metricKey)!;
  return { metricKey: value.metricKey, label: metric.label, unit: metric.unit, aggregation: metric.aggregation, date: value.date, value: value.value };
});

describe("the breakdown of an import", () => {
  const digests = digestRows(rowsOf(SOCIAL_COMBINED_CSV, "social-analytics-combined-2026-09-18_to_2026-10-17.csv"));

  it("works out each platform's numbers, running totals first", () => {
    expect(digests.map((digest) => [digest.label, digest.from, digest.to])).toEqual([["Instagram", "2026-09-18", "2026-10-17"], ["LinkedIn", "2026-09-18", "2026-10-17"]]);
    const [instagram, linkedin] = digests;
    expect(instagram.metrics.slice(0, 3).map((item) => [item.name, item.total])).toEqual([["views", 9329], ["reach", 5622], ["interactions", 541]]);
    expect(instagram.metrics.find((item) => item.metricKey === "instagram.views")).toMatchObject({
      days: 30, total: 9329, best: { date: "2026-10-09", value: 2907 },
      halves: { first: { from: "2026-09-18", to: "2026-10-02", total: 2086 }, second: { from: "2026-10-03", to: "2026-10-17", total: 7243 } },
    });
    expect(linkedin.metrics[0]).toMatchObject({ metricKey: "linkedin.followers", start: { date: "2026-09-18", value: 2362 }, end: { date: "2026-10-17", value: 2533 }, total: null });
  });

  it("comes to a conclusion in plain sentences, with every number worked out by code", () => {
    expect(digests[0].sentences).toEqual([
      "9,329 views, 5,622 accounts reached and 541 interactions in total.",
      "Views rose from 2,086 (Sep 18 – Oct 2) to 7,243 (Oct 3 – Oct 17), 3.5×.",
      "Best day for views: Oct 9 (2,907).",
      "13 posts published.",
    ]);
    expect(digests[1].sentences).toEqual(["Followers went from 2,362 to 2,533 (+171, +7.2%).", "7 posts published."]);
  });

  it("describes cold calls, money and a single day in their own words", () => {
    const calls = digestRows([
      { metricKey: "cold_calls.dials", label: "Cold calls made", unit: "count", aggregation: "sum", date: "2026-10-14", value: 42 },
      { metricKey: "cold_calls.dials", label: "Cold calls made", unit: "count", aggregation: "sum", date: "2026-10-15", value: 38 },
      { metricKey: "revenue.cash_collected", label: "Cash collected", unit: "currency_cents", aggregation: "sum", date: "2026-10-15", value: 125050 },
      { metricKey: "revenue.mrr", label: "Monthly recurring revenue", unit: "currency_cents", aggregation: "last", date: "2026-10-15", value: 300000 },
    ]);
    expect(calls.map((digest) => [digest.label, digest.sentences])).toEqual([
      ["Cold calls", ["80 cold calls made in total.", "Best day for cold calls made: Oct 14 (42)."]],
      ["Revenue", ["Monthly recurring revenue: $3,000 on Oct 15.", "$1,250.50 cash collected in total.", "Best day for cash collected: Oct 15 ($1,250.50)."]],
    ]);
  });

  it("numbers the facts the AI agent may use, most telling first", () => {
    const facts = conclusionFacts(digests);
    expect(facts.slice(0, 5)).toEqual([
      { id: "f1", text: "Instagram views, Sep 18 – Oct 17 (30 days given)", value: "9,329" },
      { id: "f2", text: "Instagram views, Sep 18 – Oct 2", value: "2,086" },
      { id: "f3", text: "Instagram views, Oct 3 – Oct 17", value: "7,243" },
      { id: "f4", text: "Instagram views, second half against the first", value: "3.5×" },
      { id: "f5", text: "Instagram views, best day", value: "Oct 9 (2,907)" },
    ]);
    expect(facts.filter((fact) => fact.text.startsWith("LinkedIn followers"))).toEqual([
      { id: expect.any(String), text: "LinkedIn followers, Sep 18", value: "2,362" },
      { id: expect.any(String), text: "LinkedIn followers, Oct 17", value: "2,533" },
      { id: expect.any(String), text: "LinkedIn followers, change", value: "+171, +7.2%" },
    ]);
  });
});

describe("the AI agent's conclusion", () => {
  const facts = [{ id: "f1", text: "Instagram views, first half", value: "2,086" }, { id: "f2", text: "Instagram views, second half", value: "7,243" }, { id: "f3", text: "ratio", value: "3.5×" }];

  it("gets its numbers from the facts", () => {
    expect(renderNote("Views went from {f1} to {f2} ({f3}).", facts)).toBe("Views went from 2,086 to 7,243 (3.5×).");
  });

  it("is thrown away when it types a number itself or names an unknown fact", () => {
    expect(renderNote("Views rose 3x, from {f1} to {f2}.", facts)).toBeNull();
    expect(renderNote("Views went from {f1} to {f9}.", facts)).toBeNull();
    expect(renderNote("Views went from {f1} to {f2} on Oct 9.", facts)).toBeNull();
    expect(renderNote("Views went from {f1} to {{f2}}.", facts)).toBeNull();
    expect(renderNote("   ", facts)).toBeNull();
  });
});
