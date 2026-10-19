import { afterEach, describe, expect, it, vi } from "vitest";

describe("Clerk proxy configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns a non-cacheable 503 when production uses test credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");

    const { default: proxy } = await import("@/proxy");
    const response = await (proxy as () => Promise<Response> | Response)();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }, 15_000);

  it("sends signed-out portal visitors to this site's sign-in page", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_example");
    const clerkMiddleware = vi.fn(() => () => new Response(null));
    vi.doMock("@clerk/nextjs/server", () => ({ clerkMiddleware }));

    try {
      await import("@/proxy");
      expect(clerkMiddleware).toHaveBeenCalledWith({ signInUrl: "/sign-in", signUpUrl: "/sign-up" });
    } finally {
      vi.doUnmock("@clerk/nextjs/server");
    }
  });

  it("preserves the local fallback when credentials are absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");

    const { default: proxy } = await import("@/proxy");
    const response = await (proxy as () => Promise<Response> | Response)();

    expect(response.status).toBe(200);
  });
});
