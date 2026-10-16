import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

export type ConnectorId = "youtube" | "instagram";
export type ConnectorStatus = "synced" | "partial" | "not_configured" | "rejected";

/** Reasons are fixed tokens; they map to plain-language messages and never carry provider text. */
export type ConnectorReason =
  | "invalid_credentials"
  | "token_expired"
  | "permission_missing"
  | "access_not_approved"
  | "account_not_found"
  | "rate_limited"
  | "deadline"
  | "failures"
  | "save_failed"
  | "vault_missing";

export type ConnectorResult = {
  connector: ConnectorId;
  status: ConnectorStatus;
  reason: ConnectorReason | null;
  /** UTC day the run is recorded under. */
  date: string;
  valuesWritten: number;
  /** Plain counts for the control desk, e.g. { days: 3, posts: 12 }. */
  details: Record<string, number>;
};

export type MetricValue = { metricKey: string; date: string; dimension?: string; value: number };
/** Injectable so tests and fake-data runs never touch the live database. */
export type MetricWriter = (values: MetricValue[], actor: string, deadlineAt: number) => Promise<number>;
export type RunRecorder = (result: ConnectorResult) => Promise<void>;

const UPSERT_CHUNK = 500;

export const writeMetricValues: MetricWriter = async (values, actor, deadlineAt) => {
  if (!values.length) return 0;
  const admin = createSupabaseAdminClient();
  let written = 0;
  for (let index = 0; index < values.length; index += UPSERT_CHUNK) {
    const { data, error } = await withinDeadline(admin.rpc("upsert_analytics_metric_values", {
      p_values: values.slice(index, index + UPSERT_CHUNK), p_origin: "connector", p_actor: actor,
    }), deadlineAt);
    if (error) throw new Error("metric_write_failed");
    written += Number(data) || 0;
  }
  return written;
};

/** Writes and returns the count, or null when the store refused the values (unknown metric, migration missing). */
export async function writeValues(write: MetricWriter | undefined, values: MetricValue[], actor: string, deadlineAt: number) {
  if (!values.length) return 0;
  try {
    return await (write ?? writeMetricValues)(values, actor, deadlineAt);
  } catch {
    return null;
  }
}

/** Best effort: the run log explains outcomes on the control desk; a failed log never fails a sync. */
export const recordConnectorRun: RunRecorder = async (result) => {
  try {
    const { error } = await withinDeadline(createSupabaseAdminClient().rpc("record_analytics_connector_run", {
      p_connector: result.connector,
      p_status: result.status,
      p_reason: result.reason,
      p_values_written: result.valuesWritten,
    }), Date.now() + 5_000);
    if (error) throw error;
  } catch {
    console.error("Connector run could not be recorded", { connector: result.connector });
  }
};

export function utcDay(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A whole, non-negative number the store accepts; anything else is unknown, never zero. */
export function wholeCount(value: unknown) {
  const number = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/**
 * Items per day from a newest-first listing (uploads, posts). A complete listing
 * makes every day in the window a fact, zeros included. A listing cut short is
 * only certain for days after the oldest item seen: that day itself may
 * continue on the unread page, so it and everything older stay unknown.
 */
export function countPerDay(metricKey: string, firstDay: string, lastDay: string, seenDays: string[], complete: boolean): MetricValue[] {
  const counts = new Map<string, number>();
  for (const day of seenDays) if (day >= firstDay && day <= lastDay) counts.set(day, (counts.get(day) ?? 0) + 1);
  const oldest = seenDays.reduce<string | null>((min, day) => (min === null || day < min ? day : min), null);
  const values: MetricValue[] = [];
  for (let day = firstDay; day <= lastDay; day = shiftDay(day, 1)) {
    if (complete || (oldest !== null && day > oldest)) values.push({ metricKey, date: day, value: counts.get(day) ?? 0 });
  }
  return values;
}

export function env(name: string, source: Record<string, string | undefined> = process.env) {
  const value = source[name]?.trim();
  return value ? value : null;
}
