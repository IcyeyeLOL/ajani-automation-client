import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createSupabaseAdminClient, deleteRequestDraftData, purgeDeletedDraftUploads } = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  deleteRequestDraftData: vi.fn(),
  purgeDeletedDraftUploads: vi.fn(async () => ({ completedPurges: 0, failedPurges: 0, deadlineReached: false })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));
vi.mock("@/lib/request-drafts/delete-request-draft", () => ({ deleteRequestDraftData, purgeDeletedDraftUploads }));

import { GET } from "@/app/api/cron/delete-expired-drafts/route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("expired request draft cleanup", () => {
  it("does not initialize the admin client without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "cleanup-secret");

    const response = await GET(new Request("https://ajani.test/api/cron/delete-expired-drafts"));

    expect(response.status).toBe(401);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("deletes only the expired draft IDs selected by the protected job", async () => {
    vi.stubEnv("CRON_SECRET", "cleanup-secret");
    const chain = {
      select: vi.fn(),
      lt: vi.fn(),
      is: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(async () => ({ data: [{ id: "expired-draft" }], error: null })),
    };
    chain.select.mockReturnValue(chain);
    chain.lt.mockReturnValue(chain);
    chain.is.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    createSupabaseAdminClient.mockReturnValue({ from: vi.fn(() => chain) });
    deleteRequestDraftData.mockResolvedValue({ deletedUploads: 1 });

    const response = await GET(new Request("https://ajani.test/api/cron/delete-expired-drafts", {
      headers: { authorization: "Bearer cleanup-secret" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ deletedDrafts: 1, deletedUploads: 1, failedDrafts: 0 });
    expect(deleteRequestDraftData).toHaveBeenCalledWith(expect.any(Object), "expired-draft", { expiredOnly: true, deadlineAt: expect.any(Number) });
  });
  it("returns observable failure when every selected cleanup fails", async () => {
    vi.stubEnv("CRON_SECRET", "cleanup-secret");
    const chain = { select: vi.fn(), lt: vi.fn(), is: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn() };
    for (const method of [chain.select,chain.lt,chain.is,chain.in,chain.order]) method.mockReturnValue(chain);
    chain.limit.mockResolvedValue({ data: [{ id: "expired" }], count: 1, error: null });
    createSupabaseAdminClient.mockReturnValue({ from: () => chain });
    deleteRequestDraftData.mockRejectedValue(new Error("storage unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(new Request("https://ajani.test/api/cron/delete-expired-drafts", {
      headers: { authorization: "Bearer cleanup-secret" },
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ failedDrafts: 1, deletedDrafts: 0, remaining: 1 });
    log.mockRestore();
  });
});
