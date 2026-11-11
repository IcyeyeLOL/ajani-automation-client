import "server-only";

import type { SavedValue } from "@/lib/admin/report-diff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

/** The API returns at most 1,000 rows per request. */
const PAGE = 1_000;
const MAX_PAGES = 30;

/**
 * Saved numbers on the main account (the one imports write to) for these
 * metrics between two days, so an import can be compared with what is already
 * there. Who saved a number is never returned, only whether a sync wrote it.
 */
export async function loadSavedValues(keys: string[], from: string, to: string): Promise<SavedValue[]> {
  if (!keys.length) return [];
  const client = createSupabaseAdminClient();
  const deadlineAt = Date.now() + 8_000;
  const values: SavedValue[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await withinDeadline(client.from("analytics_metric_daily")
      .select("metric_key, metric_date, value, origin")
      .in("metric_key", keys)
      .eq("dimension_key", "")
      .gte("metric_date", from)
      .lte("metric_date", to)
      .order("metric_key")
      .order("metric_date")
      .range(page * PAGE, page * PAGE + PAGE - 1), deadlineAt);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ metric_key: string; metric_date: string; value: number | string; origin: string }>;
    for (const row of rows) values.push({ metricKey: row.metric_key, date: row.metric_date, value: Number(row.value), synced: row.origin !== "manual" });
    if (rows.length < PAGE) return values;
  }
  throw new Error("saved_values_too_many");
}
