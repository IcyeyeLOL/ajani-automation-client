import { describe, expect, it } from "vitest";
import { fallbackAutomationIntake, fallbackAutomationShape } from "@/lib/record/automation-brief";

describe("automation brief fallback", () => {
  it("keeps the transcript-derived problem and carries confirmed answers into the build handoff", () => {
    const transcript = "Our dental clinic gets patient booking requests after hours and the front desk has to copy them into the calendar each morning.";
    const intake = fallbackAutomationIntake(transcript);
    const answers = intake.clarifications.map((question) => ({ question: question.question, answer: question.options[0] }));
    const shape = fallbackAutomationShape(transcript, answers);

    expect(intake.clarifications.length).toBeGreaterThan(0);
    expect(shape.problem.workThatSlips).toMatch(/booking|schedule/i);
    expect(shape.systemBlocks).toHaveLength(4);
    expect(shape.systemBlocks.some((block) => block.detail.includes("Confirmed decisions"))).toBe(true);
    expect(shape.emailBrief.implementationNotes).toHaveLength(4);
    expect(shape.emailBrief.assumptions[0]).toContain("Customer confirmed");
  });
});
