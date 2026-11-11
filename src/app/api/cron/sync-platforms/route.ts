import { keysMatch } from "@/lib/admin/session-token";
import { syncAllConnectors } from "@/lib/connectors/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Nightly YouTube and Instagram sync. Results carry counts and reason tokens only. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !keysMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await syncAllConnectors({ deadlineAt: Date.now() + 50_000 });
    const summary = results.map(({ connector, status, reason, valuesWritten }) => ({ connector, status, reason, valuesWritten }));
    // Not configured is the expected state until settings are added.
    const healthy = results.every((result) => result.status === "synced" || result.status === "not_configured");
    if (healthy) console.info("Platform sync", summary);
    else console.error("Platform sync incomplete", summary);
    return Response.json({ results: summary }, { status: healthy ? 200 : 503 });
  } catch {
    console.error("Platform sync failed");
    return Response.json({ error: "Platform sync could not run." }, { status: 503 });
  }
}
