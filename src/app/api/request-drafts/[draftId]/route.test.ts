import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => {
    throw new Error("admin client should not be created");
  }),
}));
vi.mock("@/lib/request-drafts/delete-request-draft", () => ({
  deleteRequestDraftData: vi.fn(),
}));

import { DELETE } from "@/app/api/request-drafts/[draftId]/route";

describe("draft deletion body parsing", () => {
  it("rejects streamed request bodies over the limit without trusting Content-Length", async () => {
    const request = new Request("https://ajani.test/api/request-drafts/bfa16669-b62c-49e5-a356-9ac634a969bb", {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: "https://ajani.test" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4_097));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await DELETE(request, {
      params: Promise.resolve({ draftId: "bfa16669-b62c-49e5-a356-9ac634a969bb" }),
    });

    expect(response.status).toBe(413);
  });
});
