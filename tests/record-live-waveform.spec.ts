import { expect, test } from "@playwright/test";

test("live recording renders a centered microphone-driven waveform", async ({ page }) => {
  await page.setViewportSize({ width: 690, height: 620 });
  await page.goto("/record");
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();

  const waveform = page.locator("canvas");
  await expect(waveform).toBeVisible();
  await expect(waveform).toHaveCSS("height", "58px");
  await expect(waveform).toHaveCSS("max-width", "316px");
  await page.waitForTimeout(1_400);
  const waveformPixels = await waveform.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return { filled: 0, runs: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const occupiedColumns = Array.from({ length: canvas.width }, (_, x) => (
      Array.from({ length: canvas.height }, (__, y) => pixels[(y * canvas.width + x) * 4 + 3]).some((alpha) => alpha > 0)
    ));
    return {
      filled: pixels.filter((_, index) => index % 4 === 3).reduce((count, alpha) => count + Number(alpha > 0), 0),
      runs: occupiedColumns.reduce((count, occupied, index) => count + Number(occupied && !occupiedColumns[index - 1]), 0),
    };
  });
  expect(waveformPixels.filled).toBeGreaterThan(100);
  expect(waveformPixels.runs).toBe(40);

  await page.screenshot({
    path: "artifacts/record-review/live-waveform-centered.png",
    fullPage: false,
  });
});
