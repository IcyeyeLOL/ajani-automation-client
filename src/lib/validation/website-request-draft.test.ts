import { describe, expect, it } from "vitest";
import { websiteRequestDraftSchema } from "@/lib/validation/website-request-draft";

const valid = {
  title: "After-hours lead handoff",
  transcript: "The current lead follow-up is inconsistent after business hours.",
  clarificationAnswer: "When the lead shares a real date or budget.",
  systemBlocks: [{ id: "one", kind: "trigger", title: "Lead arrives", detail: "A website enquiry is received." }],
  voiceMemo: null,
};

describe("website request draft validation", () => {
  it("accepts the final public request payload", () => {
    expect(websiteRequestDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty routes and oversized voice notes", () => {
    expect(websiteRequestDraftSchema.safeParse({ ...valid, systemBlocks: [] }).success).toBe(false);
    expect(websiteRequestDraftSchema.safeParse({ ...valid, voiceMemo: { durationSeconds: 181, byteLength: 1 } }).success).toBe(false);
  });
});
