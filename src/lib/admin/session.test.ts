import { describe, expect, it } from "vitest";
import { createAdminSessionToken, keysMatch, verifyAdminSessionToken } from "@/lib/admin/session-token";

const secret = "a-secure-test-secret-that-is-at-least-thirty-two-characters";

describe("admin session", () => {
  it("accepts the configured access key only", () => {
    expect(keysMatch("correct-key-123", "correct-key-123")).toBe(true);
    expect(keysMatch("wrong-key-12345", "correct-key-123")).toBe(false);
  });

  it("signs, verifies, expires, and rejects tampering", () => {
    const token = createAdminSessionToken(secret, 1_000);
    expect(verifyAdminSessionToken(token, secret, 1_001)).toBe(true);
    expect(verifyAdminSessionToken(token, secret, 1_000 + 60 * 60 * 8)).toBe(false);
    expect(verifyAdminSessionToken(`${token}x`, secret, 1_001)).toBe(false);
    expect(verifyAdminSessionToken(token, `${secret}x`, 1_001)).toBe(false);
  });
});
