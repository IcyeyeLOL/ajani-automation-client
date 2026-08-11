import { z } from "zod";

export const systemBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["trigger", "reply", "qualify", "handoff", "custom"]),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(1000),
});

export const buildRequestSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().min(3).max(120),
  transcript: z.string().min(20).max(20_000),
  extractedContext: z.record(z.string(), z.unknown()),
  systemBlocks: z.array(systemBlockSchema).min(1).max(20),
  quotedAmountCents: z.number().int().positive().optional(),
});

export type BuildRequestInput = z.infer<typeof buildRequestSchema>;
