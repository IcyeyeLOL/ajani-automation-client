import { describe, expect, it } from "vitest";
import { answeredRows, mergeReports, storeValue, type ReportQuestion, type ReportReadResult } from "@/lib/admin/report-merge";
import type { MetricUnit } from "@/lib/admin/metric-types";

const row = (metricKey: string, date: string, value: number, evidence = "table") => ({
  metricKey, label: metricKey === "instagram.reach" ? "Instagram reach" : "Instagram followers", unit: "count" as const,
  aggregation: metricKey === "instagram.reach" ? "sum" as const : "last" as const, date, value, evidence, doubt: null,
});
const read = (rows: ReportReadResult["rows"], extra: Partial<ReportReadResult> = {}): ReportReadResult => ({
  method: "ai", agent: "used", note: "", reportDate: "2026-10-17", rows, questions: [], groups: [], notUsed: [], dropped: [], ...extra,
});
const question = (overrides: Partial<ReportQuestion> = {}): ReportQuestion => ({
  id: "linkedin|1|views", header: "views", platform: "LinkedIn", reason: "LinkedIn calls post impressions \"impressions\".",
  choices: [{ metricKey: "linkedin.impressions", label: "LinkedIn impressions", unit: "count", aggregation: "sum" }],
  suggestion: null,
  cells: [
    { date: "2026-10-08", value: 20, evidence: "LinkedIn row 2026-10-08, column \"views\"" },
    { date: "2026-10-09", value: 56, evidence: "LinkedIn row 2026-10-09, column \"views\"" },
  ],
  ...overrides,
});

describe("values in the store's unit", () => {
  it("keeps whole counts, hours to the hundredth, and turns dollars into cents", () => {
    expect(storeValue("count", 2219)).toBe(2219);
    expect(storeValue("count", 12.5)).toBeNull();
    expect(storeValue("hours", 1.25)).toBe(1.25);
    expect(storeValue("hours", 1.255)).toBeNull();
    expect(storeValue("currency_cents", 1250.5)).toBe(125050);
    expect(storeValue("currency_cents", 19.99)).toBe(1999);
    for (const unit of ["count", "hours", "currency_cents"] as MetricUnit[]) expect(storeValue(unit, -1)).toBeNull();
  });
});

describe("combining several report files", () => {
  it("puts every file's days in one sorted table and remembers which file each came from", () => {
    const merged = mergeReports([
      { file: "week-2.csv", result: read([row("instagram.reach", "2026-10-15", 90), row("instagram.followers", "2026-10-16", 73)]) },
      { file: "week-1.csv", result: read([row("instagram.reach", "2026-10-08", 2219)]) },
    ]);
    expect(merged.rows.map((item) => [item.metricKey, item.date, item.value, item.file])).toEqual([
      ["instagram.followers", "2026-10-16", 73, "week-2.csv"],
      ["instagram.reach", "2026-10-08", 2219, "week-1.csv"],
      ["instagram.reach", "2026-10-15", 90, "week-2.csv"],
    ]);
    expect(merged).toMatchObject({ files: ["week-2.csv", "week-1.csv"], reportDate: "2026-10-17", notes: [] });
  });

  it("keeps a day two files agree on once, from the first file", () => {
    const merged = mergeReports([
      { file: "a.pdf", result: read([row("instagram.reach", "2026-10-08", 2219, "chart label")]) },
      { file: "b.png", result: read([row("instagram.reach", "2026-10-08", 2219, "screenshot")]) },
    ]);
    expect(merged.rows).toEqual([{ ...row("instagram.reach", "2026-10-08", 2219, "chart label"), file: "a.pdf" }]);
    expect(merged.dropped).toEqual([]);
  });

  it("drops a day the files disagree on and says why, even when a third file agrees with one of them", () => {
    const merged = mergeReports([
      { file: "a.pdf", result: read([row("instagram.reach", "2026-10-08", 2219), row("instagram.followers", "2026-10-17", 73)]) },
      { file: "b.png", result: read([row("instagram.reach", "2026-10-08", 2200)]) },
      { file: "c.csv", result: read([row("instagram.reach", "2026-10-08", 2219)]) },
    ]);
    expect(merged.rows.map((item) => item.metricKey)).toEqual(["instagram.followers"]);
    expect(merged.dropped).toEqual([{ item: "Instagram reach on 2026-10-08", reason: "The files give different numbers for this day" }]);
  });

  it("keeps each file's notes, questions and platform breakdown with the file's name", () => {
    const group = { source: "linkedin", label: "LinkedIn", decidedBy: "platform column", rows: 2, timeZone: "UTC", from: "2026-10-08", to: "2026-10-09", blank: [], checks: [] };
    const merged = mergeReports([
      { file: "a.pdf", result: read([], { notUsed: [{ item: "Views, last 30 days: 9,329", reason: "A 30-day total" }] }) },
      { file: "b.csv", result: read([], { method: "table", agent: "not_needed", note: "Read 2 numbers.", questions: [question()], groups: [group], dropped: [{ item: "Instagram reach on 2026-10-18", reason: "The date is in the future" }] }) },
    ]);
    expect(merged.notUsed).toEqual([{ item: "Views, last 30 days: 9,329", reason: "A 30-day total", file: "a.pdf" }]);
    expect(merged.dropped).toEqual([{ item: "Instagram reach on 2026-10-18", reason: "The date is in the future", file: "b.csv" }]);
    expect(merged.notes).toEqual([{ file: "b.csv", note: "Read 2 numbers.", method: "table", agent: "not_needed" }]);
    expect(merged.questions.map((item) => [item.key, item.file, item.header])).toEqual([["1:linkedin|1|views", "b.csv", "views"]]);
    expect(merged.groups).toEqual([{ ...group, file: "b.csv" }]);
  });

  it("names a report date only when every file has the same one", () => {
    expect(mergeReports([
      { file: "a", result: read([], { reportDate: "2026-10-17" }) },
      { file: "b", result: read([], { reportDate: "2026-10-10" }) },
    ]).reportDate).toBeNull();
    expect(mergeReports([{ file: "a", result: read([], { reportDate: null }) }]).reportDate).toBeNull();
  });
});

