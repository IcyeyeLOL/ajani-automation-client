import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: mocks.verifyWebhook }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { POST } from "@/app/api/webhooks/clerk/route";

beforeEach(() => {
  vi.stubEnv("CLERK_WEBHOOK_SECRET", "webhook-secret");
  mocks.verifyWebhook.mockReset();
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("Clerk webhook ledger", () => {
  it("acknowledges an already-claimed delivery without replaying mutations", async () => {
    mocks.verifyWebhook.mockResolvedValue(userEvent());
    mocks.rpc.mockResolvedValueOnce({ data: { state: "completed", attempt: 1 }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_clerk_webhook_delivery_v2", {
      p_event_id: "evt_123",
      p_event_type: "user.updated",
    });
  });

  it("syncs with the provider timestamp and marks the ledger complete", async () => {
    mocks.verifyWebhook.mockResolvedValue(userEvent());
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: "claimed", attempt: 2 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "sync_clerk_profile", expect.objectContaining({
      p_id: "user_123",
      p_event_at: "2026-08-25T20:00:00.000Z",
      p_deleted: false,
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "finish_clerk_webhook_delivery_v2", {
      p_event_id: "evt_123",
      p_attempt: 2,
      p_error: null,
    });
  });
});

describe("webhook recovery", () => {
  it("returns a retryable response for a leased but unfinished delivery", async () => {
    mocks.verifyWebhook.mockResolvedValue(userEvent());
    mocks.rpc.mockResolvedValueOnce({ data: { state: "busy", attempt: 1 }, error: null });
    const response = await POST(makeRequest());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("records a deletion tombstone even before membership creation arrives", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "organizationMembership.deleted", timestamp: 1787688000000, data: { id: "membership_123" } });
    mocks.rpc.mockResolvedValueOnce({ data: { state: "claimed", attempt: 1 }, error: null }).mockResolvedValue({ data: true, error: null });
    expect((await POST(makeRequest())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_clerk_deletion", {
      p_entity_kind: "membership", p_provider_id: "membership_123", p_event_at: "2026-08-25T20:00:00.000Z",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not acknowledge a superseded completion attempt", async () => {
    mocks.verifyWebhook.mockResolvedValue(userEvent());
    mocks.rpc.mockResolvedValueOnce({ data: { state: "claimed", attempt: 1 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(makeRequest())).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_clerk_webhook_delivery_v2", {
      p_event_id: "evt_123", p_attempt: 1, p_error: null,
    });
  });
  it("carries the owned attempt when recording failure", async () => {
    mocks.verifyWebhook.mockResolvedValue(userEvent());
    mocks.rpc.mockResolvedValueOnce({ data: { state: "claimed", attempt: 3 }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("sync_failed") })
      .mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(makeRequest())).status).toBe(503);
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_clerk_webhook_delivery_v2", {
      p_event_id: "evt_123", p_attempt: 3, p_error: "sync_failed",
    });
  });
});

function makeRequest() {
  return new Request("https://ajani.test/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "evt_123",
      "svix-timestamp": "1787688000",
      "svix-signature": "v1,test",
    },
    body: "{}",
  }) as never;
}

function userEvent() {
  return {
    type: "user.updated",
    data: {
      id: "user_123",
      first_name: "Aja",
      last_name: "Ni",
      image_url: "https://images.example/avatar.png",
      primary_email_address_id: "email_123",
      primary_phone_number_id: "phone_123",
      email_addresses: [{ id: "email_123", email_address: "client@example.com" }],
      phone_numbers: [{ id: "phone_123", phone_number: "+15555550123" }],
      updated_at: Date.parse("2026-08-25T20:00:00.000Z"),
    },
  };
}
