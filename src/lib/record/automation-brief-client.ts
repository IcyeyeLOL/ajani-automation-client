import {
  automationIntakeResponseSchema,
  automationShapeResponseSchema,
  type AutomationClarificationAnswer,
  type AutomationIntakeResponse,
  type AutomationShapeResponse,
} from "@/lib/record/automation-brief";
import type { ProcessingNoticeAcknowledgment } from "@/lib/legal/processing-notice";
import { withRequestDeadline } from "@/lib/record/request-deadline";

export async function requestAutomationClarifications(
  transcript: string,
  acknowledgment: ProcessingNoticeAcknowledgment,
  signal?: AbortSignal,
): Promise<AutomationIntakeResponse> {
  return requestAutomationBrief({ action: "clarify", transcript, ...acknowledgment }, automationIntakeResponseSchema, signal);
}

export async function requestAutomationShape(
  transcript: string,
  clarificationAnswers: AutomationClarificationAnswer[],
  acknowledgment: ProcessingNoticeAcknowledgment,
  signal?: AbortSignal,
): Promise<AutomationShapeResponse> {
  return requestAutomationBrief({ action: "shape", transcript, clarificationAnswers, ...acknowledgment }, automationShapeResponseSchema, signal);
}

async function requestAutomationBrief<T>(
  body: Record<string, unknown>,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  signal?: AbortSignal,
): Promise<T> {
  return withRequestDeadline(async (requestSignal) => {
    const response = await fetch("/api/automation-brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error
        : "Ajani could not analyze this note.";
      throw new Error(message);
    }
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new Error("Ajani returned an incomplete automation brief.");
    return parsed.data;
  }, { signal, timeoutMs: 55_000, timeoutMessage: "AI analysis took too long. An editable backup is available." });
}
