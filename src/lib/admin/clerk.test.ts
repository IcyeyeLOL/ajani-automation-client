import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_customer" }), currentUser: mocks.currentUser }));
vi.mock("@/lib/clerk/config", () => ({ hasClerkCredentials: () => true }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("redirect"); } }));
import { requireAdminClerkUser } from "./clerk";

afterEach(() => vi.unstubAllEnvs());
describe("verified admin identity", () => {
  it("does not authorize a pending allowlisted secondary address", async () => {
    vi.stubEnv("AJANI_ADMIN_EMAIL_ALLOWLIST", "owner@ajani.test");
    mocks.currentUser.mockResolvedValue({ emailAddresses: [{ emailAddress: "owner@ajani.test", verification: { status: "unverified" } }] });
    await expect(requireAdminClerkUser()).rejects.toThrow("not_found");
    mocks.currentUser.mockResolvedValue({ emailAddresses: [{ emailAddress: "owner@ajani.test", verification: { status: "verified" } }] });
    await expect(requireAdminClerkUser()).resolves.toBe("user_customer");
  });
  it("allows an explicitly configured stable user ID without email matching", async () => {
    vi.stubEnv("AJANI_ADMIN_USER_ID_ALLOWLIST", "user_customer");
    mocks.currentUser.mockResolvedValue({ emailAddresses: [] });
    await expect(requireAdminClerkUser()).resolves.toBe("user_customer");
  });
});
