import { describe, expect, it } from "vitest";
import { mergeReports, type ReportReadResult } from "@/lib/admin/report-merge";

const row = (metricKey: string, date: string, value: number, evidence = "table") => ({
  metricKey, label: metricKey === "instagram.reach" ? "Instagram reach" : "Instagram followers", unit: "count" as const, date, value, evidence,
});
const read = (rows: ReportReadResult["rows"], extra: Partial<ReportReadResult> = {}): ReportReadResult => ({
  method: "ai", note: "", reportDate: "2026-10-17", rows, notUsed: [], dropped: [], ...extra,
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

  it("keeps each file's notes with the file's name", () => {
    const merged = mergeReports([
      { file: "a.pdf", result: read([], { notUsed: [{ item: "Views, last 30 days: 9,329", reason: "A 30-day total" }] }) },
      { file: "b.png", result: read([], { dropped: [{ item: "Instagram reach on 2026-10-18", reason: "The date is in the future" }] }) },
    ]);
    expect(merged.notUsed).toEqual([{ item: "Views, last 30 days: 9,329", reason: "A 30-day total", file: "a.pdf" }]);
    expect(merged.dropped).toEqual([{ item: "Instagram reach on 2026-10-18", reason: "The date is in the future", file: "b.png" }]);
  });

  it("keeps each file's own summary from the reader", () => {
    expect(mergeReports([
      { file: "a.csv", result: read([], { method: "table", note: "Read 30 numbers across 30 days straight from the spreadsheet." }) },
      { file: "b.pdf", result: read([]) },
    ]).notes).toEqual([{ file: "a.csv", note: "Read 30 numbers across 30 days straight from the spreadsheet.", method: "table" }]);
  });

  it("names a report date only when every file has the same one", () => {
    expect(mergeReports([
      { file: "a", result: read([], { reportDate: "2026-10-17" }) },
      { file: "b", result: read([], { reportDate: "2026-10-10" }) },
    ]).reportDate).toBeNull();
    expect(mergeReports([{ file: "a", result: read([], { reportDate: null }) }]).reportDate).toBeNull();
  });
});
