import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Reserve under the submission row lock before any irreversible Storage I/O.
 * A failed removal leaves a reserved draft that cron or a capability replay can
 * safely retry; it can no longer be claimed or submitted.
 * The reservation also persists path-only delayed purge work to collect an
 * outstanding signed upload that completes after this immediate removal.
 */
export async function deleteRequestDraftData(admin: AdminClient, draftId: string, options: { tokenHash?: string; expiredOnly?: boolean; deadlineAt?: number } = {}) {
  const deadlineAt = options.deadlineAt ?? Date.now() + 45_000;
  if (Date.now() >= deadlineAt) throw new Error("operation_deadline_exceeded");
  const { data, error } = await withinDeadline(admin.rpc("reserve_request_draft_deletion", {
    p_draft_id: draftId,
    p_token_hash: options.tokenHash ?? null,
    p_expired_only: options.expiredOnly ?? false,
  }), deadlineAt);
  if (error) throw error;
  const reserved = Array.isArray(data) ? data[0] : data;
  if (!reserved) return { deletedUploads: 0 };
  const storagePaths = (Array.isArray(reserved.storage_paths) ? reserved.storage_paths : [])
    .filter((path: unknown): path is string => typeof path === "string" && path.length > 0);

  if (storagePaths.length > 0) {
    if (Date.now() >= deadlineAt) throw new Error("operation_deadline_exceeded");
    const { error: storageError } = await withinDeadline(admin.storage.from("voice-memos").remove(storagePaths), deadlineAt);
    if (storageError) throw storageError;
  }

  if (Date.now() >= deadlineAt) throw new Error("operation_deadline_exceeded");
  const { error: draftError } = await withinDeadline(admin.rpc("finish_request_draft_deletion", { p_draft_id: draftId }), deadlineAt);
  if (draftError) throw draftError;

  return { deletedUploads: storagePaths.length };
}

type UploadPurge = { draft_id: string; storage_paths: unknown; attempt_count: number };

/** Sweep only expired upload capabilities; content was removed independently. */
export async function purgeDeletedDraftUploads(admin: AdminClient, options: { deadlineAt: number; limit?: number }) {
  if (Date.now() >= options.deadlineAt) throw new Error("operation_deadline_exceeded");
  const { data, error } = await withinDeadline(admin.rpc("claim_request_draft_upload_purges", {
    p_limit: Math.min(100, Math.max(1, options.limit ?? 100)),
  }), options.deadlineAt);
  if (error) throw error;
  const jobs: UploadPurge[] = Array.isArray(data) ? data : [];
  let completedPurges = 0;
  let failedPurges = 0;
  let removedUploads = 0;
  for (const job of jobs) {
    if (Date.now() >= options.deadlineAt) break;
    const paths = (Array.isArray(job.storage_paths) ? job.storage_paths : [])
      .filter((path: unknown): path is string => typeof path === "string" && path.length > 0);
    try {
      const { error: storageError } = await withinDeadline(admin.storage.from("voice-memos").remove(paths), options.deadlineAt);
      if (storageError) throw storageError;
      if (Date.now() >= options.deadlineAt) throw new Error("operation_deadline_exceeded");
      const { data: finished, error: finishError } = await withinDeadline(admin.rpc("finish_request_draft_upload_purge", {
        p_draft_id: job.draft_id, p_attempt: job.attempt_count, p_succeeded: true,
      }), options.deadlineAt);
      if (finishError) throw finishError;
      if (finished) {
        completedPurges += 1;
        removedUploads += paths.length;
      }
    } catch {
      failedPurges += 1;
      // Claim already persisted a retry window. Failure reporting is best
      // effort, but it must not delay the cron response past its budget.
      if (Date.now() < options.deadlineAt) {
        await withinDeadline(admin.rpc("finish_request_draft_upload_purge", {
          p_draft_id: job.draft_id, p_attempt: job.attempt_count, p_succeeded: false,
        }), options.deadlineAt).catch(() => undefined);
      }
    }
  }
  return { completedPurges, failedPurges, removedUploads,
    remainingInBatch: jobs.length - completedPurges, batchFull: jobs.length === (options.limit ?? 100),
    deadlineReached: Date.now() >= options.deadlineAt };
}
