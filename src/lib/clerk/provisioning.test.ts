import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clerkClient: vi.fn(),
  profileUpsert: vi.fn(),
  organizationMaybeSingle: vi.fn(),
  membershipUpsert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: mocks.clerkClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") return { upsert: mocks.profileUpsert };
      if (table === "organizations") {
        return { select: () => ({ eq: () => ({ maybeSingle: mocks.organizationMaybeSingle }) }) };
      }
      if (table === "organization_members") return { upsert: mocks.membershipUpsert };
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { provisionClerkWorkspace } from "@/lib/clerk/provisioning";

describe("Clerk workspace provisioning", () => {
  beforeEach(() => {
    mocks.clerkClient.mockReset();
    mocks.profileUpsert.mockReset().mockResolvedValue({ error: null });
    mocks.organizationMaybeSingle.mockReset().mockResolvedValue({ data: { id: "workspace-123" }, error: null });
    mocks.membershipUpsert.mockReset().mockResolvedValue({ error: null });
  });

  it("persists the signed-in user's email and available phone for the handoff", async () => {
    mocks.clerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          firstName: "Jordan",
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

    expect(mocks.profileUpsert).toHaveBeenCalledWith(expect.objectContaining({
      id: "user-1",
      email: "jordan@example.com",
      phone: "+13125550148",
    }), { onConflict: "id" });
  });
});
