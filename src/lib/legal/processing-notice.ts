import { z } from "zod";
import { PROCESSING_NOTICE_VERSION } from "@/lib/legal/policy-versions";

export const processingNoticeAcknowledgmentSchema = z.object({
  processingAcknowledged: z.literal(true),
  processingNoticeVersion: z.literal(PROCESSING_NOTICE_VERSION),
}).strict();

export type ProcessingNoticeAcknowledgment = z.infer<typeof processingNoticeAcknowledgmentSchema>;

export const CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT: ProcessingNoticeAcknowledgment = {
  processingAcknowledged: true,
  processingNoticeVersion: PROCESSING_NOTICE_VERSION,
};
