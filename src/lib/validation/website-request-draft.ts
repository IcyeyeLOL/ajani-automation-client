import { z } from "zod";
import { systemBlockSchema } from "@/lib/validation/build-request";

export const websiteRequestDraftSchema = z.object({
  title: z.string().trim().min(3).max(120),
  transcript: z.string().trim().max(20_000),
  clarificationAnswer: z.string().trim().max(2_000),
  systemBlocks: z.array(systemBlockSchema).min(1).max(20),
  voiceMemo: z.object({
    durationSeconds: z.number().int().nonnegative().max(180),
    byteLength: z.number().int().nonnegative().max(30_000_000),
  }).nullable(),
});

export type WebsiteRequestDraftInput = z.infer<typeof websiteRequestDraftSchema>;
