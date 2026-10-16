import { z } from "zod";
import type { MetricDefinition, MetricGrain, MetricSeriesQuery, MetricUnit } from "@/lib/admin/metric-types";

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

export const DEFAULT_TREND_METRICS = [
  "ajani.drafts_saved",
  "ajani.builds_submitted",
  "ajani.brief_to_build_rate",
  "outreach.touches",
  "outreach.reply_rate",
  "outreach.calls_booked",
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
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: style === "compact" && Math.abs(value) >= 100_000_00 ? "compact" : "standard",
      maximumFractionDigits: style === "compact" ? 0 : 2,
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
