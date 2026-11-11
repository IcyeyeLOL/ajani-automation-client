import { expect, test } from "@playwright/test";
import { mockAutomationBrief } from "./helpers/mock-automation-brief";

test("question preparation shows a cancellable, honest loading screen", async ({ page }) => {
  await mockAutomationBrief(page);
  await page.route("**/api/automation-brief", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 850));
    await route.fallback();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/record");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(
    "After-hours website leads wait until morning, and the sales team needs a clear follow-up route.",
  );
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  const confirmation = page.getByRole("dialog", { name: "Before Ajani continues." });
  await confirmation.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await confirmation.getByRole("button", { name: "Confirm & continue" }).click();

  const processing = page.getByRole("dialog", { name: "Finding the questions that matter." });
  await expect(processing).toBeVisible();
  await expect(processing).toContainText("You will confirm every answer");
  expect(await processing.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  await processing.getByRole("button", { name: /Cancel/ }).click();
  await expect(processing).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tell us where the work gets stuck." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();

  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Finding the questions that matter." })).toHaveCount(0);
});
