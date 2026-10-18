import { bucketLabel, formatMetricValue, rangeLabel } from "@/lib/admin/metric-query";
import type { MetricAggregation, MetricUnit } from "@/lib/admin/metric-types";
import { listWords, sourceName } from "@/lib/admin/report-table";

/**
 * The breakdown and conclusion of an import, worked out by code from the rows
 * the owner is about to save: per platform, what each number added up to, how
 * running totals moved, and how the second half of the period compares with the
 * first. The AI agent may word a conclusion from these facts, but every number
 * in it is filled in by code from a fact id, so it can't mistype one.
 */
export type SummaryRow = { metricKey: string; label: string; unit: MetricUnit; aggregation: MetricAggregation; date: string; value: number };
type Span = { from: string; to: string; total: number };
export type MetricDigest = {
  metricKey: string;
  label: string;
  /** The label without its platform, for sentences about that platform: "views". */
  name: string;
  unit: MetricUnit;
  aggregation: MetricAggregation;
  days: number;
  from: string;
  to: string;
  /** Activity (views, calls): the total over the days given, the best day, and two equal halves when the days run unbroken for two weeks or more. */
  total: number | null;
  best: { date: string; value: number } | null;
  halves: { first: Span; second: Span } | null;
  /** Running totals (followers): the first and last day given. */
  start: { date: string; value: number } | null;
  end: { date: string; value: number } | null;
};
export type SourceDigest = { source: string; label: string; from: string; to: string; metrics: MetricDigest[]; sentences: string[] };
export type ConclusionFact = { id: string; text: string; value: string };

const SOURCE_ORDER = ["instagram", "linkedin", "youtube", "reddit", "cold_calls", "sales", "revenue"];
const PLATFORMS = new Set(["instagram", "linkedin", "youtube", "reddit"]);
const PUBLISHED = /\.(posts|videos)_published$/;
/** Names that read badly after a number. */
const NOUNS: Record<string, string> = { "instagram.reach": "accounts reached" };
const HALVES_MIN_DAYS = 14;
const MAX_FACTS = 60;

const sourceOf = (metricKey: string) => metricKey.slice(0, metricKey.indexOf("."));
const day = (date: string) => bucketLabel(date, "day", "axis");
const range = (from: string, to: string) => from === to ? day(from) : rangeLabel(from, to);

/** Per platform (or log), each metric's numbers worked out, plus plain sentences that say what they show. */
export function digestRows(rows: SummaryRow[]): SourceDigest[] {
  const bySource = new Map<string, Map<string, SummaryRow[]>>();
  for (const row of rows) {
    const source = sourceOf(row.metricKey);
    const metrics = bySource.get(source) ?? new Map<string, SummaryRow[]>();
    metrics.set(row.metricKey, [...(metrics.get(row.metricKey) ?? []), row]);
    bySource.set(source, metrics);
  }
  const rank = (source: string) => SOURCE_ORDER.includes(source) ? SOURCE_ORDER.indexOf(source) : SOURCE_ORDER.length;
  return [...bySource].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([source, metrics]) => {
    const label = sourceName(source);
    const digests = [...metrics.values()].map((list) => digestMetric(list, label))
      // Running totals first, then activity from the biggest total down.
      .sort((a, b) => Number(a.aggregation !== "last") - Number(b.aggregation !== "last") || (b.total ?? 0) - (a.total ?? 0) || a.label.localeCompare(b.label));
    const from = digests.map((item) => item.from).sort()[0];
    const to = digests.map((item) => item.to).sort().at(-1)!;
    return { source, label, from, to, metrics: digests, sentences: sentencesFor(digests) };
  });
}

function digestMetric(list: SummaryRow[], sourceLabel: string): MetricDigest {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const [first] = sorted;
  const last = sorted[sorted.length - 1];
  const digest: MetricDigest = {
    metricKey: first.metricKey, label: first.label, name: shortName(first.label, sourceLabel, sourceOf(first.metricKey)),
    unit: first.unit, aggregation: first.aggregation, days: sorted.length, from: first.date, to: last.date,
    total: null, best: null, halves: null, start: null, end: null,
  };
  if (first.aggregation === "last") return { ...digest, start: { date: first.date, value: first.value }, end: { date: last.date, value: last.value } };
  const total = round(sorted.reduce((sum, row) => sum + row.value, 0));
  const best = sorted.reduce<SummaryRow | null>((top, row) => !top || row.value > top.value ? row : top, null);
  const span = daysBetween(first.date, last.date) + 1;
  let halves: MetricDigest["halves"] = null;
  if (sorted.length >= HALVES_MIN_DAYS && span === sorted.length) {
    const half = Math.floor(sorted.length / 2);
    const part = (items: SummaryRow[]): Span => ({ from: items[0].date, to: items[items.length - 1].date, total: round(items.reduce((sum, row) => sum + row.value, 0)) });
    halves = { first: part(sorted.slice(0, half)), second: part(sorted.slice(sorted.length - half)) };
  }
  return { ...digest, total, best: best && best.value > 0 ? { date: best.date, value: best.value } : null, halves };
}

