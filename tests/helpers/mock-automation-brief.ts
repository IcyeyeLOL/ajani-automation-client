import type { Page } from "@playwright/test";
import { fallbackAutomationIntake, fallbackAutomationShape, type AutomationClarificationAnswer } from "@/lib/record/automation-brief";

export async function mockAutomationBrief(page: Page) {
  await page.route("**/api/automation-brief", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: unknown;
      transcript?: unknown;
      clarificationAnswers?: unknown;
      processingAcknowledged?: unknown;
      processingNoticeVersion?: unknown;
    };
    if (body.processingAcknowledged !== true || body.processingNoticeVersion !== "request-processing-2026-09-02") {
      await route.fulfill({
        contentType: "application/json",
        status: 428,
        body: JSON.stringify({ error: "Current processing acknowledgment required" }),
      });
      return;
    }
    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    const result = body.action === "shape"
      ? fallbackAutomationShape(
        transcript,
        Array.isArray(body.clarificationAnswers) ? body.clarificationAnswers as AutomationClarificationAnswer[] : [],
      )
      : fallbackAutomationIntake(transcript);
    await route.fulfill({ contentType: "application/json", status: 200, body: JSON.stringify(result) });
  });
}
