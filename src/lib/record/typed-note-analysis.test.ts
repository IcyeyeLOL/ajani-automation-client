import { describe, expect, it } from "vitest";
import {
  analyzeTypedNote,
  MIN_TYPED_NOTE_CHARACTERS,
  type TypedNoteTheme,
} from "@/lib/record/typed-note-analysis";

describe("analyzeTypedNote", () => {
  it.each<[TypedNoteTheme, string]>([
    ["lead_follow_up", "After-hours leads arrive but our follow-up often waits until the next morning."],
    ["scheduling", "Appointment rescheduling is split between our calendar, inbox, and front desk."],
    ["client_intake", "New client onboarding details arrive in several places and intake forms stay incomplete."],
    ["document_chasing", "We keep chasing missing documents, signatures, and statements before every deadline."],
    ["generic", "The team passes work around manually and nobody is certain who owns the next action."],
  ])("classifies %s notes and returns a complete editable route", (theme, note) => {
    const result = analyzeTypedNote(note);

    expect(result.theme).toBe(theme);
    expect(result.workThatSlips.length).toBeGreaterThan(10);
    expect(result.momentItHappens.length).toBeGreaterThan(10);
    expect(result.desiredOutcome.length).toBeGreaterThan(10);
    expect(result.clarification.options).toHaveLength(3);
    expect(result.clarification.suggestedOptionIndex).toBeGreaterThanOrEqual(0);
    expect(result.clarification.suggestedOptionIndex).toBeLessThan(3);
    expect(result.clarifications.length).toBeGreaterThanOrEqual(1);
    expect(result.clarifications.length).toBeLessThanOrEqual(5);
    expect(result.clarifications.every((clarification) => clarification.options.length === 3)).toBe(true);
    expect(result.systemBlocks).toHaveLength(4);
    expect(result.systemBlocks.map((block) => block.kind)).toEqual([
      "trigger",
      "reply",
      "qualify",
      "handoff",
    ]);
  });

  it("uses scoring so the strongest recognizable theme wins", () => {
    const result = analyzeTypedNote(
      "A new client appointment starts intake, but documents, files, and signatures remain missing.",
    );

    expect(result.theme).toBe("document_chasing");
  });

  it("asks only for missing details and never exceeds five questions", () => {
    const sparse = analyzeTypedNote("Work keeps getting lost before the next step is clear.");
    const detailed = analyzeTypedNote(
      "Website leads arrive after hours, receive an immediate reply, and move to our sales team when a booking is ready to confirm.",
    );

    expect(sparse.clarifications).toHaveLength(5);
    expect(detailed.clarifications).toHaveLength(1);
  });

  it("does not echo names or sensitive details from the note", () => {
    const privateText = "Patient Jordan Example needs a diabetes document followed up at 555-0104.";
    const serialized = JSON.stringify(analyzeTypedNote(privateText));

    expect(serialized).not.toContain("Jordan Example");
    expect(serialized).not.toContain("diabetes");
    expect(serialized).not.toContain("555-0104");
  });

  it("does not invent measured outcomes or regulated claims", () => {
    const serialized = JSON.stringify(
      analyzeTypedNote("Our booking requests wait in the inbox and need a consistent next step."),
    ).toLowerCase();

    expect(serialized).not.toMatch(/\b(?:save|saved|saving)\s+\d+/);
    expect(serialized).not.toMatch(/\b\d+\s*%/);
    expect(serialized).not.toContain("increase revenue");
    expect(serialized).not.toContain("hipaa compliant");
    expect(serialized).not.toContain("diagnos");
    expect(serialized).not.toContain("legal advice");
  });

  it("returns fresh editable blocks on every call", () => {
    const first = analyzeTypedNote("Leads arrive after hours and the follow-up waits until the team returns.");
    first.systemBlocks[0].title = "Customer edit";

    const second = analyzeTypedNote("Leads arrive after hours and the follow-up waits until the team returns.");
    expect(second.systemBlocks[0].title).toBe("A new enquiry arrives");
  });

  it("accepts the trimmed minimum and rejects shorter notes", () => {
    expect(() => analyzeTypedNote("x".repeat(MIN_TYPED_NOTE_CHARACTERS))).not.toThrow();
    expect(() => analyzeTypedNote(`  ${"x".repeat(MIN_TYPED_NOTE_CHARACTERS - 1)}  `)).toThrow(RangeError);
  });
});
