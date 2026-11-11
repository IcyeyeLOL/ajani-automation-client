import { z } from "zod";
import { METRIC_KEY_PATTERN } from "@/lib/admin/metric-query";
import { loadMetricCatalog } from "@/lib/admin/metrics";
import { importableMetrics } from "@/lib/admin/report-import";
import { REPORT_COMPARE_DAYS, shiftDay } from "@/lib/admin/report-merge";
import { loadSavedValues } from "@/lib/admin/report-saved";
import { isSampleMode } from "@/lib/admin/sample-mode";
import { resolveAdminSession } from "@/lib/admin/session";

export const runtime = "nodejs";
export const maxDuration = 20;

const requestSchema = z.object({
  keys: z.array(z.string().regex(METRIC_KEY_PATTERN)).min(1).max(200),
  from: z.iso.date(),
  to: z.iso.date(),
}).refine((value) => value.from <= value.to, "from must not be after to");

/**
 * POST JSON { keys, from, to }: the numbers already saved for an import's
 * metrics and days, plus the same-named numbers of the other platforms (to spot
 * one platform's numbers saved on another). Read only. Lives under /admin so the
 * path-scoped admin session cookie is sent.
 */
export async function POST(request: Request) {
  const session = await resolveAdminSession();
  if (session.status === "forbidden") return json({ error: "Not found" }, 404);
  if (session.status !== "allowed") return json({ error: "Admin session required" }, 401);
  if (await isSampleMode()) return json({ error: "Sample data is on, so saved numbers can't be compared." }, 409);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "That request could not be read." }, 400);
  const catalog = await loadMetricCatalog();
  if (catalog.status !== "available") return json({ error: "Trends are unavailable right now." }, 503);

  const importable = importableMetrics(catalog.metrics);
  const requested = new Set(parsed.data.keys);
  const names = new Set([...requested].map((key) => key.slice(key.indexOf(".") + 1)));
  const metrics = importable.filter((metric) => requested.has(metric.key) || names.has(metric.key.slice(metric.key.indexOf(".") + 1)));
  try {
    const saved = await loadSavedValues(metrics.map((metric) => metric.key), shiftDay(parsed.data.from, -REPORT_COMPARE_DAYS), shiftDay(parsed.data.to, REPORT_COMPARE_DAYS));
    return json({
      saved,
      metrics: Object.fromEntries(metrics.map((metric) => [metric.key, { label: metric.label, unit: metric.unit, aggregation: metric.aggregation }])),
    }, 200);
  } catch (error) {
    console.error("[report-import] saved_values_unavailable", { code: error && typeof error === "object" && "code" in error ? String(error.code) : "unknown" });
    return json({ error: "The saved numbers couldn't be loaded, so this import can't be compared with them." }, 503);
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
