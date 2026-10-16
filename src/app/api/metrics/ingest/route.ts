import { keysMatch } from "@/lib/admin/session-token";
import { writeMetricValues } from "@/lib/connectors/connector-store";
import { INGEST_ACTOR, INGEST_MAX_BYTES, ingestKey, parseIngestBody } from "@/lib/connectors/ingest";

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
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > INGEST_MAX_BYTES) {
    return Response.json({ error: "Body too large." }, { status: 413, headers });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > INGEST_MAX_BYTES) return Response.json({ error: "Body too large." }, { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "The body is not valid JSON." }, { status: 400, headers });
  }

  const parsed = parseIngestBody(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return Response.json({ error: "Invalid values.", issues }, { status: 400, headers });
  }

  try {
    const written = await writeMetricValues(parsed.data.values, INGEST_ACTOR, Date.now() + 20_000);
    return Response.json({ written }, { headers });
  } catch {
    // Unknown or retired metrics, ratios and other store rules end here; no database detail is returned.
    console.error("Metric ingest rejected", { count: parsed.data.values.length });
    return Response.json({ error: "The values could not be saved. Check that each metric exists and is not calculated automatically." }, { status: 422, headers });
  }
}
