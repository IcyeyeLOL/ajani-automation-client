import { describe, expect, it } from "vitest";
import { normalizeGeneratedProse, normalizeGeneratedText } from "@/lib/ai/generated-prose";

describe("generated prose normalization", () => {
  it("removes AI-style dash punctuation without changing compound words", () => {
    expect(normalizeGeneratedText("Capture the request — then send a follow-up – with context."))
      .toBe("Capture the request, then send a follow-up, with context.");
  });

  it("normalizes ranges, bullets, and nested structured output", () => {
    expect(normalizeGeneratedProse({
      problem: { desiredOutcome: "Respond in 7–10 minutes — with approval." },
      notes: ["- Keep a person in control", "Use a follow-up email"],
    })).toEqual({
      problem: { desiredOutcome: "Respond in 7 to 10 minutes, with approval." },
      notes: ["Keep a person in control", "Use a follow-up email"],
    });
  });
});
