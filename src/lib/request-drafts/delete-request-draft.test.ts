import { describe, expect, it, vi } from "vitest";
import { deleteRequestDraftData } from "@/lib/request-drafts/delete-request-draft";

vi.mock("server-only", () => ({}));

describe("deleteRequestDraftData", () => {
  it("removes private uploads before deleting the draft row", async () => {
    const order: string[] = [];
    const remove = vi.fn(async (paths: string[]) => {
      order.push(`storage:${paths.join(",")}`);
      return { error: null };
    });
    const admin = {
      from(table: string) {
        if (table === "voice_memos") {
          return {
            select: () => ({
              eq: async () => ({ data: [{ storage_path: "drafts/one/note.webm" }], error: null }),
            }),
          };
        }
        return {
          delete: () => ({
            eq: async () => {
              order.push("database:draft");
              return { error: null };
            },
          }),
        };
      },
      storage: { from: () => ({ remove }) },
    };

    await expect(deleteRequestDraftData(admin as never, "draft-id")).resolves.toEqual({ deletedUploads: 1 });
    expect(order).toEqual(["storage:drafts/one/note.webm", "database:draft"]);
  });

  it("does not delete the database row when private Storage removal fails", async () => {
    const deleteDraft = vi.fn();
    const storageError = new Error("storage unavailable");
    const admin = {
      from(table: string) {
        if (table === "voice_memos") {
          return {
            select: () => ({
              eq: async () => ({ data: [{ storage_path: "drafts/one/note.webm" }], error: null }),
            }),
          };
        }
        return { delete: deleteDraft };
      },
      storage: { from: () => ({ remove: async () => ({ error: storageError }) }) },
    };

    await expect(deleteRequestDraftData(admin as never, "draft-id")).rejects.toBe(storageError);
    expect(deleteDraft).not.toHaveBeenCalled();
  });
});
