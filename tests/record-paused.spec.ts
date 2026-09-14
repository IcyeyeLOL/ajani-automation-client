import { expect, test } from "@playwright/test";

test("paused recording is a calm, readable editing state", async ({ page }) => {
  await page.setViewportSize({ width: 690, height: 760 });
  await page.goto("/record");
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  const confirmation = page.getByRole("dialog", { name: "Before you record.", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await confirmation.getByRole("button", { name: "Confirm & start recording", exact: true }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause & edit", exact: true }).click();

  await expect(page.getByText("Edit the note before you continue", { exact: true })).toBeVisible();
  await expect(page.getByText("Your written note", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue recording" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this note" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.waitForTimeout(600);
  await page.screenshot({
    path: "artifacts/record-review/paused-editor-professional.png",
    fullPage: false,
  });
});
