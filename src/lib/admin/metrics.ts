import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/admin/session";
import { withinDeadline } from "@/lib/operations/deadline";
import type {
  Goal, GoalBoard, MetricBucket, MetricCatalog, MetricDefinition, MetricEntry, MetricGrain, MetricSeries, MetricSeriesQuery, MetricSeriesResult,
} from "@/lib/admin/metric-types";

type Row = Record<string, unknown>;

export async function loadMetricCatalog(): Promise<MetricCatalog> {
  // The DAL authorizes independently of the layout, which can render in parallel.
  // Outside the try: an auth redirect must never be reported as "unavailable".
  await requireAdminSession();
  const connectors = { dripify: Boolean(process.env.DRIPIFY_API_KEY?.trim()) };
  try {
    const { data, error } = await withinDeadline(createSupabaseAdminClient().rpc("load_analytics_catalog"), Date.now() + 8_000);
    if (error) throw error;
    return { ...shapeMetricCatalog(data), connectors };
  } catch (error) {
    console.error("Metric catalog unavailable", { code: errorCode(error) });
    return { status: "unavailable", today: new Date().toISOString().slice(0, 10), metrics: [], recentEntries: [], dimensionLabels: {}, connectors };
  }
}

export async function loadGoalBoard(): Promise<GoalBoard> {
  await requireAdminSession();
  try {
    const { data, error } = await withinDeadline(createSupabaseAdminClient().rpc("load_analytics_goals"), Date.now() + 8_000);
    if (error) throw error;
    return shapeGoalBoard(data);
  } catch (error) {
    console.error("Growth goals unavailable", { code: errorCode(error) });
    const today = new Date().toISOString().slice(0, 10);
    return { status: "unavailable", today, weekStart: today, goals: [] };
  }
}

/** Callers authorize first (the series route uses the non-redirecting check). */
export async function loadMetricSeries(query: MetricSeriesQuery): Promise<MetricSeriesResult> {
  const { data, error } = await withinDeadline(createSupabaseAdminClient().rpc("load_analytics_series", {
    p_metric_keys: query.metrics,
    p_grain: query.grain,
    p_from: query.from,
    p_to: query.to,
    p_dimension: query.dimension,
  }), Date.now() + 10_000);
  if (error) throw error;
  return shapeMetricSeries(data);
}

export function shapeMetricCatalog(raw: unknown): MetricCatalog {
  const payload = objectValue(raw);
  if (!Array.isArray(payload.metrics) || typeof payload.today !== "string") throw new Error("metric_catalog_incomplete");
  return {
    status: "available",
    today: payload.today,
    metrics: rows(payload.metrics).map((row): MetricDefinition => ({
      key: stringValue(row.metric_key),
      source: stringValue(row.source),
      category: oneOf(row.category, ["business", "outreach", "content", "revenue"], "business"),
      label: stringValue(row.label),
      description: stringValue(row.description),
      unit: oneOf(row.unit, ["count", "currency_cents", "hours", "ratio"], "count"),
      aggregation: oneOf(row.aggregation, ["sum", "last", "ratio"], "sum"),
      numeratorKey: nullableString(row.numerator_key),
      denominatorKey: nullableString(row.denominator_key),
      entryMode: oneOf(row.entry_mode, ["derived", "manual", "connector"], "derived"),
      higherIsBetter: row.higher_is_better !== false,
      chartable: row.chartable !== false,
      firstDate: nullableString(row.first_date),
      lastDate: nullableString(row.last_date),
      dimensions: Array.isArray(row.dimensions) ? row.dimensions.filter((item): item is string => typeof item === "string") : [],
    })).filter((metric) => metric.key),
    recentEntries: rows(payload.recent_entries).map((row): MetricEntry => ({
      metricKey: stringValue(row.metric_key),
      date: stringValue(row.metric_date),
      dimension: stringValue(row.dimension_key),
      value: numberOrNull(row.value) ?? 0,
      recordedAt: stringValue(row.recorded_at),
    })),
    // Absent before the Dripify connector migration: keys then show as-is.
    dimensionLabels: Object.fromEntries(Object.entries(objectValue(payload.dimension_labels))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)),
    connectors: { dripify: false },
  };
}

export function shapeGoalBoard(raw: unknown): GoalBoard {
  const payload = objectValue(raw);
  if (!Array.isArray(payload.goals) || typeof payload.today !== "string") throw new Error("goal_board_incomplete");
  return {
    status: "available",
    today: payload.today,
    weekStart: stringValue(payload.week_start) || payload.today,
    goals: rows(payload.goals).flatMap((row): Goal[] => {
      const target = numberOrNull(row.target);
      const key = stringValue(row.goal_key);
      const startDate = stringValue(row.start_date);
      if (!key || !startDate || target === null || target <= 0) return [];
      return [{
        key,
        metricKey: stringValue(row.metric_key),
        label: stringValue(row.label),
        description: stringValue(row.description),
        measure: oneOf(row.measure, ["total", "latest", "weekly"], "total"),
        unit: oneOf(row.unit, ["count", "currency_cents", "hours", "ratio"], "count"),
        entryMode: oneOf(row.entry_mode, ["derived", "manual", "connector"], "manual"),
        target,
        startDate,
        dueDate: nullableString(row.due_date),
        current: numberOrNull(row.current),
        baseline: numberOrNull(row.baseline),
        lastWeek: numberOrNull(row.last_week),
        lastRecorded: nullableString(row.last_recorded),
      }];
    }),
  };
}

export function shapeMetricSeries(raw: unknown): MetricSeriesResult {
  const payload = objectValue(raw);
  if (!Array.isArray(payload.buckets) || !Array.isArray(payload.series)) throw new Error("metric_series_incomplete");
  const buckets = rows(payload.buckets).map((row): MetricBucket => ({
    start: stringValue(row.start),
    end: stringValue(row.end),
    partial: row.partial === true,
  }));
  const valuesFor = (value: unknown) => Array.from({ length: buckets.length }, (_, index) => numberOrNull(Array.isArray(value) ? value[index] : null));
  return {
    grain: oneOf<MetricGrain>(payload.grain, ["day", "week", "month", "quarter", "year"], "week"),
    from: stringValue(payload.from),
    to: stringValue(payload.to),
    previousFrom: stringValue(payload.previous_from),
    previousTo: stringValue(payload.previous_to),
    today: stringValue(payload.today),
    dimension: nullableString(payload.dimension),
    buckets,
    series: rows(payload.series).map((row): MetricSeries => ({
      metricKey: stringValue(row.metric_key),
      values: valuesFor(row.values),
      numerators: Array.isArray(row.numerators) ? valuesFor(row.numerators) : null,
      denominators: Array.isArray(row.denominators) ? valuesFor(row.denominators) : null,
      current: numberOrNull(row.current),
      previous: numberOrNull(row.previous),
      currentNumerator: numberOrNull(row.current_numerator),
      currentDenominator: numberOrNull(row.current_denominator),
      previousNumerator: numberOrNull(row.previous_numerator),
      previousDenominator: numberOrNull(row.previous_denominator),
      coverageFrom: nullableString(row.coverage_from),
    })),
  };
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

/** Postgres numerics may arrive as JSON numbers or numeric strings. */
function numberOrNull(value: unknown) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? error.code : "metrics_unavailable";
}
