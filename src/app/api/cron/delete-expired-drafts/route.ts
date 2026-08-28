import { deleteRequestDraftData } from "@/lib/request-drafts/delete-request-draft";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: drafts, error } = await admin
      .from("request_drafts")
      .select("id")
      .lt("expires_at", new Date().toISOString())
      .is("claimed_by", null)
      .in("status", ["draft", "ready_to_submit"])
      .limit(100);
    if (error) throw error;

    let deletedDrafts = 0;
    let deletedUploads = 0;
    const failures: string[] = [];

    for (const draft of drafts ?? []) {
      try {
        const result = await deleteRequestDraftData(admin, draft.id);
        deletedDrafts += 1;
        deletedUploads += result.deletedUploads;
      } catch {
        failures.push(draft.id);
      }
    }

    return Response.json({ deletedDrafts, deletedUploads, failedDrafts: failures.length });
  } catch (error) {
    console.error("Expired draft cleanup failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "Cleanup could not run." }, { status: 503 });
  }
}
