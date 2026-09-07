import { z } from "zod";
import { handoffPolicyVersionSchema } from "@/lib/validation/website-request-draft";

export const legalAcceptanceEnvelopeSchema = handoffPolicyVersionSchema.extend({
  acknowledged: z.literal(true),
  acceptedAt: z.string().datetime(),
  action: z.literal("request_handoff"),
  method: z.literal("affirmative_checkbox"),
}).strict();

export function createLegalAcceptanceEnvelope(
  versions: z.infer<typeof handoffPolicyVersionSchema>,
  acceptedAt = new Date().toISOString(),
) {
  return legalAcceptanceEnvelopeSchema.parse({
    acknowledged: true,
    acceptedAt,
    action: "request_handoff",
    method: "affirmative_checkbox",
    ...versions,
  });
}
