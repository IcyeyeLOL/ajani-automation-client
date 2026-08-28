import { z } from "zod";
import { automationEmailBriefSchema } from "@/lib/record/automation-brief";
import { systemBlockSchema } from "@/lib/validation/build-request";

export const websiteRequestDraftSchema = z.object({
  title: z.string().trim().min(3).max(120),
  transcript: z.string().trim().max(20_000),
  clarificationAnswer: z.string().trim().max(2_000),
  clarificationAnswers: z.array(z.object({
    question: z.string().trim().min(1).max(240),
    answer: z.string().trim().min(1).max(500),
  })).max(5).optional(),
  developmentBrief: z.object({
    workThatSlips: z.string().trim().min(1).max(1_000),
    momentItHappens: z.string().trim().min(1).max(1_000),
    desiredOutcome: z.string().trim().min(1).max(1_000),
    protection: z.string().trim().min(1).max(2_000),
  }).optional(),
  emailBrief: automationEmailBriefSchema.optional(),
  systemBlocks: z.array(systemBlockSchema).min(1).max(20),
  voiceMemo: z.object({
    durationSeconds: z.number().int().min(1).max(180),
    byteLength: z.number().int().min(12).max(15_728_640),
    mimeType: z.enum(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"]),
  }).nullable(),
});

export type WebsiteRequestDraftInput = z.infer<typeof websiteRequestDraftSchema>;
