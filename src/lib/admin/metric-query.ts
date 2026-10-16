import { z } from "zod";
import type { Goal, MetricDefinition, MetricGrain, MetricSeriesQuery, MetricUnit } from "@/lib/admin/metric-types";

/** Must match the database checks in 20261016010000_analytics_metric_store.sql. */
export const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const METRIC_DIMENSION_PATTERN = /^[a-z0-9@][a-z0-9_.:@/-]{0,79}$/;
export const MAX_SERIES_METRICS = 12;

export const metricGrains: MetricGrain[] = ["day", "week", "month", "quarter", "year"];

export const rangePresets: Record<MetricGrain, number[]> = {
  day: [7, 30, 90],
  week: [12, 26, 52],
  month: [6, 12, 24],
  quarter: [4, 8, 12],
  year: [3, 5],
};

export const defaultRangeCount: Record<MetricGrain, number> = { day: 30, week: 12, month: 12, quarter: 8, year: 3 };

/** The owner's scorecard order: the Growth Goal Sheet first, then the outreach that feeds it. */
export const DEFAULT_TREND_METRICS = [
  "sales.deals_won",
  "revenue.cash_collected",
  "revenue.mrr",
  "linkedin.followers",
  "outreach.calls_booked",
  "dripify.reply_rate",
  "outreach.touches",
  "ajani.drafts_saved",
];

const dimensionSchema = z.string().trim().toLowerCase().max(80)
  .refine((value) => value === "" || METRIC_DIMENSION_PATTERN.test(value), "Account names may use letters, numbers, @ . _ : / and -");

export const metricSeriesQuerySchema = z.object({
  metrics: z.array(z.string().regex(METRIC_KEY_PATTERN)).min(1).max(MAX_SERIES_METRICS),
  grain: z.enum(["day", "week", "month", "quarter", "year"]),
  from: z.iso.date(),
  to: z.iso.date(),
  dimension: dimensionSchema.nullable().transform((value) => value || null),
}).refine((value) => value.from <= value.to, { message: "The range must start before it ends", path: ["from"] });

export function parseMetricSeriesQuery(params: URLSearchParams) {
  return metricSeriesQuerySchema.safeParse({
    metrics: [...new Set((params.get("metrics") ?? "").split(",").map((key) => key.trim()).filter(Boolean))],
    grain: params.get("grain"),
    from: params.get("from"),
    to: params.get("to"),
    dimension: params.get("dimension") || null,
  });
}

/** Stable parameter order so identical queries share one client cache entry. */
export function metricSeriesSearch(query: MetricSeriesQuery) {
  const params = new URLSearchParams({
    metrics: [...query.metrics].sort().join(","),
    grain: query.grain,
    from: query.from,
    to: query.to,
  });
  if (query.dimension) params.set("dimension", query.dimension);
  return params.toString();
}

/** The last `count` periods of `grain`, ending today (UTC), with the first period complete. */
export function rangeForPreset(grain: MetricGrain, count: number, today: string) {
  const end = parseDay(today);
  const start = periodStart(grain, end);
  const periods = Math.max(1, Math.floor(count)) - 1;
  if (grain === "day") start.setUTCDate(start.getUTCDate() - periods);
  if (grain === "week") start.setUTCDate(start.getUTCDate() - periods * 7);
  if (grain === "month") start.setUTCMonth(start.getUTCMonth() - periods);
  if (grain === "quarter") start.setUTCMonth(start.getUTCMonth() - periods * 3);
  if (grain === "year") start.setUTCFullYear(start.getUTCFullYear() - periods);
  return { from: formatDay(start), to: today };
}

