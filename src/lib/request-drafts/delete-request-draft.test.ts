import { describe, expect, it, vi } from "vitest";
import { deleteRequestDraftData, purgeDeletedDraftUploads } from "@/lib/request-drafts/delete-request-draft";
vi.mock("server-only", () => ({}));

describe("reserved draft deletion", () => {
  it("reserves the draft before Storage I/O and finishes only after removal", async () => {
    const order: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      order.push(name);
      return { data: name === "reserve_request_draft_deletion" ? [{ storage_paths: ["drafts/one/note.webm"] }] : null, error: null };
    });
    const remove = vi.fn(async () => { order.push("storage"); return { error: null }; });
    await expect(deleteRequestDraftData({ rpc, storage: { from: () => ({ remove }) } } as never, "draft", { tokenHash: "hash" }))
      .resolves.toEqual({ deletedUploads: 1 });
    expect(order).toEqual(["reserve_request_draft_deletion", "storage", "finish_request_draft_deletion"]);
    expect(rpc).toHaveBeenNthCalledWith(1, "reserve_request_draft_deletion", {
      p_draft_id: "draft", p_token_hash: "hash", p_expired_only: false,
    });
  });
  it("never touches Storage when submission won the reservation race", async () => {
    const error = { message: "draft_unavailable" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    const remove = vi.fn();
    await expect(deleteRequestDraftData({ rpc, storage: { from: () => ({ remove }) } } as never, "draft", { tokenHash: "hash" })).rejects.toBe(error);
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("keeps the reservation retryable if Storage is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ storage_paths: ["drafts/one/note.webm"] }], error: null });
    const error = new Error("storage unavailable");
    const remove = vi.fn().mockResolvedValue({ error });
    await expect(deleteRequestDraftData({ rpc, storage: { from: () => ({ remove }) } } as never, "draft", { expiredOnly: true })).rejects.toBe(error);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("treats an already deleted draft as an idempotent receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await expect(deleteRequestDraftData({ rpc } as never, "draft", { tokenHash: "hash" })).resolves.toEqual({ deletedUploads: 0 });
  });
});

describe("expired signed-upload purge outbox", () => {
  it("removes a replayed upload before finalizing the path-only receipt", async () => {
    const order: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      order.push(name);
      return { data: name === "claim_request_draft_upload_purges"
        ? [{ draft_id: "deleted-draft", storage_paths: ["drafts/deleted/note.webm"], attempt_count: 2 }] : true, error: null };
    });
    const remove = vi.fn(async () => { order.push("storage"); return { error: null }; });
    await expect(purgeDeletedDraftUploads({ rpc, storage: { from: () => ({ remove }) } } as never, { deadlineAt: Date.now() + 5_000 }))
      .resolves.toMatchObject({ completedPurges: 1, removedUploads: 1, failedPurges: 0, remainingInBatch: 0 });
    expect(order).toEqual(["claim_request_draft_upload_purges", "storage", "finish_request_draft_upload_purge"]);
    expect(rpc).toHaveBeenLastCalledWith("finish_request_draft_upload_purge", {
      p_draft_id: "deleted-draft", p_attempt: 2, p_succeeded: true,
    });
  });
  it("preserves retryable path work when delayed Storage removal fails", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ draft_id: "deleted", storage_paths: ["drafts/note.webm"], attempt_count: 3 }], error: null })
      .mockResolvedValue({ data: true, error: null });
    const remove = vi.fn().mockResolvedValue({ error: { message: "unavailable" } });
    await expect(purgeDeletedDraftUploads({ rpc, storage: { from: () => ({ remove }) } } as never, { deadlineAt: Date.now() + 5_000 }))
      .resolves.toMatchObject({ completedPurges: 0, failedPurges: 1, remainingInBatch: 1 });
    expect(rpc).toHaveBeenLastCalledWith("finish_request_draft_upload_purge", {
      p_draft_id: "deleted", p_attempt: 3, p_succeeded: false,
    });
  });
});
