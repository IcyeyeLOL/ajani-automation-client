/**
 * Several report files in one import: each file is read on its own (one model
 * call, one 4 MB request each), then the browser combines the answers into a
 * single review table. Shared by the browser and the server, so no secrets here.
 */
export const REPORT_MAX_FILES = 10;
export const REPORT_FILE_MAX_BYTES = 4_000_000;

export type ReportReadRow = { metricKey: string; label: string; date: string; value: number; evidence: string };
export type ReportReadNote = { item: string; reason: string };
export type ReportReadResult = { platform: string; reportDate: string | null; rows: ReportReadRow[]; notUsed: ReportReadNote[]; dropped: ReportReadNote[] };

export type MergedReportRow = ReportReadRow & { file: string };
export type MergedReportNote = ReportReadNote & { file?: string };
export type MergedReports = {
  platform: string;
  files: string[];
  /** The report date when every file gives the same one. */
  reportDate: string | null;
  rows: MergedReportRow[];
  notUsed: MergedReportNote[];
  dropped: MergedReportNote[];
};

const MAX_NOTES = 100;

/** Combines what each file said. A metric-day the files disagree on is dropped, so a guess never wins. */
export function mergeReports(reads: Array<{ file: string; result: ReportReadResult }>): MergedReports {
  const found = new Map<string, { row: MergedReportRow; conflict: boolean }>();
  const conflicts: MergedReportNote[] = [];
  for (const { file, result } of reads) {
    for (const row of result.rows) {
      const key = `${row.metricKey}|${row.date}`;
      const earlier = found.get(key);
      if (!earlier) found.set(key, { row: { ...row, file }, conflict: false });
      else if (earlier.row.value !== row.value && !earlier.conflict) {
        earlier.conflict = true;
        conflicts.push({ item: `${row.label} on ${row.date}`, reason: "The files give different numbers for this day" });
      }
    }
  }
  const dates = new Set(reads.map(({ result }) => result.reportDate));
  return {
    platform: reads[0]?.result.platform ?? "",
    files: reads.map(({ file }) => file),
    reportDate: dates.size === 1 ? reads[0]?.result.reportDate ?? null : null,
    rows: [...found.values()].filter((entry) => !entry.conflict).map((entry) => entry.row)
      .sort((a, b) => a.metricKey.localeCompare(b.metricKey) || a.date.localeCompare(b.date)),
    notUsed: reads.flatMap(({ file, result }) => result.notUsed.map((note) => ({ ...note, file }))).slice(0, MAX_NOTES),
    dropped: [...conflicts, ...reads.flatMap(({ file, result }) => result.dropped.map((note) => ({ ...note, file })))].slice(0, MAX_NOTES),
  };
}
