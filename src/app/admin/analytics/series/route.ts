import { resolveAdminSession } from "@/lib/admin/session";
import { parseMetricSeriesQuery } from "@/lib/admin/metric-query";
import { loadMetricSeries } from "@/lib/admin/metrics";
import { isSampleMode } from "@/lib/admin/sample-mode";

export const runtime = "nodejs";

// Lives under /admin so the path-scoped admin session cookie is sent.
export async function GET(request: Request) {
  const session = await resolveAdminSession();
  if (session.status === "forbidden") return json({ error: "Not found" }, 404);
  if (session.status !== "allowed") return json({ error: "Admin session required" }, 401);

  const query = parseMetricSeriesQuery(new URL(request.url).searchParams);
  if (!query.success) return json({ error: query.error.issues[0]?.message || "Check the trend query." }, 400);

  // The desk builds sample trends in the browser and never asks here while
  // sample data is on, so such a request comes from a tab still showing real
  // numbers: it gets an error, never made-up series it would chart as real.
  if (await isSampleMode()) return json({ error: "Sample data was switched on in another tab. Refresh the page to see it." }, 409);

  try {
    return json(await loadMetricSeries(query.data), 200);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "series_unavailable";
    console.error("Metric series unavailable", { code });
    // Validation errors raised by the RPC (P0001) are the caller's to fix.
    return code === "P0001"
      ? json({ error: error && typeof error === "object" && "message" in error ? String(error.message) : "Invalid trend query." }, 400)
      : json({ error: "Trends are unavailable. Check the analytics migration and database connection." }, 503);
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
