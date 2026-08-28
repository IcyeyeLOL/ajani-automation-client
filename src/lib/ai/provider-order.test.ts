import { describe, expect, it } from "vitest";
import { shouldPreferDirectAnthropic } from "@/lib/ai/provider-order";

describe("AI provider ordering", () => {
  it("keeps the OIDC-capable gateway first by default", () => {
    expect(shouldPreferDirectAnthropic({ ANTHROPIC_API_KEY: "direct-key" })).toBe(false);
  });

  it("uses direct Anthropic first only when explicitly selected", () => {
    expect(shouldPreferDirectAnthropic({
      AI_PRIMARY_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "direct-key",
    })).toBe(true);
  });

  it("does not select the direct provider without a usable key", () => {
    expect(shouldPreferDirectAnthropic({
      AI_PRIMARY_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "  ",
    })).toBe(false);
  });
});
