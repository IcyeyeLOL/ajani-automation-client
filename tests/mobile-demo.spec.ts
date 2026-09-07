import { expect, test } from "@playwright/test";

test.describe("phone-first automation demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/demos");
  });

  test("offers all scenarios and keeps direct step inspection paused", async ({ page }) => {
    await page.getByRole("button", { name: "Change" }).click();
    for (const scenario of ["After-hours leads", "Client intake", "Returning clients"]) {
      await page.getByRole("button", { name: new RegExp(scenario) }).click();
      await expect(page.getByRole("heading", { name: scenario })).toBeFocused();
      await expect(page.getByRole("status")).toContainText("Running. Step 1 of 4");
      await page.getByRole("button", { name: /Step 4 of 4/ }).click();
      await expect(page.getByRole("status")).toContainText("Paused. Step 4 of 4");
      await expect(page.getByRole("status")).not.toContainText("complete");
      await page.getByRole("button", { name: "Restart automation demo" }).click();
      await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
      await page.getByRole("button", { name: "Change" }).click();
    }
  });

  test("autoplay stops in a real completed state", async ({ page }) => {
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("button", { name: /After-hours leads/ }).click();
    await expect(page.getByRole("status")).toContainText("Running. Step 1 of 4");
    const signalPacket = page.getByTestId("signal-packet");
    await expect(signalPacket).toHaveCSS("animation-name", /packet-travel/);
    await expect(signalPacket).toHaveCSS("animation-play-state", "running");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(signalPacket).toHaveCSS("animation-play-state", "paused");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(signalPacket).toHaveCSS("animation-play-state", "running");
    await expect(page.getByRole("status")).toContainText("complete", { timeout: 13_500 });
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    await expect(page.getByRole("link", { name: /Use this route for my work/ })).toBeVisible();
  });

  test("reduced-motion fallback is fully manual when the full-motion override is absent", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("button", { name: /After-hours leads/ }).click();
    await expect(page.getByRole("status")).toContainText("Paused. Step 1 of 4");
    await page.waitForTimeout(3_100);
    await expect(page.getByRole("status")).toContainText("Paused. Step 1 of 4");
  });

  test("full showcase cycles into the next workflow without input", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "After-hours leads" })).toBeVisible({ timeout: 2_500 });
    await expect(page.getByRole("status")).toContainText("Auto running. Step 1 of 4");
    await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-play-state", "running");
    await expect(page.getByRole("heading", { name: "Client intake" })).toBeVisible({ timeout: 16_000 });
    await expect(page.getByRole("status")).toContainText("Auto running. Step 1 of 4");
  });

  test("has no horizontal overflow at required mobile widths", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    for (const width of [320, 375, 390, 430, 593, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByRole("heading", { name: "After-hours leads" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
  });
});