export function periodStart(grain: MetricGrain, day: Date) {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  if (grain === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (grain === "month") start.setUTCDate(1);
  if (grain === "quarter") start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
  if (grain === "year") start.setUTCMonth(0, 1);
  return start;
}

export function presetLabel(grain: MetricGrain, count: number) {
  return `${count}${({ day: "D", week: "W", month: "M", quarter: "Q", year: "Y" } as const)[grain]}`;
}

export function grainLabel(grain: MetricGrain) {
  return ({ day: "Daily", week: "Weekly", month: "Monthly", quarter: "Quarterly", year: "Yearly" } as const)[grain];
}

// ---------------------------------------------------------------------------
// Trends page: periods, views and the saved view.
// ---------------------------------------------------------------------------

/** Trends shows days, weeks and months; quarters and years stay valid in the API. */
export type TrendGrain = "day" | "week" | "month";
export type TrendPeriod = "7d" | "30d" | "3m" | "6m" | "12m";
export const TREND_GRAINS: TrendGrain[] = ["day", "week", "month"];
export const MAX_TREND_PICKS = 8;
export const TREND_STORAGE_KEY = "ajani_admin_trends_v3";
export const LEGACY_TREND_STORAGE_KEY = "ajani_admin_trends_v2";

/** Periods of each grain per window (the `count` for rangeForPreset); a missing grain is not offered. */
export const trendPeriods: Array<{ id: TrendPeriod; label: string; counts: Partial<Record<TrendGrain, number>>; grain: TrendGrain }> = [
  { id: "7d", label: "Last 7 days", counts: { day: 7 }, grain: "day" },
  { id: "30d", label: "Last 30 days", counts: { day: 30, week: 5 }, grain: "day" },
  { id: "3m", label: "Last 3 months", counts: { day: 90, week: 13, month: 3 }, grain: "week" },
  { id: "6m", label: "Last 6 months", counts: { week: 26, month: 6 }, grain: "week" },
  { id: "12m", label: "Last 12 months", counts: { week: 52, month: 12 }, grain: "month" },
];

export function trendPeriod(period: TrendPeriod) {
  return trendPeriods.find((item) => item.id === period) ?? trendPeriods[2];
}

/** A new period keeps the grain when it offers it, otherwise it uses its own default. */
export function grainForPeriod(period: TrendPeriod, grain: MetricGrain): TrendGrain {
  const item = trendPeriod(period);
  return item.counts[grain as TrendGrain] ? grain as TrendGrain : item.grain;
}

export function trendRange(period: TrendPeriod, grain: MetricGrain, today: string) {
  const shown = grainForPeriod(period, grain);
  return { grain: shown, ...rangeForPreset(shown, trendPeriod(period).counts[shown] ?? 1, today) };
}

export type TrendViewId = "key" | "sales" | "outreach" | "dripify" | "linkedin" | "instagram" | "youtube" | "tiktok" | "reddit" | "website";
export type TrendView = {
  id: TrendViewId;
  label: string;
  /** Metric sources in the view; null means every source. */
  sources: string[] | null;
  suggested: string[];
  /** The account filter's wording, for views whose numbers split by account. */
  account: { label: string; all: string; noun: string } | null;
};

const byAccount = { label: "Account", all: "All accounts", noun: "account" };

export const trendViews: TrendView[] = [
  { id: "key", label: "Key numbers", sources: null, suggested: DEFAULT_TREND_METRICS, account: null },
  { id: "sales", label: "Sales & revenue", sources: ["sales", "revenue"], suggested: ["sales.deals_won", "revenue.cash_collected", "revenue.mrr", "revenue.active_clients", "sales.content_leads", "sales.close_rate"], account: null },
  { id: "outreach", label: "Outreach", sources: ["outreach"], suggested: ["outreach.touches", "outreach.replies", "outreach.reply_rate", "outreach.calls_booked"], account: { label: "Channel", all: "All channels", noun: "channel" } },
  { id: "dripify", label: "Dripify", sources: ["dripify"], suggested: ["dripify.new_contacted", "dripify.new_replies", "dripify.reply_rate", "dripify.acceptance_rate", "dripify.leads_remaining", "dripify.unread_messages"], account: { label: "Campaign", all: "All campaigns", noun: "campaign" } },
  { id: "linkedin", label: "LinkedIn", sources: ["linkedin"], suggested: ["linkedin.followers", "linkedin.impressions", "linkedin.engagements", "linkedin.posts_published"], account: byAccount },
  { id: "instagram", label: "Instagram", sources: ["instagram"], suggested: ["instagram.followers", "instagram.reach", "instagram.views", "instagram.interactions"], account: byAccount },
  { id: "youtube", label: "YouTube", sources: ["youtube"], suggested: ["youtube.subscribers", "youtube.views", "youtube.watch_hours", "youtube.videos_published"], account: byAccount },
  { id: "tiktok", label: "TikTok", sources: ["tiktok"], suggested: ["tiktok.followers", "tiktok.views", "tiktok.likes", "tiktok.videos_published"], account: byAccount },
  { id: "reddit", label: "Reddit", sources: ["reddit"], suggested: ["reddit.views", "reddit.upvotes", "reddit.dms_sent", "reddit.dm_reply_rate"], account: byAccount },
  { id: "website", label: "Website", sources: ["ajani"], suggested: ["ajani.drafts_saved", "ajani.builds_submitted", "ajani.brief_to_build_rate", "ajani.new_workspaces"], account: null },
];

export function inView(view: Pick<TrendView, "sources">, source: string) {
  return view.sources === null || view.sources.includes(source);
}

export type TrendPreferences = { view: TrendViewId; period: TrendPeriod; grain: TrendGrain; picks: Partial<Record<TrendViewId, string[]>> };

/**
 * The saved view (v3), or a one-time migration of v2's single grain, range and
 * metric list: its metrics become the Key numbers picks and its range the
 * nearest period. Anything unreadable gives defaults. Picks are not checked
 * against the catalog here: a catalog that fails to load must not wipe them,
 * and viewPicks skips unknown metrics when charting.
 */
export function readTrendPreferences(stored: unknown, legacy: unknown): TrendPreferences {
  const keep = (list: unknown) => Array.isArray(list)
    ? [...new Set(list.filter((key): key is string => typeof key === "string" && METRIC_KEY_PATTERN.test(key)))].slice(0, MAX_TREND_PICKS)
    : null;
  if (isRecord(stored)) {
    const period = trendPeriods.find((item) => item.id === stored.period)?.id ?? "3m";
    const picks: TrendPreferences["picks"] = {};
    if (isRecord(stored.picks)) {
      for (const view of trendViews) {
        const list = Object.hasOwn(stored.picks, view.id) ? keep(stored.picks[view.id]) : null;
        if (list) picks[view.id] = list;
      }
    }
    return {
      view: trendViews.find((item) => item.id === stored.view)?.id ?? "key",
      period,
      grain: grainForPeriod(period, TREND_GRAINS.find((item) => item === stored.grain) ?? trendPeriod(period).grain),
      picks,
    };
  }
  if (isRecord(legacy) && metricGrains.includes(legacy.grain as MetricGrain)) {
    const count = Number(legacy.count);
    const [period, grain]: [TrendPeriod, TrendGrain] = legacy.grain === "day" ? ["30d", "day"]
      : legacy.grain === "week" ? [count >= 52 ? "12m" : count >= 26 ? "6m" : "3m", "week"]
        : ["12m", "month"];
    const metrics = keep(legacy.metrics);
    return { view: "key", period, grain, picks: metrics?.length ? { key: metrics } : {} };
  }
  return { view: "key", period: "3m", grain: "week", picks: {} };
}

/** A view's charts: its saved picks, else the suggested numbers this catalog has. */
export function viewPicks(preferences: Pick<TrendPreferences, "picks">, view: Pick<TrendView, "id" | "suggested">, known: ReadonlySet<string>) {
  return (preferences.picks[view.id] ?? view.suggested).filter((key) => known.has(key)).slice(0, MAX_TREND_PICKS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Trends page: labels, changes and axes.
// ---------------------------------------------------------------------------

const labelPrefix = /^(YouTube|TikTok|Instagram|LinkedIn|Reddit|Dripify|Outreach|X) /;

/** "LinkedIn followers" → "Followers": the view or the card's eyebrow already names the platform. */
export function shortMetricLabel(label: string) {
  const short = label.replace(/ \((lifetime|of contacted)\)$/, "").replace(labelPrefix, "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** The view a source belongs to names it: "sales" and "revenue" are both "Sales & revenue". */
export function sourceLabel(source: string) {
  return trendViews.find((view) => view.sources?.includes(source))?.label ?? source.charAt(0).toUpperCase() + source.slice(1);
}

const channelNames: Record<string, string> = {
  linkedin: "LinkedIn", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", reddit: "Reddit", x: "X",
  manual: "Manual", dripify: "Dripify", organic: "Organic",
};

/** Outreach splits by channel and method: "linkedin/dripify" → "LinkedIn · Dripify". */
export function channelLabel(key: string) {
  return key.split("/").map((part) => Object.hasOwn(channelNames, part) ? channelNames[part] : part.charAt(0).toUpperCase() + part.slice(1)).join(" · ");
}

/** A rate built from running totals (Dripify's) covers each campaign's whole life, not the chosen period. */
export function isLifetimeRate(definition: Pick<MetricDefinition, "aggregation" | "numeratorKey">, lookup: (key: string) => Pick<MetricDefinition, "aggregation"> | undefined) {
  return definition.aggregation === "ratio" && lookup(definition.numeratorKey ?? "")?.aggregation === "last";
}

/** "Jul 20 – Oct 16"; years appear only when the range crosses one. */
export function rangeLabel(from: string, to: string) {
  const style = from.slice(0, 4) === to.slice(0, 4) ? "axis" : "full";
  return `${bucketLabel(from, "day", style)} – ${bucketLabel(to, "day", style)}`;
}

export type TrendChange = { direction: "up" | "down" | "same"; label: string; tone: "good" | "bad" | "neutral" };

/**
 * "▲ +4.1%", "▼ −1.4 points", "▲ <0.1%" for a real but tiny move, or "Same as
 * previous" only when nothing changed; null when there is nothing to compare with.
 */
export function trendChange(definition: Pick<MetricDefinition, "unit" | "higherIsBetter">, current: number | null, previous: number | null): TrendChange | null {
  if (current === null || previous === null) return null;
  if (current === previous) return { direction: "same", label: "Same as previous", tone: "neutral" };
  const ratio = definition.unit === "ratio";
  if (!ratio && previous === 0) return null;
  const amount = ratio ? (current - previous) * 100 : ((current - previous) / previous) * 100;
  const up = amount > 0;
  const unit = ratio ? " points" : "%";
  const shown = Math.abs(amount).toFixed(1);
  if (shown === "0.0") return { direction: up ? "up" : "down", label: `${up ? "▲" : "▼"} <0.1${unit}`, tone: "neutral" };
  return {
    direction: up ? "up" : "down",
    label: `${up ? "▲ +" : "▼ −"}${shown}${unit}`,
    tone: up === definition.higherIsBetter ? "good" : "bad",
  };
}

/** What a number's data rests on: a rate is only as known as its denominator (close rate needs calls held). */
export function trendBasis<T extends Pick<MetricDefinition, "aggregation" | "denominatorKey">>(definition: T, lookup: (key: string) => T | undefined): T {
  return definition.aggregation === "ratio" ? lookup(definition.denominatorKey ?? "") ?? definition : definition;
}

/**
 * Why a period has no value. Unknown is never zero: a rate had "No activity"
 * only over a real zero denominator, and a count only when it is derived from
 * activity (a missing derived count really is none). Otherwise the number was
 * not logged (typed in) or not synced (a connector's), judged by `basis`: the
 * metric itself, or a rate's denominator.
 */
export function missingValueLabel(definition: Pick<MetricDefinition, "aggregation" | "entryMode">, basis: Pick<MetricDefinition, "entryMode"> = definition, denominator: number | null = null) {
  if (definition.aggregation === "ratio" ? denominator === 0 : definition.entryMode === "derived") return "No activity";
  return basis.entryMode === "connector" ? "Not synced" : "Not logged";
}

/** Table rows: "Aug 10–16", "Aug 31 – Sep 6", "Aug 10" or "Aug 2026"; " ’25" when the table spans two years. */
export function shortBucketLabel(start: string, end: string, grain: MetricGrain, withYear: boolean) {
  if (grain !== "day" && grain !== "week") return bucketLabel(start, grain);
  const year = withYear ? ` ’${end.slice(2, 4)}` : "";
  if (grain === "day" || start === end) return `${bucketLabel(start, "day", "axis")}${year}`;
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${bucketLabel(start, "day", "axis")}${sameMonth ? `–${Number(end.slice(8))}` : ` – ${bucketLabel(end, "day", "axis")}`}${year}`;
}

/** X-axis dates: "Jul 20", or "Oct 20 ’25" when the chart spans two years; months always carry their year. */
export function axisDateLabel(start: string, grain: MetricGrain, withYear: boolean) {
  if (grain !== "day" && grain !== "week") return bucketLabel(start, grain, grain === "month" ? "full" : "axis");
  const label = bucketLabel(start, grain, "axis");
  return withYear ? `${label} ’${start.slice(2, 4)}` : label;
}

/**
 * Three evenly spaced, round axis values covering every value, topping out at
 * the first round number at or above the largest (53 → 0 · 30 · 60). Totals and
 * rates start at zero; a stock (followers, MRR) zooms to its own range so growth
 * is visible, and falls back to zero when the zoom would reach it anyway.
 */
export function axisTicks(values: number[], options: { fromZero: boolean; whole: boolean }): [number, number, number] {
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  // Counts never get a "2.5" tick: their steps stay whole (1, 2, 3, 5, 10…).
  const stepFor = (value: number) => options.whole ? Math.max(1, Math.ceil(niceCeiling(value))) : niceCeiling(value);
  const zeroBased = () => ticksFrom(0, stepFor((max > 0 ? max : options.whole ? 2 : 1) / 2));
  if (options.fromZero || values.length < 2 || min === max || min <= 0) return zeroBased();
  let step = stepFor((max - min) / 2);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const low = Math.floor(min / step) * step;
    if (low + 2 * step >= max) return low <= 0 ? zeroBased() : ticksFrom(low, step);
    step = stepFor(step * 1.01);
  }
  return zeroBased();
}

function ticksFrom(low: number, step: number): [number, number, number] {
  return [0, 1, 2].map((index) => Number((low + step * index).toPrecision(12))) as [number, number, number];
}

// Steps an axis may use, × 10ⁿ. With ticks at 0, one step and two steps, the top
// lands on 2, 4, 5, 6, 8 or 10 × 10ⁿ, so the tallest bar fills most of the plot.
const NICE_STEPS = [1, 2, 2.5, 3, 4, 5, 10];

/** The smallest of 1, 2, 2.5, 3, 4, 5 × 10ⁿ at or above the value. */
export function niceCeiling(value: number) {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = Number((value / magnitude).toPrecision(12));
  const step = NICE_STEPS.find((item) => normalized <= item) ?? 10;
  return Number((step * magnitude).toPrecision(12));
}

/**
 * Axis labels share one notation, chosen by the top value: "0 · 5K · 10K",
 * "0% · 2.5% · 5%". They carry as many decimals as the ticks need to be exact,
 * so two ticks never read the same ("0% · 0.05% · 0.1%").
 */
export function axisLabels(ticks: number[], unit: MetricUnit) {
  const shown = ticks.map((value) => unit === "ratio" ? value * 100 : unit === "currency_cents" ? value / 100 : value);
  let decimals = 0;
  while (decimals < 6 && shown.some((value) => Math.abs(value - Number(value.toFixed(decimals))) > 1e-9)) decimals += 1;
  // Money below a dollar step shows cents properly: "$0.05", never "$0.1".
  if (unit === "currency_cents" && decimals) decimals = Math.max(2, decimals);
  const suffix = unit === "ratio" ? "%" : unit === "hours" ? " h" : "";
  const build = (compact: boolean) => {
    const format = new Intl.NumberFormat("en-US", {
      ...(unit === "currency_cents" ? { style: "currency", currency: "USD" } : {}),
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: unit === "currency_cents" && !compact ? decimals : 0,
      maximumFractionDigits: compact ? 1 : decimals,
    });
    return shown.map((value) => `${format.format(value)}${suffix}`);
  };
  const labels = build(Math.max(...shown.map(Math.abs)) >= 10_000);
  // Compact notation can merge close values ("1M" three times); spell them out then.
  return new Set(labels).size === labels.length ? labels : build(false);
}

export function bucketLabel(start: string, grain: MetricGrain, style: "axis" | "full" = "full") {
  const date = parseDay(start);
  if (grain === "year") return String(date.getUTCFullYear());
  if (grain === "quarter") return `Q${Math.floor(date.getUTCMonth() / 3) + 1}${style === "axis" ? ` ’${String(date.getUTCFullYear()).slice(2)}` : ` ${date.getUTCFullYear()}`}`;
  if (grain === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: style === "axis" ? "2-digit" : "numeric", timeZone: "UTC" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(style === "full" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function bucketRangeLabel(start: string, end: string, grain: MetricGrain) {
  if (grain === "day") return bucketLabel(start, grain);
  if (grain === "month" || grain === "quarter" || grain === "year") return bucketLabel(start, grain);
  return `${bucketLabel(start, grain, "axis")} – ${bucketLabel(end, grain)}`;
}

export function formatMetricValue(value: number | null, unit: MetricUnit, style: "compact" | "full" = "full") {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (unit === "currency_cents") {
    // Whole dollars unless there really are cents: "$3,950", "$19.99".
    const cents = style === "full" && !Number.isInteger(value / 100) ? 2 : 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: style === "compact" && Math.abs(value) >= 100_000_00 ? "compact" : "standard",
      minimumFractionDigits: cents,
      maximumFractionDigits: cents,
    }).format(value / 100);
  }
  const formatted = new Intl.NumberFormat("en-US", {
    notation: style === "compact" && Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: unit === "hours" ? 1 : style === "compact" ? 1 : 0,
  }).format(value);
  return unit === "hours" ? `${formatted} h` : formatted;
}

export type MetricChange = { label: string; tone: "good" | "bad" | "neutral" };

/** Rates change in percentage points; counts and money change relatively. */
export function metricChange(definition: Pick<MetricDefinition, "unit" | "higherIsBetter">, current: number | null, previous: number | null): MetricChange | null {
  if (current === null || previous === null) return null;
  const difference = current - previous;
  if (definition.unit === "ratio") {
    const points = difference * 100;
    return { label: `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts`, tone: toneFor(points, definition.higherIsBetter) };
  }
  if (previous === 0) return current === 0 ? { label: "No change", tone: "neutral" } : null;
  const percent = (difference / previous) * 100;
  return { label: `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`, tone: toneFor(percent, definition.higherIsBetter) };
}

function toneFor(change: number, higherIsBetter: boolean): MetricChange["tone"] {
  if (Math.abs(change) < 0.05) return "neutral";
  return (change > 0) === higherIsBetter ? "good" : "bad";
}

export type GoalStatus = "reached" | "on_pace" | "behind" | "missed" | "no_pace" | "not_logged" | "not_started";

export type GoalProgress = {
  status: GoalStatus;
  /** Share of the target reached (0-1). null when nothing is recorded. */
  share: number | null;
  /** Where a straight line from the start to the target is today, as a value and a share of the target. */
  expected: number | null;
  expectedShare: number | null;
  /** Still to go; null when nothing is recorded. */
  remaining: number | null;
  /** Whole days after today until the deadline (weekly goals: until Sunday). */
  daysLeft: number;
};

/**
 * Pace is a straight line from the start (zero for totals and weeks, the
 * recorded baseline for latest values) to the target on the due date. A
 * latest-value goal without a baseline gets no pace verdict rather than a
 * guessed one. Counts round the expected value down: two of five clients due
 * by today is on pace even when the line says 2.8.
 */
export function goalProgress(goal: Goal, today: string, weekStart: string): GoalProgress {
  const start = goal.measure === "weekly" ? weekStart : goal.startDate;
  const end = goal.measure === "weekly" ? addDays(weekStart, 6) : goal.dueDate ?? today;
  const totalDays = Math.max(1, dayCount(start, end));
  const daysLeft = Math.max(0, dayCount(today, end) - 1);
  const unmeasured = { share: null, expected: null, expectedShare: null, remaining: null, daysLeft };
  // A weekly goal also waits for its own start date before its first week counts.
  if (today < goal.startDate || today < start) return { status: "not_started", ...unmeasured };
  if (goal.current === null) return { status: today > end ? "missed" : "not_logged", ...unmeasured };

  const share = clampShare(goal.current / goal.target);
  const remaining = Math.max(0, goal.target - goal.current);
  const origin = goal.measure === "latest" ? goal.baseline : 0;
  const elapsed = Math.min(1, dayCount(start, today) / totalDays);
  const exact = origin === null ? null : origin + (goal.target - origin) * elapsed;
  const expected = exact === null ? null : goal.unit === "count" ? Math.floor(exact + 1e-9) : exact;
  const expectedShare = expected === null ? null : clampShare(expected / goal.target);

  const status: GoalStatus = goal.current >= goal.target ? "reached"
    : today > end ? "missed"
      : expected === null ? "no_pace"
        : goal.current >= expected ? "on_pace" : "behind";
  return { status, share, expected, expectedShare, remaining, daysLeft };
}

/** "about $290 a week", "about 1 every 2.6 weeks"; null when nothing is left or no time remains. */
export function goalRateLabel(goal: Pick<Goal, "unit">, remaining: number | null, daysLeft: number) {
  if (remaining === null || remaining <= 0 || daysLeft <= 0) return null;
  const weeks = daysLeft / 7;
  if (weeks <= 1) return null;
  const perWeek = remaining / weeks;
  // Just under one a week reads as "about 1 a week", never "1 every 1 weeks".
  if (goal.unit === "count" && perWeek < 0.95) {
    return `about 1 every ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(weeks / remaining)} weeks`;
  }
  return `about ${formatMetricValue(goal.unit === "count" ? Math.ceil(perWeek) : perWeek, goal.unit, "compact")} a week`;
}

function clampShare(value: number) {
  return Math.min(1, Math.max(0, value));
}

function addDays(day: string, days: number) {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

export function dayCount(from: string, to: string) {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1;
}

export function parseDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

export function formatDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export const metricEntrySchema = z.object({
  date: z.iso.date(),
  dimension: dimensionSchema,
  values: z.array(z.object({
    metricKey: z.string().regex(METRIC_KEY_PATTERN),
    value: z.number().finite().min(0).max(100_000_000_000_000),
  })).min(1, "Enter at least one number").max(20),
});

export const metricDeletionSchema = z.object({
  metricKey: z.string().regex(METRIC_KEY_PATTERN),
  date: z.iso.date(),
  dimension: dimensionSchema,
});

export const outreachVoidSchema = z.object({
  batchId: z.string().uuid(),
  reason: z.string().trim().min(3, "Add a short reason (at least 3 characters)").max(300),
});
