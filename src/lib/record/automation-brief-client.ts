import {
  automationIntakeResponseSchema,
  automationShapeResponseSchema,
  type AutomationClarificationAnswer,
  type AutomationIntakeResponse,
  type AutomationShapeResponse,
} from "@/lib/record/automation-brief";

export async function requestAutomationClarifications(transcript: string): Promise<AutomationIntakeResponse> {
  return requestAutomationBrief({ action: "clarify", transcript }, automationIntakeResponseSchema);
}

export async function requestAutomationShape(
  transcript: string,
  clarificationAnswers: AutomationClarificationAnswer[],
): Promise<AutomationShapeResponse> {
  return requestAutomationBrief({ action: "shape", transcript, clarificationAnswers }, automationShapeResponseSchema);
}

async function requestAutomationBrief<T>(
  body: Record<string, unknown>,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): Promise<T> {
  const response = await fetch("/api/automation-brief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as unknown;
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : "Ajani could not analyze this note.";
    throw new Error(message);
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new Error("Ajani returned an incomplete automation brief.");
  return parsed.data;
}
