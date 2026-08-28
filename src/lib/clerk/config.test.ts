import { describe, expect, it } from "vitest";
import { hasClerkCredentials, shouldFailClosedForClerk } from "@/lib/clerk/config";

const testCredentials = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_SECRET_KEY: "sk_test_example",
};

const liveCredentials = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_example",
  CLERK_SECRET_KEY: "sk_live_example",
};

describe("Clerk environment configuration", () => {
  it("preserves the optional local fallback and accepts test credentials in development", () => {
    expect(hasClerkCredentials({ NODE_ENV: "development" })).toBe(false);
    expect(hasClerkCredentials({ NODE_ENV: "development", ...testCredentials })).toBe(true);
    expect(shouldFailClosedForClerk({ NODE_ENV: "development" })).toBe(false);
  });

  it("requires a complete live credential pair in a production runtime", () => {
    expect(hasClerkCredentials({ NODE_ENV: "production", ...liveCredentials })).toBe(true);
    expect(shouldFailClosedForClerk({ NODE_ENV: "production", ...liveCredentials })).toBe(false);

    expect(hasClerkCredentials({ NODE_ENV: "production", ...testCredentials })).toBe(false);
    expect(shouldFailClosedForClerk({ NODE_ENV: "production", ...testCredentials })).toBe(true);
    expect(shouldFailClosedForClerk({
      NODE_ENV: "production",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: liveCredentials.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    })).toBe(true);
  });

  it("allows test credentials on Vercel previews but not production deployments", () => {
    expect(hasClerkCredentials({ NODE_ENV: "production", VERCEL_ENV: "preview", ...testCredentials })).toBe(true);
    expect(shouldFailClosedForClerk({ NODE_ENV: "production", VERCEL_ENV: "preview", ...testCredentials })).toBe(false);
    expect(hasClerkCredentials({ NODE_ENV: "production", VERCEL_ENV: "production", ...testCredentials })).toBe(false);
    expect(shouldFailClosedForClerk({ NODE_ENV: "production", VERCEL_ENV: "production", ...testCredentials })).toBe(true);
  });

  it("does not treat a local production build as a deployed production runtime", () => {
    const localBuild = {
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
      ...testCredentials,
    };
    expect(hasClerkCredentials(localBuild)).toBe(true);
    expect(shouldFailClosedForClerk(localBuild)).toBe(false);
  });
});
