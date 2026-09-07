import { describe, expect, it } from "vitest";
import { approvedAutomationEmailBrief, automationEmailBriefSchema, automationShapeResponseSchema, fallbackAutomationIntake, fallbackAutomationShape } from "@/lib/record/automation-brief";

describe("automation brief fallback", () => {
  it("rejects generated routes that cannot pass the human handoff gate", () => {
    const shape = fallbackAutomationShape("After-hours leads need a timely response.", []);
    expect(automationShapeResponseSchema.safeParse(shape).success).toBe(true);
    expect(automationShapeResponseSchema.safeParse({
      ...shape,
      systemBlocks: shape.systemBlocks.map((block) => ({ ...block, kind: "custom" })),
    }).success).toBe(false);
  });

  it("derives summary metadata from approved edits without duplicating a stale route", () => {
    const shape = fallbackAutomationShape("After-hours leads need a timely response.", []);
    const editedBlocks = shape.systemBlocks.map((block, index) => ({
      ...block,
      title: index === 0 ? "Approved edited trigger" : block.title,
      detail: "The customer approved this changed implementation.",
    }));
    const metadata = approvedAutomationEmailBrief(editedBlocks, { ...shape.problem, desiredOutcome: "Approved changed outcome." }, shape.emailBrief);
    expect(metadata.subject).toContain("Approved edited trigger");
    expect(metadata.overview).toBe("Approved changed outcome.");
    expect(metadata.implementationNotes).toEqual([]);
    expect(automationEmailBriefSchema.safeParse(metadata).success).toBe(true);
    expect(editedBlocks).toHaveLength(shape.systemBlocks.length);
  });

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
