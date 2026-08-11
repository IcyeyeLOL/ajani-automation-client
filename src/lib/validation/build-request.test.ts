import { describe, expect, it } from "vitest";
import { buildRequestSchema } from "@/lib/validation/build-request";

const validRequest = {
  organizationId: "bfdbd631-2e1e-4c7a-8cc7-3cceb0bd4d71",
  title: "After-hours lead handoff",
  transcript: "Most leads come in after hours, and I need a timely first response.",
  extractedContext: { channel: "Instagram" },
  systemBlocks: [
    {
      id: "trigger",
      kind: "trigger",
      title: "New lead arrives",
      detail: "An Instagram inquiry enters the route.",
    },
  ],
};

describe("buildRequestSchema", () => {
  it("accepts a complete build request", () => {
    expect(buildRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("rejects an invalid organization and an underspecified transcript", () => {
    const result = buildRequestSchema.safeParse({
      ...validRequest,
      organizationId: "not-a-uuid",
      transcript: "Too short",
    });

    expect(result.success).toBe(false);
  });
});