describe("the owner's answers to the reader's questions", () => {
  it("copy the column's numbers as the metric picked, and nothing for a column left unused", () => {
    const merged = mergeReports([{ file: "social.csv", result: read([], { questions: [question()] }) }]);
    expect(answeredRows(merged, new Map(), "2026-10-17")).toEqual({ rows: [], dropped: [] });
    expect(answeredRows(merged, new Map([["0:linkedin|1|views", "instagram.views"]]), "2026-10-17").rows).toEqual([]);
    expect(answeredRows(merged, new Map([["0:linkedin|1|views", "linkedin.impressions"]]), "2026-10-17").rows).toEqual([
      { metricKey: "linkedin.impressions", label: "LinkedIn impressions", unit: "count", aggregation: "sum", date: "2026-10-08", value: 20, evidence: "LinkedIn row 2026-10-08, column \"views\"", doubt: null, file: "social.csv" },
      { metricKey: "linkedin.impressions", label: "LinkedIn impressions", unit: "count", aggregation: "sum", date: "2026-10-09", value: 56, evidence: "LinkedIn row 2026-10-09, column \"views\"", doubt: null, file: "social.csv" },
    ]);
  });

  it("check each number like any other row and never overwrite a day another column gives", () => {
    const money = question({
      id: "unnamed|1|collected", header: "collected", platform: null,
      choices: [{ metricKey: "revenue.cash_collected", label: "Cash collected", unit: "currency_cents", aggregation: "sum" }],
      cells: [
        { date: "2026-10-08", value: 1250.5, evidence: "a" }, { date: "2026-10-09", value: 10.005, evidence: "b" },
        { date: "2026-10-18", value: 5, evidence: "c" }, { date: "2026-06-01", value: 5, evidence: "d" }, { date: "2026-10-10", value: 99, evidence: "e" },
      ],
    });
    const merged = mergeReports([{ file: "money.csv", result: read([{ ...row("instagram.reach", "2026-10-10", 1), metricKey: "revenue.cash_collected", label: "Cash collected", unit: "currency_cents", aggregation: "sum" }], { questions: [money] }) }]);
    const { rows, dropped } = answeredRows(merged, new Map([["0:unnamed|1|collected", "revenue.cash_collected"]]), "2026-10-17");
    expect(rows.map((item) => [item.date, item.value])).toEqual([["2026-10-08", 125050]]);
    expect(dropped.map((note) => note.reason)).toEqual([
      "Not a non-negative number with at most two decimals", "The date is in the future", "Older than 100 days", "Another column already gives this day",
    ]);
  });
});
