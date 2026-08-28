import { expect, test } from "@playwright/test";
import { mockAutomationBrief } from "./helpers/mock-automation-brief";

test.beforeEach(async ({ page }) => mockAutomationBrief(page));

test("a captured voice note is transcribed before Clarify and restored on Back", async ({ page }) => {
  const transcript = "Customer appointment changes arrive after hours, and the office team needs a clear next action the following morning.";
  await page.route("**/api/transcribe-voice", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      body: JSON.stringify({ transcript }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/record");
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(1_100);
  await page.getByRole("button", { name: "Finish note" }).click();

  await expect(page.getByText("Voice note saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to clarify" }).click();

  await expect(page.getByText(/Voice note transcribed/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Add or confirm the written version" })).toHaveValue(transcript);
  await page.getByRole("button", { name: "Back to your note" }).click();

  await expect(page.getByText("Voice note saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 1_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/record-review/saved-note-back-state.png", fullPage: false });
});
