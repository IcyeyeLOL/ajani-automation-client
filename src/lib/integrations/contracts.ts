import "server-only";

import type { BuildRequestDraft } from "@/lib/domain/types";

export interface TranscriptResult {
  provider: "whisper" | "elevenlabs";
  text: string;
  durationSeconds: number;
  language?: string;
}

export interface ExtractionResult {
  summary: string;
  goals: string[];
  systemsInvolved: string[];
  missingDetails: Array<{ question: string; reason: string }>;
  suggestedBlocks: BuildRequestDraft["systemBlocks"];
}

export interface QuoteResult {
  amountCents: number;
  currency: "usd";
  tier: "clean_match" | "guided_custom" | "custom";
  rationale: string[];
}

export interface ProvisioningEvent {
  buildRequestId: string;
  organizationId: string;
  systemDefinition: BuildRequestDraft["systemBlocks"];
  paidAt: string;
}

/**
 * These are boundary contracts, not provider implementations. Each adapter runs
 * server-side, receives one narrow job, and records its result before the next
 * job begins. n8n can call the same boundaries through signed webhooks.
 */
export interface AutomationPipeline {
  transcribe(storagePath: string): Promise<TranscriptResult>;
  extract(transcript: string): Promise<ExtractionResult>;
  quote(draft: BuildRequestDraft): Promise<QuoteResult>;
  provision(event: ProvisioningEvent): Promise<void>;
}
