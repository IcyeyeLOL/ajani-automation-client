import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  auth: vi.fn(),
  maybeSingle: vi.fn(),
  notification: vi.fn(),
  provision: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/clerk/config", () => ({ hasClerkCredentials: () => true }));
vi.mock("@/lib/clerk/provisioning", () => ({ provisionClerkWorkspace: mocks.provision }));
vi.mock("@/lib/notifications/build-request", () => ({
  processBuildRequestNotifications: mocks.notification,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mocks.maybeSingle }),
        }),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/request-drafts/claim/route";

const requestBody = {
  draftId: "bfa16669-b62c-49e5-a356-9ac634a969bb",
  draftToken: "valid-capability-token-that-is-long-enough-for-validation",
};

describe("draft claim route", () => {
  beforeEach(() => {
    mocks.after.mockReset();
    mocks.auth.mockReset();
    mocks.maybeSingle.mockReset();
    mocks.notification.mockReset();
    mocks.provision.mockReset();
    mocks.rpc.mockReset();
  });

  it("rejects signed-out callers before touching provisioning", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: false, userId: null, orgId: null });
    const response = await POST(makeRequest(requestBody));
    expect(response.status).toBe(401);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("verifies the draft capability before provisioning a workspace", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await POST(makeRequest(requestBody));
    expect(response.status).toBe(404);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("rejects streamed request bodies over the limit without trusting Content-Length", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    const request = new Request("https://ajani.test/api/request-drafts/claim", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://ajani.test" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4_097));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("returns a successful confirmation before the post-response notification runs", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: requestBody.draftId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        submitted_build_request_id: null,
      },
      error: null,
    });
    mocks.provision.mockResolvedValue({
      requiresActivation: false,
      organizationId: "4db505a8-5dc2-4a60-942d-366acc941255",
      clerkOrganizationId: "org_123",
    });
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ id: requestBody.draftId, status: "ready_to_submit" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ build_request_id: "709021e8-f748-4391-ae18-92513b7c340d" }],
        error: null,
      });
    let postResponseTask: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      postResponseTask = task;
    });
    mocks.notification.mockRejectedValue(new Error("provider unavailable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(makeRequest(requestBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "submitted" });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.notification).not.toHaveBeenCalled();

    await postResponseTask?.();

    expect(mocks.notification).toHaveBeenCalledWith(expect.objectContaining({
      buildRequestId: "709021e8-f748-4391-ae18-92513b7c340d",
      limit: 1,
    }));
    expect(consoleSpy).toHaveBeenCalledWith(
      "Post-response build request notification failed",
      expect.objectContaining({ buildRequestId: "709021e8-f748-4391-ae18-92513b7c340d" }),
    );
    consoleSpy.mockRestore();
  });
});

function makeRequest(body: unknown) {
  return new Request("https://ajani.test/api/request-drafts/claim", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://ajani.test" },
    body: JSON.stringify(body),
  });
}
