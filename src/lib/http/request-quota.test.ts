import { afterEach, describe, expect, it, vi } from "vitest";
import { publicRequestFingerprint } from "./request-quota";

afterEach(() => vi.unstubAllEnvs());
describe("public operation budgets", () => {
  it("isolates saving from generation for the same office IP", () => {
    vi.stubEnv("REQUEST_RATE_LIMIT_SECRET", "quota-test-secret");
    const request = new Request("https://ajani.test/", { headers: { "x-vercel-forwarded-for": "192.0.2.10" } });
    const ai = publicRequestFingerprint(request, "automation-brief");
    const save = publicRequestFingerprint(request, "request-draft-save");
    expect(ai).toHaveLength(64);
    expect(save).toHaveLength(64);
    expect(ai).not.toBe(save);
    expect(publicRequestFingerprint(request, "request-draft-save")).toBe(save);
  });
});
