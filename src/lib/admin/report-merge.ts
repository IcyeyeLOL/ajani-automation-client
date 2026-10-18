import type { MetricAggregation, MetricUnit } from "@/lib/admin/metric-types";

/**
 * Several report files in one import: each file is read on its own (one
 * request each), then the browser combines the answers into a single review.
 * Shared by the browser and the server, so no secrets here.
 */
export const REPORT_MAX_FILES = 10;
export const REPORT_FILE_MAX_BYTES = 4_000_000;
/** Reports cover up to 90 days; anything older is history the charts already have. */
export const REPORT_MAX_DAYS_BACK = 100;
/** An import is compared with the numbers saved up to this many days either side of it. */
export const REPORT_COMPARE_DAYS = 35;

/** A value as people write it (count, hours, dollars) in the store's unit, or null when it can't be stored. */
export function storeValue(unit: MetricUnit, value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === "count") return Number.isInteger(value) && value <= 1e12 ? value : null;
  const hundredths = Math.round(value * 100);
  if (Math.abs(hundredths - value * 100) > 1e-6 || hundredths > 1e14) return null;
  return unit === "currency_cents" ? hundredths : hundredths / 100;
}

export type ReportMetric = { metricKey: string; label: string; unit: MetricUnit; aggregation: MetricAggregation };
/** value is in the store's unit (cents for money). */
export type ReportReadRow = ReportMetric & {
  date: string;
  value: number;
  evidence: string;
  /** Why this number needs a second look (the AI agent wasn't certain). Such rows start unticked. */
  doubt: string | null;
};
export type ReportReadNote = { item: string; reason: string };
/** A column the reader can't place on its own. The owner picks what it is; code copies its numbers. */
export type ReportQuestion = {
  id: string;
  header: string;
  /** The rows' platform in words, or null when the file doesn't say. */
  platform: string | null;
  reason: string;
  choices: ReportMetric[];
  /** The AI agent's pick, always one of the choices. Only a certain pick starts selected. */
  suggestion: { metricKey: string; reason: string; certain: boolean } | null;
  /** One number per day, as people write them (dollars, hours). */
  cells: Array<{ date: string; value: number; evidence: string }>;
};
/** One platform's rows in a file: how the reader knew the platform, and what it checked. */
export type ReportGroup = {
  source: string | null;
  label: string;
  decidedBy: string | null;
  rows: number;
  timeZone: string | null;
  from: string | null;
  to: string | null;
  /** Numbers these rows leave blank: unknown, never zero. */
  blank: string[];
  checks: Array<{ ok: boolean; text: string }>;
};
export type ReportReadResult = {
  method: "table" | "ai";
  /** Whether the AI agent helped with this file. */
  agent: "used" | "not_needed" | "unavailable";
  /** The reader's plain-words summary of the file. */
  note: string;
  reportDate: string | null;
  rows: ReportReadRow[];
  questions: ReportQuestion[];
  groups: ReportGroup[];
  notUsed: ReportReadNote[];
  dropped: ReportReadNote[];
};

export type MergedReportRow = ReportReadRow & { file: string };
export type MergedReportNote = ReportReadNote & { file?: string };
export type MergedQuestion = ReportQuestion & { file: string; key: string };
export type MergedReports = {
  files: string[];
  notes: Array<{ file: string; note: string; method: "table" | "ai"; agent: ReportReadResult["agent"] }>;
  /** The report date when every file gives the same one. */
  reportDate: string | null;
  rows: MergedReportRow[];
  questions: MergedQuestion[];
  groups: Array<ReportGroup & { file: string }>;
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
    files: reads.map(({ file }) => file),
    notes: reads.filter(({ result }) => result.note).map(({ file, result }) => ({ file, note: result.note, method: result.method, agent: result.agent })),
    reportDate: dates.size === 1 ? reads[0]?.result.reportDate ?? null : null,
    rows: [...found.values()].filter((entry) => !entry.conflict).map((entry) => entry.row)
      .sort((a, b) => a.metricKey.localeCompare(b.metricKey) || a.date.localeCompare(b.date)),
    questions: reads.flatMap(({ file, result }, index) => result.questions.map((question) => ({ ...question, file, key: `${index}:${question.id}` }))),
    groups: reads.flatMap(({ file, result }) => result.groups.map((group) => ({ ...group, file }))),
    notUsed: reads.flatMap(({ file, result }) => result.notUsed.map((note) => ({ ...note, file }))).slice(0, MAX_NOTES),
    dropped: [...conflicts, ...reads.flatMap(({ file, result }) => result.dropped.map((note) => ({ ...note, file })))].slice(0, MAX_NOTES),
  };
}

/**
 * The rows the owner's answers add: each answered column's numbers as the
 * metric picked, checked like every other row. A day another column or file
 * already gives is left out rather than overwritten.
 */
export function answeredRows(merged: Pick<MergedReports, "rows" | "questions">, answers: ReadonlyMap<string, string>, today: string) {
  const earliest = shiftDay(today, -REPORT_MAX_DAYS_BACK);
  const taken = new Set(merged.rows.map((row) => `${row.metricKey}|${row.date}`));
  const rows: MergedReportRow[] = [];
  const dropped: MergedReportNote[] = [];
  for (const question of merged.questions) {
    const choice = question.choices.find((item) => item.metricKey === answers.get(question.key));
    if (!choice) continue;
    for (const cell of question.cells) {
      const item = `${choice.label} on ${cell.date}`;
      const value = storeValue(choice.unit, cell.value);
      if (cell.date > today) { dropped.push({ item, reason: "The date is in the future", file: question.file }); continue; }
      if (cell.date < earliest) { dropped.push({ item, reason: `Older than ${REPORT_MAX_DAYS_BACK} days`, file: question.file }); continue; }
      if (value === null) {
        dropped.push({ item, reason: choice.unit === "count" ? "Not a whole, non-negative number" : "Not a non-negative number with at most two decimals", file: question.file });
        continue;
      }
      const key = `${choice.metricKey}|${cell.date}`;
      if (taken.has(key)) { dropped.push({ item, reason: "Another column already gives this day", file: question.file }); continue; }
      taken.add(key);
      rows.push({ ...choice, date: cell.date, value, evidence: cell.evidence, doubt: null, file: question.file });
    }
  }
  return { rows, dropped };
}

export function shiftDay(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