/** "Instagram views" → "views" for sentences about Instagram; other labels read on their own. */
function shortName(label: string, sourceLabel: string, source: string) {
  const name = PLATFORMS.has(source) && label.toLowerCase().startsWith(`${sourceLabel.toLowerCase()} `) ? label.slice(sourceLabel.length + 1) : label;
  return /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

function sentencesFor(digests: MetricDigest[]) {
  const sentences: string[] = [];
  const value = (digest: MetricDigest, amount: number) => formatMetricValue(amount, digest.unit);
  for (const stock of digests.filter((item) => item.aggregation === "last")) {
    const { start, end } = stock;
    if (!start || !end) continue;
    if (start.date === end.date) sentences.push(`${capital(stock.name)}: ${value(stock, end.value)} on ${day(end.date)}.`);
    else if (start.value === end.value) sentences.push(`${capital(stock.name)} held at ${value(stock, end.value)} from ${day(start.date)} to ${day(end.date)}.`);
    else sentences.push(`${capital(stock.name)} went from ${value(stock, start.value)} to ${value(stock, end.value)} (${change(stock, start.value, end.value)}).`);
  }
  const flows = digests.filter((item) => item.aggregation === "sum" && item.total !== null);
  const main = flows.filter((item) => !PUBLISHED.test(item.metricKey) && (item.total ?? 0) > 0).slice(0, 3);
  if (main.length) sentences.push(`${capital(listWords(main.map((item) => `${value(item, item.total!)} ${NOUNS[item.metricKey] ?? item.name}`)))} in total.`);
  const top = main[0];
  if (top?.halves && top.halves.first.total > 0) {
    const { first, second } = top.halves;
    sentences.push(`${capital(top.name)} ${second.total >= first.total ? "rose" : "fell"} from ${value(top, first.total)} (${range(first.from, first.to)}) to ${value(top, second.total)} (${range(second.from, second.to)}), ${ratioWords(first.total, second.total)}.`);
  }
  if (top?.best) sentences.push(`Best day for ${top.name}: ${day(top.best.date)} (${value(top, top.best.value)}).`);
  for (const published of flows.filter((item) => PUBLISHED.test(item.metricKey))) {
    const noun = published.metricKey.endsWith("videos_published") ? "video" : "post";
    sentences.push(published.total ? `${formatMetricValue(published.total, "count")} ${noun}${published.total === 1 ? "" : "s"} published.` : `No ${noun}s published.`);
  }
  return sentences;
}

/** Numbered facts for the AI agent's conclusion, most telling first. */
export function conclusionFacts(digests: SourceDigest[]): ConclusionFact[] {
  const facts: ConclusionFact[] = [];
  const add = (text: string, value: string) => { if (facts.length < MAX_FACTS) facts.push({ id: `f${facts.length + 1}`, text, value }); };
  for (const source of digests) {
    const flows = source.metrics.filter((item) => item.aggregation === "sum");
    const telling = [
      ...source.metrics.filter((item) => item.aggregation === "last"),
      ...flows.filter((item) => !PUBLISHED.test(item.metricKey)).slice(0, 4),
      ...flows.filter((item) => PUBLISHED.test(item.metricKey)),
    ];
    for (const digest of telling) {
      const format = (amount: number) => formatMetricValue(amount, digest.unit);
      if (digest.start && digest.end) {
        add(`${digest.label}, ${day(digest.start.date)}`, format(digest.start.value));
        if (digest.end.date !== digest.start.date) {
          add(`${digest.label}, ${day(digest.end.date)}`, format(digest.end.value));
          add(`${digest.label}, change`, change(digest, digest.start.value, digest.end.value));
        }
        continue;
      }
      if (digest.total === null) continue;
      add(`${digest.label}, ${range(digest.from, digest.to)} (${digest.days} ${digest.days === 1 ? "day" : "days"} given)`, format(digest.total));
      if (digest.halves) {
        add(`${digest.label}, ${range(digest.halves.first.from, digest.halves.first.to)}`, format(digest.halves.first.total));
        add(`${digest.label}, ${range(digest.halves.second.from, digest.halves.second.to)}`, format(digest.halves.second.total));
        if (digest.halves.first.total > 0) add(`${digest.label}, second half against the first`, ratioWords(digest.halves.first.total, digest.halves.second.total));
      }
      if (digest.best && !PUBLISHED.test(digest.metricKey)) add(`${digest.label}, best day`, `${day(digest.best.date)} (${format(digest.best.value)})`);
    }
  }
  return facts;
}

/**
 * The AI agent's conclusion with every {fN} replaced by that fact's value. Null
 * when it names an unknown fact or types a digit of its own, so a mistyped
 * number never reaches the owner.
 */
export function renderNote(text: string, facts: ConclusionFact[]): string | null {
  const byId = new Map(facts.map((fact) => [fact.id, fact.value]));
  const ids = [...text.matchAll(/\{(f\d{1,3})\}/g)].map((match) => match[1]);
  if (ids.some((id) => !byId.has(id))) return null;
  const bare = text.replace(/\{f\d{1,3}\}/g, "");
  if (/\d|[{}]/.test(bare)) return null;
  const rendered = text.replace(/\{(f\d{1,3})\}/g, (_, id: string) => byId.get(id)!).replace(/\s+/g, " ").trim();
  return rendered || null;
}

function change(digest: Pick<MetricDigest, "unit">, from: number, to: number) {
  const difference = to - from;
  const amount = `${difference >= 0 ? "+" : "−"}${formatMetricValue(Math.abs(difference), digest.unit)}`;
  return from > 0 ? `${amount}, ${difference >= 0 ? "+" : "−"}${percent(Math.abs(difference) / from)}` : amount;
}

/** "3.5×" for a big rise, "+35%" for a smaller one, "−45%" for a fall. */
function ratioWords(before: number, after: number) {
  if (after >= before * 2) return `${(Math.round((after / before) * 10) / 10).toLocaleString("en-US")}×`;
  return `${after >= before ? "+" : "−"}${percent(Math.abs(after - before) / before)}`;
}

function percent(share: number) {
  const value = share * 100;
  return `${value < 10 ? (Math.round(value * 10) / 10).toLocaleString("en-US") : Math.round(value).toLocaleString("en-US")}%`;
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
