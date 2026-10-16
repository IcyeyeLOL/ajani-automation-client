import { keysMatch } from "@/lib/admin/session-token";
import { writeMetricValues } from "@/lib/connectors/connector-store";
import { readCapped } from "@/lib/connectors/provider-http";
import { INGEST_ACTOR, INGEST_MAX_BYTES, ingestIssues, ingestKey, parseIngestBody, parseIngestJson } from "@/lib/connectors/ingest";

export const runtime = "nodejs";
export const maxDuration = 30;

const headers = { "cache-control": "no-store" };

/**
 * POST {"values":[{"metricKey":"reddit.dms_sent","date":"2026-10-16","value":12}]}
 * with "Authorization: Bearer <AJANI_METRICS_INGEST_KEY>". Server-to-server only:
 * no CORS, no cookies, and the route reads as missing while ingest is off.
 */
export async function POST(request: Request) {
  const key = ingestKey();
  if (!key) return Response.json({ error: "Not found" }, { status: 404, headers });
  if (!keysMatch(request.headers.get("authorization") ?? "", `Bearer ${key}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send JSON (Content-Type: application/json)." }, { status: 415, headers });
  }
  let body: unknown;
  try {
    // Stops reading at the cap, declared or streamed, counting bytes.
    const text = await readCapped(request, INGEST_MAX_BYTES);
    if (text === null) return Response.json({ error: "Body too large." }, { status: 413, headers });
    body = parseIngestJson(text);
  } catch {
    return Response.json({ error: "The body is not valid JSON." }, { status: 400, headers });
  }

  const parsed = parseIngestBody(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid values.", issues: ingestIssues(parsed.error.issues) }, { status: 400, headers });
  }

  try {
    const written = await writeMetricValues(parsed.data.values, INGEST_ACTOR, Date.now() + 20_000, "manual");
    return Response.json({ written }, { headers });
  } catch {
    // Unknown or retired metrics, ratios, connector-only metrics and other store rules end here; no database detail is returned.
    console.error("Metric ingest rejected", { count: parsed.data.values.length });
    return Response.json({ error: "The values could not be saved. Check that each metric exists, can be logged by hand, and is not calculated automatically." }, { status: 422, headers });
  }
}
