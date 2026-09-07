import { describe, expect, it } from "vitest";
import { containsHighRiskSensitiveInput } from "@/lib/ai/sensitive-input";

describe("sensitive AI input guard", () => {
  it("allows ordinary process descriptions", () => {
    expect(containsHighRiskSensitiveInput("Website leads wait until the next morning for a reply.")).toBe(false);
  });

  it.each([
    "The password is hunter-example",
    "Customer SSN 123-45-6789",
    "Credit card 4111 1111 1111 1111",
    "Patient ID: AB-12345",
    "Save a biometric voiceprint",
  ])("routes high-risk input away from external AI: %s", (value) => {
    expect(containsHighRiskSensitiveInput(value)).toBe(true);
  });
});
