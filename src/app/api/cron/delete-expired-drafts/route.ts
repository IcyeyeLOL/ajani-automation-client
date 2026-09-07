import { deleteRequestDraftData, purgeDeletedDraftUploads } from "@/lib/request-drafts/delete-request-draft";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deadlineAt = Date.now() + 50_000;
    const admin = createSupabaseAdminClient();
    // Give delayed upload removal a bounded share before draft cleanup. Its
    // path-only outbox survives immediate content deletion and process death.
    const uploadPurges = await purgeDeletedDraftUploads(admin, { deadlineAt: Math.min(deadlineAt, Date.now() + 15_000) });
    const { data: drafts, error, count } = await withinDeadline(admin
      .from("request_drafts")
      .select("id", { count: "exact" })
      .lt("expires_at", new Date().toISOString())
      .is("claimed_by", null)
      .in("status", ["draft", "ready_to_submit", "expired"])
      .order("deletion_reserved_at", { ascending: true, nullsFirst: true })
      .order("expires_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(100), deadlineAt);
    if (error) throw error;

    let deletedDrafts = 0;
    let deletedUploads = 0;
    const failures: string[] = [];

    for (const draft of drafts ?? []) {
      if (Date.now() >= deadlineAt) break;
      try {
        const result = await deleteRequestDraftData(admin, draft.id, { expiredOnly: true, deadlineAt });
        deletedDrafts += 1;
        deletedUploads += result.deletedUploads;
      } catch {
        failures.push(draft.id);
      }
    }

    const result = { deletedDrafts, deletedUploads, failedDrafts: failures.length, uploadPurges,
      remainingInBatch: (drafts?.length ?? 0) - deletedDrafts,
      remaining: count === null ? null : Math.max(0, (count ?? drafts?.length ?? 0) - deletedDrafts),
      batchFull: drafts?.length === 100, deadlineReached: Date.now() >= deadlineAt };
    const incomplete = failures.length > 0 || result.deadlineReached || uploadPurges.failedPurges > 0 || uploadPurges.deadlineReached;
    if (incomplete) console.error("Expired draft cleanup incomplete", result);
    return Response.json(result, { status: incomplete ? 503 : 200 });
  } catch (error) {
    console.error("Expired draft cleanup failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "Cleanup could not run." }, { status: 503 });
  }
}
