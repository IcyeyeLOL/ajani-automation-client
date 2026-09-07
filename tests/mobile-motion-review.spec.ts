import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Local motion review: APIs disabled." } });
    return route.continue();
  });
});

for (const savedPreference of [null, "system"] as const) {
  test(`homepage animations play by default with reduced-motion device settings and ${savedPreference ?? "no"} saved preference`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (savedPreference) {
      await page.addInitScript((preference) => {
        localStorage.setItem("ajani_motion_preference_v1", preference);
      }, savedPreference);
    }
    await page.goto("/");
    const carousel = page.locator('[data-hero-carousel="true"]');
    await carousel.scrollIntoViewIfNeeded();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    await expect(carousel).toHaveAttribute("data-paused", "false");
    const scene = carousel.locator('[data-scene-viewport="true"]');
    await expect.poll(() => scene.evaluate((node) => node.getAnimations()
      .some((animation) => animation.playState === "running" && Number(animation.currentTime) > 0))).toBe(true);
    await expect(page.getByRole("button", { name: /Use device setting|Play animations|Keep animations on/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Pause illustrative systems", exact: true }).click();
    await expect(carousel).toHaveAttribute("data-paused", "true");
    await page.getByRole("button", { name: "Play illustrative systems", exact: true }).click();
    await expect(carousel).toHaveAttribute("data-paused", "false");
    await page.reload();
    await carousel.scrollIntoViewIfNeeded();
    await expect(carousel).toHaveAttribute("data-paused", "false");
    await page.goto("/demos");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    const player = page.locator('section[aria-labelledby="mobile-player-heading"]');
    await player.scrollIntoViewIfNeeded();
    await expect(player).toHaveAttribute("data-auto", "true");
    await expect(player).toHaveAttribute("data-mode", "playing");
  });
}

test("mobile showcase completion cannot start a new workflow while the document is hidden", async ({ page }) => {
  await page.goto("/demos");
  const player = page.locator('section[aria-labelledby="mobile-player-heading"]');
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-auto", "true");
  await expect(player).toHaveAttribute("data-mode", "complete", { timeout: 18_000 });
  const completedHeading = await player.getByRole("heading", { level: 2 }).textContent();
  // Synthesize tab backgrounding, not a playback or application state mutation.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(3_300); // Longer than the 2.2-second inter-workflow hold.
  await expect(player.getByRole("heading", { level: 2 })).toHaveText(completedHeading!);
  await expect(player).not.toHaveAttribute("data-mode", "playing");
});

test("mobile showcase stops advancing while outside the viewport", async ({ page }) => {
  await page.goto("/demos");
  const player = page.locator('section[aria-labelledby="mobile-player-heading"]');
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-mode", "playing");
  await page.locator("footer").last().scrollIntoViewIfNeeded();
  await expect.poll(() => player.evaluate((element) => element.getBoundingClientRect().bottom <= 0)).toBe(true);
  // Give observer delivery one frame before taking the paused snapshot.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const progress = player.getByRole("progressbar");
  const stoppedStep = await progress.getAttribute("aria-valuenow");
  await page.waitForTimeout(3_300);
  await expect(progress).toHaveAttribute("aria-valuenow", stoppedStep!);
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-mode", "playing");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const manuallyPausedStep = await progress.getAttribute("aria-valuenow");
  await page.locator("footer").last().scrollIntoViewIfNeeded();
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-mode", "paused");
  await page.waitForTimeout(3_300);
  await expect(progress).toHaveAttribute("aria-valuenow", manuallyPausedStep!);
});
