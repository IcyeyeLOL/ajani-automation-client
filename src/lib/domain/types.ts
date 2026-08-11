export type BuildRequestStatus =
  | "draft"
  | "clarifying"
  | "quoted"
  | "paid"
  | "in_review"
  | "in_progress"
  | "live"
  | "needs_attention"
  | "cancelled";

export type AutomationHealth = "healthy" | "warning" | "error" | "paused";

export type ContactPreference = "sms" | "email";

export interface SystemBlock {
  id: string;
  kind: "trigger" | "reply" | "qualify" | "handoff" | "custom";
  title: string;
  detail: string;
}

export interface BuildRequestDraft {
  organizationId: string;
  title: string;
  transcript: string;
  extractedContext: Record<string, unknown>;
  systemBlocks: SystemBlock[];
  quotedAmountCents?: number;
}
