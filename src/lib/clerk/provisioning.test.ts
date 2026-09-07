import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clerkClient: vi.fn(),
  rpc: vi.fn(),
  organizationMaybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: mocks.clerkClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "organizations") {
        return { select: () => ({ eq: () => ({ maybeSingle: mocks.organizationMaybeSingle }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { provisionClerkWorkspace } from "@/lib/clerk/provisioning";

describe("Clerk workspace provisioning", () => {
  beforeEach(() => {
    mocks.clerkClient.mockReset();
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    mocks.organizationMaybeSingle.mockReset().mockResolvedValue({ data: { id: "workspace-123" }, error: null });
  });

  it("persists the signed-in user's email and available phone for the handoff", async () => {
    mocks.clerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          firstName: "Jordan",
          updatedAt: new Date("2026-09-05T12:00:00Z"),
          lastName: "Morgan",
          imageUrl: "https://images.example/jordan.png",
          primaryEmailAddressId: "email-1",
          emailAddresses: [{ id: "email-1", emailAddress: "jordan@example.com" }],
          primaryPhoneNumberId: null,
          phoneNumbers: [{ id: "phone-1", phoneNumber: "+13125550148" }],
        }),
        getOrganizationMembershipList: vi.fn().mockResolvedValue({
          data: [{
            id: "membership-1",
            updatedAt: new Date("2026-09-05T12:00:00Z"),
            role: "org:admin",
            organization: {
              id: "org-1",
              name: "Northstar Home Services",
              slug: "northstar-home-services",
              imageUrl: "https://images.example/northstar.png",
            },
          }],
        }),
      },
      organizations: {},
    });

    await provisionClerkWorkspace("user-1", null);

    expect(mocks.rpc).toHaveBeenCalledWith("sync_clerk_profile", expect.objectContaining({
      p_id: "user-1", p_email: "jordan@example.com", p_phone: "+13125550148",
      p_event_at: "2026-09-05T12:00:00.000Z", p_deleted: false,
    }));
    expect(mocks.rpc).toHaveBeenCalledWith("sync_clerk_membership", expect.objectContaining({
      p_organization_id: "workspace-123", p_deleted: false, p_event_at: "2026-09-05T12:00:00.000Z",
    }));
  });
});
