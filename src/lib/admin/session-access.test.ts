import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveAdminClerkUser: vi.fn(), cookie: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie, set: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not_found"); },
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock("@/lib/admin/clerk", () => ({ resolveAdminClerkUser: mocks.resolveAdminClerkUser, requireAdminClerkUser: vi.fn() }));

import { authorizeAdminAction, createAdminSessionToken } from "@/lib/admin/session";

const secret = "a-secure-test-secret-that-is-at-least-thirty-two-characters";

describe("desk save authorization", () => {
  beforeEach(() => {
    vi.stubEnv("AJANI_ADMIN_ACCESS_KEY", "correct-key-123");
    vi.stubEnv("AJANI_ADMIN_SESSION_SECRET", secret);
    mocks.cookie.mockReturnValue({ value: createAdminSessionToken(secret) });
  });

  it("allows a signed-in admin with an unlocked desk", async () => {
    mocks.resolveAdminClerkUser.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    await expect(authorizeAdminAction()).resolves.toEqual({ status: "allowed", userId: "user_admin" });
  });

  it("answers an expired sign-in with a message, never a redirect to sign-in", async () => {
    mocks.resolveAdminClerkUser.mockResolvedValue({ status: "signed_out" });
    const access = await authorizeAdminAction();
    expect(access).toMatchObject({ status: "refused", state: { status: "error", message: expect.stringContaining("Press save again") } });
  });

  it("still sends a locked desk to the key screen and hides the desk from other accounts", async () => {
    mocks.resolveAdminClerkUser.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.cookie.mockReturnValue(undefined);
    await expect(authorizeAdminAction()).rejects.toThrow("redirect:/admin/login");
    mocks.resolveAdminClerkUser.mockResolvedValue({ status: "forbidden" });
    await expect(authorizeAdminAction()).rejects.toThrow("not_found");
  });
});
