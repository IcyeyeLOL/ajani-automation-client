import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Removes private Storage objects before deleting their database owner. The
 * database cascades delete voice-memo metadata and queued processing jobs.
 */
export async function deleteRequestDraftData(admin: AdminClient, draftId: string) {
  const { data: memos, error: memoError } = await admin
    .from("voice_memos")
    .select("storage_path")
    .eq("request_draft_id", draftId);
  if (memoError) throw memoError;

  const storagePaths = (memos ?? [])
    .map((memo) => memo.storage_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);

  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage.from("voice-memos").remove(storagePaths);
    if (storageError) throw storageError;
  }

  const { error: draftError } = await admin.from("request_drafts").delete().eq("id", draftId);
  if (draftError) throw draftError;

  return { deletedUploads: storagePaths.length };
}
