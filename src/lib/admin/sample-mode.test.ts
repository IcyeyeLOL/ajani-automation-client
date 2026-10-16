import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));

import { SAMPLE_MODE_COOKIE, clearSampleModeCookie, isSampleMode, setSampleModeCookie } from "@/lib/admin/sample-mode";

describe("sample data cookie", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.set.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is on only when the cookie holds exactly \"1\"", async () => {
    expect(SAMPLE_MODE_COOKIE).toBe("ajani_admin_sample");
    mocks.get.mockReturnValue({ name: SAMPLE_MODE_COOKIE, value: "1" });
    expect(await isSampleMode()).toBe(true);
    expect(mocks.get).toHaveBeenCalledWith("ajani_admin_sample");
    for (const value of ["0", "", "true", "11"]) {
      mocks.get.mockReturnValue({ name: SAMPLE_MODE_COOKIE, value });
      expect(await isSampleMode(), value).toBe(false);
    }
    mocks.get.mockReturnValue(undefined);
    expect(await isSampleMode()).toBe(false);
  });

  it("is set for the admin area only, unreadable by scripts, for eight hours", async () => {
    await setSampleModeCookie();
    expect(mocks.set).toHaveBeenCalledWith("ajani_admin_sample", "1", {
      httpOnly: true, maxAge: 8 * 60 * 60, path: "/admin", sameSite: "strict", secure: false,
    });
    await clearSampleModeCookie();
    expect(mocks.set).toHaveBeenLastCalledWith("ajani_admin_sample", "", {
      httpOnly: true, maxAge: 0, path: "/admin", sameSite: "strict", secure: false,
    });
  });

  it("is HTTPS-only in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setSampleModeCookie();
    await clearSampleModeCookie();
    expect(mocks.set.mock.calls.every(([, , options]) => options.secure === true)).toBe(true);
  });
});
