import { bucketLabel, formatMetricValue } from "@/lib/admin/metric-query";
import type { MetricAggregation, MetricUnit } from "@/lib/admin/metric-types";
import type { MergedReportRow } from "@/lib/admin/report-merge";

/**
 * What an import will change, worked out before anything is saved. Each row is
 * new, the same as the number already saved, or replaces it. Rows that look wrong
 * next to the saved numbers are flagged and start unticked. Saved numbers an
 * earlier import copied from another platform's rows (LinkedIn's followers saved
 * as Instagram's) are offered for removal. Code decides all of this from the
 * rows and the store; the AI agent never proposes a removal. Shared by the review
 * in the browser and the save action, which checks the flags again.
 */
export type SavedValue = { metricKey: string; date: string; value: number; synced: boolean };
export type PlannedRow = MergedReportRow & {
  change: "new" | "same" | "replaces";
  previous: { value: number; synced: boolean } | null;
  /** Reasons to look twice. A row with any starts unticked. */
  flags: string[];
};
export type RemovalProposal = {
  id: string;
  metricKey: string;
  label: string;
  unit: MetricUnit;
  /** The other platform's number these saved values copy. */
  copies: { metricKey: string; label: string };
  rows: Array<{ date: string; value: number }>;
};
export type PlanMetric = { label: string; unit: MetricUnit };
type FlagRow = { metricKey: string; date: string; value: number; unit: MetricUnit; aggregation: MetricAggregation };
export type SavedIndex = { at(metricKey: string, date: string): SavedValue | null; near(metricKey: string, date: string): SavedValue | null };

/** A running total this many times another nearby one, and at least this far from it, needs a second look. */
const JUMP_RATIO = 3;
const JUMP_GAP: Record<MetricUnit, number> = { count: 50, hours: 50, currency_cents: 5_000, ratio: Number.POSITIVE_INFINITY };
const NEAR_DAYS = 35;
/** A copy is only proposed for removal when it matches on this many days with real numbers, never by chance. */
const COPY_MIN_DAYS = 3;
const COPY_MIN_VALUE: Record<MetricUnit, number> = { count: 10, hours: 10, currency_cents: 1_000, ratio: Number.POSITIVE_INFINITY };

const keyOf = (metricKey: string, date: string) => `${metricKey}|${date}`;
const sourceOf = (metricKey: string) => metricKey.slice(0, metricKey.indexOf("."));
const nameOf = (metricKey: string) => metricKey.slice(metricKey.indexOf(".") + 1);
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const day = (date: string) => bucketLabel(date, "day", "axis");

export function planImport(rows: MergedReportRow[], saved: SavedValue[], metrics: ReadonlyMap<string, PlanMetric>) {
  const removals = findCopies(rows, saved, metrics);
  return { removals, rows: flagRows(rows, saved, removalKeys(removals)) };
}

export function removalKeys(removals: Array<Pick<RemovalProposal, "metricKey" | "rows">>) {
  return new Set(removals.flatMap((proposal) => proposal.rows.map((row) => keyOf(proposal.metricKey, row.date))));
}

/** Each row's change and flags. Saved numbers about to be removed don't count as saved. */
export function flagRows(rows: MergedReportRow[], saved: SavedValue[], removing: ReadonlySet<string>): PlannedRow[] {
  const index = indexSaved(saved, removing);
  const twins = sameOnTwoPlatforms(rows);
  return rows.map((row) => {
    const previous = index.at(row.metricKey, row.date);
    const change = !previous ? "new" : same(previous.value, row.value) ? "same" : "replaces";
    const flags = [
      ...(row.doubt ? [row.doubt] : []),
      ...(change === "same" ? [] : savedFlags(row, index)),
      ...(twins.get(keyOf(row.metricKey, row.date)) ?? []),
    ];
    return { ...row, change, previous: previous && { value: previous.value, synced: previous.synced }, flags };
  });
}

