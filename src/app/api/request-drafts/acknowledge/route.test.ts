import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createAdmin }));

import { POST } from "@/app/api/request-drafts/acknowledge/route";

const requestBody = {
  draftId: "bfa16669-b62c-49e5-a356-9ac634a969bb",
  draftToken: "valid-capability-token-that-is-long-enough-for-validation",
  legalAcceptanceAcknowledged: true,
  legalAcceptanceVersions: {
    noticeVersion: "handoff-notice-2026-09-02",
    acceptableUseVersion: "2026-09-02",
    privacyVersion: "2026-09-02",
    termsVersion: "2026-09-02",
  },
};

describe("saved request legal acknowledgment", () => {
  beforeEach(() => {
    mocks.createAdmin.mockReset();
  });

  it("rejects an unrecognized presented policy tuple before database access", async () => {
    const response = await POST(makeRequest({
      ...requestBody,
      legalAcceptanceVersions: {
        ...requestBody.legalAcceptanceVersions,
        termsVersion: "unknown-version",
      },
    }));

    expect(response.status).toBe(409);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("records a server-stamped acceptance through the atomic capability RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ draft_id: requestBody.draftId }],
      error: null,
    });
    mocks.createAdmin.mockReturnValue({ rpc });

    const response = await POST(makeRequest(requestBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "acknowledged" });
    expect(rpc).toHaveBeenCalledWith("acknowledge_request_draft", {
      p_draft_id: requestBody.draftId,
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_acceptance: {
        acknowledged: true,
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        action: "request_handoff",
        method: "affirmative_checkbox",
        ...requestBody.legalAcceptanceVersions,
      },
    });
  });
});

function makeRequest(body: unknown) {
  return new Request("https://ajani.test/api/request-drafts/acknowledge", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://ajani.test" },
    body: JSON.stringify(body),
  });
}
