import { syncDripifyMetrics } from "@/lib/connectors/dripify";
import { keysMatch } from "@/lib/admin/session-token";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !keysMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 50_000 });
    // Not configured is the expected state until the key is added; anything
    // else short of a full sync is surfaced as a failed run.
    const healthy = result.status === "synced" || result.status === "not_configured";
    if (healthy) console.info("Dripify sync", result);
    else console.error("Dripify sync incomplete", result);
    return Response.json(result, { status: healthy ? 200 : 503 });
  } catch (error) {
    console.error("Dripify sync failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "Dripify sync could not run." }, { status: 503 });
  }
}
