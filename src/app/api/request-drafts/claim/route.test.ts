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

const legalAcceptance = {
  acknowledged: true,
  acceptedAt: "2026-09-02T12:00:00.000Z",
  action: "request_handoff",
  method: "affirmative_checkbox",
  noticeVersion: "handoff-notice-2026-09-02",
  acceptableUseVersion: "2026-09-02",
  privacyVersion: "2026-09-02",
  termsVersion: "2026-09-02",
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

  it("refuses to provision or submit a draft without current legal acceptance", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: requestBody.draftId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        submitted_build_request_id: null,
        payload: {},
      },
      error: null,
    });

    const response = await POST(makeRequest(requestBody));

    expect(response.status).toBe(428);
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when an acceptance contains an unknown policy version", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: requestBody.draftId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        submitted_build_request_id: null,
        payload: {
          legalAcceptance: { ...legalAcceptance, termsVersion: "unknown-version" },
        },
      },
      error: null,
    });

    const response = await POST(makeRequest(requestBody));

    expect(response.status).toBe(428);
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns review-required when the database catches an acceptance race", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: requestBody.draftId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        submitted_build_request_id: null,
        payload: { legalAcceptance },
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
        data: null,
        error: { message: "handoff_acceptance_required" },
      });

    const response = await POST(makeRequest(requestBody));

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toEqual({
      error: "Review and accept the current Terms, Acceptable Use Policy, and Privacy Policy before sending this request.",
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("returns a successful confirmation before the post-response notification runs", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: requestBody.draftId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        submitted_build_request_id: null,
        payload: { legalAcceptance },
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

describe("submitted receipt replay", () => {
  it("returns an expired submitted draft's receipt without requiring new acceptance", async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "user_123", orgId: "org_123" });
    mocks.maybeSingle.mockResolvedValue({ data: {
      id: requestBody.draftId, expires_at: "2025-01-01", submitted_build_request_id: "build-1",
      claimed_by: "user_123", organization_id: "workspace-1", payload: {},
    }, error: null });
    mocks.provision.mockResolvedValue({ requiresActivation: false, organizationId: "workspace-1", clerkOrganizationId: "org_123" });
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: requestBody.draftId, status: "submitted" }], error: null })
      .mockResolvedValueOnce({ data: [{ build_request_id: "build-1" }], error: null });
    const response = await POST(makeRequest(requestBody));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "submitted", buildRequest: { build_request_id: "build-1" } });
  });
  it("does not reveal a receipt to a different capability holder's account", async () => {
    mocks.provision.mockClear();
    mocks.auth.mockResolvedValue({ isAuthenticated: true, userId: "other-user", orgId: "org_123" });
    mocks.maybeSingle.mockResolvedValue({ data: { id: requestBody.draftId, claimed_by: "owner-user", submitted_build_request_id: "build-1" }, error: null });
    expect((await POST(makeRequest(requestBody))).status).toBe(404);
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});

function makeRequest(body: unknown) {
  return new Request("https://ajani.test/api/request-drafts/claim", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://ajani.test" },
    body: JSON.stringify(body),
  });
}