export function indexSaved(saved: SavedValue[], removing: ReadonlySet<string> = new Set()): SavedIndex {
  const byMetric = new Map<string, SavedValue[]>();
  const byKey = new Map<string, SavedValue>();
  for (const item of saved) {
    if (removing.has(keyOf(item.metricKey, item.date))) continue;
    byKey.set(keyOf(item.metricKey, item.date), item);
    byMetric.set(item.metricKey, [...(byMetric.get(item.metricKey) ?? []), item]);
  }
  for (const list of byMetric.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return {
    at: (metricKey, date) => byKey.get(keyOf(metricKey, date)) ?? null,
    near: (metricKey, date) => {
      let best: SavedValue | null = null;
      let distance = Number.POSITIVE_INFINITY;
      for (const item of byMetric.get(metricKey) ?? []) {
        const gap = Math.abs(daysBetween(item.date, date));
        if (item.date !== date && gap <= NEAR_DAYS && gap < distance) { best = item; distance = gap; }
      }
      return best;
    },
  };
}

/** Flags from the saved numbers alone, so the save action can check them again. */
export function savedFlags(row: FlagRow, index: SavedIndex): string[] {
  const flags: string[] = [];
  const format = (value: number) => formatMetricValue(value, row.unit);
  const far = (a: number, b: number) => a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) >= JUMP_RATIO && Math.abs(a - b) >= JUMP_GAP[row.unit];
  const previous = index.at(row.metricKey, row.date);
  if (previous && far(previous.value, row.value)) flags.push(`Very different from the ${format(previous.value)} saved for this day.`);
  if (row.aggregation === "last") {
    const near = index.near(row.metricKey, row.date);
    if (near && far(near.value, row.value)) {
      flags.push(row.value > near.value
        ? `${Math.round(row.value / near.value).toLocaleString("en-US")} times the ${format(near.value)} saved for ${day(near.date)}.`
        : `Far below the ${format(near.value)} saved for ${day(near.date)}.`);
    }
  }
  return flags;
}

/** The same number under one name on two platforms, day after day: one is probably the other's. */
function sameOnTwoPlatforms(rows: MergedReportRow[]) {
  const byNameDay = new Map<string, MergedReportRow[]>();
  for (const row of rows) byNameDay.set(`${nameOf(row.metricKey)}|${row.date}`, [...(byNameDay.get(`${nameOf(row.metricKey)}|${row.date}`) ?? []), row]);
  const pairs = new Map<string, Array<[MergedReportRow, MergedReportRow]>>();
  for (const list of byNameDay.values()) {
    for (const [index, first] of list.entries()) {
      for (const second of list.slice(index + 1)) {
        if (sourceOf(first.metricKey) === sourceOf(second.metricKey) || !same(first.value, second.value) || first.value < COPY_MIN_VALUE[first.unit]) continue;
        const pair = `${first.metricKey}|${second.metricKey}`;
        pairs.set(pair, [...(pairs.get(pair) ?? []), [first, second]]);
      }
    }
  }
  const flags = new Map<string, string[]>();
  for (const matches of pairs.values()) {
    if (matches.length < COPY_MIN_DAYS) continue;
    for (const [first, second] of matches) {
      for (const [row, other] of [[first, second], [second, first]]) {
        flags.set(keyOf(row.metricKey, row.date), [...(flags.get(keyOf(row.metricKey, row.date)) ?? []),
          `Same number as ${other.label} that day, and on ${matches.length - 1} other days. One may be the other's numbers.`]);
      }
    }
  }
  return flags;
}

/**
 * Saved numbers on a platform this import covers that day, which the import
 * leaves blank, and which equal another platform's number of the same name in
 * the import: an earlier import put that platform's rows on the wrong one.
 * Numbers synced from a platform are never proposed.
 */
function findCopies(rows: MergedReportRow[], saved: SavedValue[], metrics: ReadonlyMap<string, PlanMetric>): RemovalProposal[] {
  const imported = new Set(rows.map((row) => keyOf(row.metricKey, row.date)));
  const covered = new Set(rows.map((row) => `${sourceOf(row.metricKey)}|${row.date}`));
  const byNameDay = new Map<string, MergedReportRow[]>();
  for (const row of rows) byNameDay.set(`${nameOf(row.metricKey)}|${row.date}`, [...(byNameDay.get(`${nameOf(row.metricKey)}|${row.date}`) ?? []), row]);
  const proposals = new Map<string, RemovalProposal>();
  for (const item of saved) {
    if (item.synced || imported.has(keyOf(item.metricKey, item.date)) || !covered.has(`${sourceOf(item.metricKey)}|${item.date}`)) continue;
    const twin = (byNameDay.get(`${nameOf(item.metricKey)}|${item.date}`) ?? [])
      .find((row) => sourceOf(row.metricKey) !== sourceOf(item.metricKey) && same(row.value, item.value));
    const metric = metrics.get(item.metricKey);
    if (!twin || !metric) continue;
    const id = `${item.metricKey}>${twin.metricKey}`;
    const proposal = proposals.get(id) ?? { id, metricKey: item.metricKey, label: metric.label, unit: metric.unit, copies: { metricKey: twin.metricKey, label: twin.label }, rows: [] };
    proposal.rows.push({ date: item.date, value: item.value });
    proposals.set(id, proposal);
  }
  return [...proposals.values()]
    .filter((proposal) => proposal.rows.filter((row) => row.value >= COPY_MIN_VALUE[proposal.unit]).length >= COPY_MIN_DAYS)
    .map((proposal) => ({ ...proposal, rows: proposal.rows.sort((a, b) => a.date.localeCompare(b.date)) }));
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
