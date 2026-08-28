import { describe, expect, it } from "vitest";
import { getAdminAllowlist, isAdminIdentityAllowed } from "@/lib/admin/authorization";

describe("admin identity authorization", () => {
  it("accepts configured Clerk IDs and case-insensitive email addresses", () => {
    const allowlist = getAdminAllowlist({
      AJANI_ADMIN_USER_ID_ALLOWLIST: "user_admin,user_backup",
      AJANI_ADMIN_EMAIL_ALLOWLIST: "Owner@Ajani.test",
    });
    expect(isAdminIdentityAllowed({ userId: "user_admin", emails: [] }, allowlist)).toBe(true);
    expect(isAdminIdentityAllowed({ userId: "user_client", emails: ["owner@ajani.test"] }, allowlist)).toBe(true);
  });

  it("fails closed when no identity is allowlisted", () => {
    const allowlist = getAdminAllowlist({});
    expect(isAdminIdentityAllowed({ userId: "user_client", emails: ["client@example.com"] }, allowlist)).toBe(false);
  });

  it("can bootstrap an authenticated Clerk user in development only", () => {
    const development = getAdminAllowlist({
      NODE_ENV: "development",
      AJANI_ADMIN_ALLOW_ANY_CLERK_USER_IN_DEVELOPMENT: "true",
    });
    const production = getAdminAllowlist({
      NODE_ENV: "production",
      AJANI_ADMIN_ALLOW_ANY_CLERK_USER_IN_DEVELOPMENT: "true",
    });

    expect(isAdminIdentityAllowed({ userId: "user_local_owner", emails: [] }, development)).toBe(true);
    expect(isAdminIdentityAllowed({ userId: "user_local_owner", emails: [] }, production)).toBe(false);
  });

  it("does not grant admin access to the notification recipient", () => {
    const allowlist = getAdminAllowlist({
      INTERNAL_NOTIFICATION_TO: "notifications@example.com",
    });
    expect(isAdminIdentityAllowed({
      userId: "user_client",
      emails: ["notifications@example.com"],
    }, allowlist)).toBe(false);
  });
});
