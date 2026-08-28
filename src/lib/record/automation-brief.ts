import { z } from "zod";
import type { SystemBlock } from "@/lib/domain/types";
import { analyzeTypedNote, MAX_CLARIFICATION_QUESTIONS, type TypedNoteClarification } from "@/lib/record/typed-note-analysis";

export const automationProblemSchema = z.object({
  workThatSlips: z.string().trim().min(1).max(1_000),
  momentItHappens: z.string().trim().min(1).max(1_000),
  desiredOutcome: z.string().trim().min(1).max(1_000),
});

export const automationClarificationSchema = z.object({
  question: z.string().trim().min(1).max(240),
  options: z.array(z.string().trim().min(1).max(180)).length(3),
  why: z.string().trim().min(1).max(360),
  suggestedOptionIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

export const automationEmailBriefSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  overview: z.string().trim().min(1).max(1_000),
  implementationNotes: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(6),
});

const generationMetadataSchema = z.object({
  method: z.enum(["ai", "deterministic_fallback"]),
  model: z.string().min(1),
});

export const automationIntakeResponseSchema = z.object({
  problem: automationProblemSchema,
  clarifications: z.array(automationClarificationSchema).min(1).max(MAX_CLARIFICATION_QUESTIONS),
}).merge(generationMetadataSchema);

export const automationShapeResponseSchema = z.object({
  problem: automationProblemSchema,
  protection: z.string().trim().min(1).max(2_000),
  systemBlocks: z.array(z.object({
    id: z.string().min(1).max(80),
    kind: z.enum(["trigger", "reply", "qualify", "handoff", "custom"]),
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(1_000),
  })).min(3).max(8),
  emailBrief: automationEmailBriefSchema,
}).merge(generationMetadataSchema);

export type AutomationProblem = z.infer<typeof automationProblemSchema>;
export type AutomationEmailBrief = z.infer<typeof automationEmailBriefSchema>;
export type AutomationIntakeResponse = z.infer<typeof automationIntakeResponseSchema>;
export type AutomationShapeResponse = z.infer<typeof automationShapeResponseSchema>;
export type AutomationClarificationAnswer = { question: string; answer: string };

export function fallbackAutomationIntake(transcript: string): AutomationIntakeResponse {
  const analysis = analyzeTypedNote(transcript);
  return {
    method: "deterministic_fallback",
    model: "local-automation-templates-v1",
    problem: problemFromAnalysis(analysis),
    clarifications: analysis.clarifications.map((item) => ({
      ...item,
      why: item.why || "This answer changes the decisions and handoff in the proposed automation.",
    })),
  };
}

export function fallbackAutomationShape(
  transcript: string,
  answers: AutomationClarificationAnswer[],
): AutomationShapeResponse {
  const analysis = analyzeTypedNote(transcript);
  const confirmed = answers.filter((item) => item.answer.trim()).map((item) => item.answer.trim());
  const decisionContext = confirmed.length > 0 ? ` Confirmed decisions: ${confirmed.join("; ")}.` : "";
  const systemBlocks: SystemBlock[] = analysis.systemBlocks.map((block) => (
    block.kind === "qualify" || block.kind === "handoff"
      ? { ...block, detail: `${block.detail}${decisionContext}`.slice(0, 1_000) }
      : block
  ));
  const firstStep = systemBlocks[0]?.title ?? "New automation request";
  const lastStep = systemBlocks.at(-1)?.title ?? "human handoff";
  return {
    method: "deterministic_fallback",
    model: "local-automation-templates-v1",
    problem: problemFromAnalysis(analysis),
    protection: "Keep routine work moving automatically while sending exceptions, approvals, and judgment calls to a person with the full context attached.",
    systemBlocks,
    emailBrief: {
      subject: `${firstStep} → ${lastStep}`.slice(0, 120),
      overview: analysis.desiredOutcome,
      implementationNotes: systemBlocks.map((block) => `${block.title}: ${block.detail}`),
      assumptions: confirmed.length > 0 ? confirmed.map((answer) => `Customer confirmed: ${answer}`) : [],
    },
  };
}

function problemFromAnalysis(analysis: ReturnType<typeof analyzeTypedNote>): AutomationProblem {
  return {
    workThatSlips: analysis.workThatSlips,
    momentItHappens: analysis.momentItHappens,
    desiredOutcome: analysis.desiredOutcome,
  };
}

export function asTypedClarifications(value: AutomationIntakeResponse): TypedNoteClarification[] {
  return value.clarifications.map((item) => ({
    ...item,
    options: [item.options[0], item.options[1], item.options[2]],
  }));
}
