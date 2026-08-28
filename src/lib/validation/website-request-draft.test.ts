import { describe, expect, it } from "vitest";
import { websiteRequestDraftSchema } from "@/lib/validation/website-request-draft";

const valid = {
  title: "After-hours lead handoff",
  transcript: "The current lead follow-up is inconsistent after business hours.",
  clarificationAnswer: "When the lead shares a real date or budget.",
  developmentBrief: {
    workThatSlips: "Evening enquiries wait too long for ownership.",
    momentItHappens: "Between the first message and the morning queue review.",
    desiredOutcome: "Every qualified enquiry reaches an owner with context.",
    protection: "Protect response speed while preserving human judgment.",
  },
  systemBlocks: [{ id: "one", kind: "trigger", title: "Lead arrives", detail: "A website enquiry is received." }],
  voiceMemo: null,
};

describe("website request draft validation", () => {
  it("accepts the final public request payload", () => {
    expect(websiteRequestDraftSchema.safeParse({
      ...valid,
      clarificationAnswers: [
        { question: "When should a person take over?", answer: "When a real date is shared." },
        { question: "Who owns the handoff?", answer: "The shared sales queue." },
      ],
    }).success).toBe(true);
  });

  it("caps clarification rounds at five", () => {
    const clarificationAnswers = Array.from({ length: 6 }, (_, index) => ({
      question: `Question ${index + 1}`,
      answer: `Answer ${index + 1}`,
    }));
    expect(websiteRequestDraftSchema.safeParse({ ...valid, clarificationAnswers }).success).toBe(false);
  });

  it("rejects an incomplete development brief", () => {
    expect(websiteRequestDraftSchema.safeParse({
      ...valid,
      developmentBrief: { ...valid.developmentBrief, protection: "" },
    }).success).toBe(false);
  });

  it("rejects empty routes and oversized voice notes", () => {
    expect(websiteRequestDraftSchema.safeParse({ ...valid, systemBlocks: [] }).success).toBe(false);
    expect(websiteRequestDraftSchema.safeParse({
      ...valid,
      voiceMemo: { durationSeconds: 181, byteLength: 1, mimeType: "audio/webm" },
    }).success).toBe(false);
    expect(websiteRequestDraftSchema.safeParse({
      ...valid,
      voiceMemo: { durationSeconds: 30, byteLength: 1, mimeType: "text/plain" },
    }).success).toBe(false);
    expect(websiteRequestDraftSchema.safeParse({
      ...valid,
      voiceMemo: { durationSeconds: 0, byteLength: 128, mimeType: "audio/webm" },
    }).success).toBe(false);
  });
});
