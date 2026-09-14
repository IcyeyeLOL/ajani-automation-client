import { expect, test, type Locator, type Page } from "@playwright/test";

// These regressions inspect rendered CSS and public controls. Explicit system
// fallback tests synthesize the opt-in override, plus browser capability loss.
// No provider, database, or external HTTP request is permitted by this suite.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 503, json: { error: "Local motion audit: APIs disabled." } });
      return;
    }
    await route.continue();
  });
});

async function overrideMotion(page: Page, full: boolean) {
  await page.locator("html").evaluate((element, enabled) => {
    if (enabled) element.setAttribute("data-motion", "full");
    else element.setAttribute("data-motion", "system");
  }, full);
}

async function expectOpaqueContent(locator: Locator) {
  await expect(locator).toBeVisible();
  // toBeVisible alone does not reject opacity:0 on a reveal ancestor.
  await expect.poll(() => locator.evaluate((element) => {
    let parent: Element | null = element;
    while (parent) {
      const style = getComputedStyle(parent);
      if (Number(style.opacity) < 0.99 || style.visibility === "hidden" || style.display === "none") return false;
      parent = parent.parentElement;
    }
    return true;
  })).toBe(true);
}

test("homepage honors explicit system fallback and live full-motion override", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await overrideMotion(page, false);
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");
  const carousel = page.locator('[data-hero-carousel="true"]');
  const scene = carousel.locator('[data-scene-viewport="true"]');
  const fallback = carousel.locator('[data-static-fallback="true"]');
  await expect(scene).toBeHidden();
  await expect(fallback).toBeVisible();
  expect(await fallback.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  const timeline = page.getByTestId("how-it-works-timeline");
  await expect(timeline).toHaveAttribute("data-process-complete", "true");
  expect(await timeline.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await overrideMotion(page, true);
  await expect(scene).toBeVisible();
  await expect(fallback).toBeHidden();
  await expect.poll(() => scene.evaluate((node) => node.getAnimations().some((animation) => animation.playState === "running"))).toBe(true);
  await overrideMotion(page, false);
  await expect(scene).toBeHidden();
  await expect(fallback).toBeVisible();
  expect(await fallback.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(scene).toBeVisible();
  await expect.poll(() => scene.evaluate((node) => node.getAnimations().some((animation) => animation.playState === "running"))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(scene).toBeHidden();
  await expect(fallback).toBeVisible();
});

test("desktop preference changes keep CSS playback and JavaScript state aligned", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");
  await overrideMotion(page, false);
  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await theatre.getByRole("button", { name: "Restart automation demo", exact: true }).click();
  const status = theatre.getByRole("status");
  const firstNode = theatre.getByRole("button", { name: /(?:Run from|Pause at) step 1: Lead signal/ });
  const firstPath = theatre.locator('svg[viewBox="0 0 1000 230"] path').first();
  await expect(status).toContainText("Motion is simplified for this device.");
  await expect(firstNode).toHaveCSS("animation-name", "none");
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(status).toContainText("Paused at Lead signal.");
  await page.waitForTimeout(3_250); // Exceeds the 3-second public demo step clock.
  await expect(status).toContainText("Paused at Lead signal.");

  await overrideMotion(page, true);
  await expect(status).not.toContainText("Motion is simplified");
  await expect(firstNode).toHaveCSS("animation-name", /graph-node-enter/);
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(theatre).toHaveAttribute("data-mode", "playing");
  await expect(firstPath).toHaveCSS("animation-name", /route-dash/);
  await overrideMotion(page, false);
  await expect(theatre).toHaveAttribute("data-mode", "paused");
  await expect(firstNode).toHaveCSS("animation-name", "none");
  await expect(firstPath).toHaveCSS("animation-name", "none");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(status).not.toContainText("Motion is simplified");
  await expect(theatre).toHaveAttribute("data-mode", "paused");
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(theatre).toHaveAttribute("data-mode", "playing");
  await expect(firstPath).toHaveCSS("animation-name", /route-dash/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(theatre).toHaveAttribute("data-mode", "paused");
  await expect(firstNode).toHaveCSS("animation-name", "none");
});

test("mobile explicit system fallback is manual but permits full showcase playback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");
  await overrideMotion(page, false);
  const status = page.getByRole("status");
  await expect(status).toContainText("Paused. Step 1 of 4");
  await expect(status).toContainText("Reduced motion is on; playback is manual.");
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-name", "none");
  await page.waitForTimeout(3_250);
  await expect(status).toContainText("Paused. Step 1 of 4");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("button", { name: /Run the full showcase/ }).click();
  await expect(status).toContainText("Auto running. Step 1 of 4");
  await expect(status).toContainText("Full showcase mode is on.");
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-name", /packet-travel/);
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-play-state", "running");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2", { timeout: 5_000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-play-state", "paused");
  // The browser can advance between the progress read and a real user click.
  // Assert that whichever step receives that click stays paused, not step 2.
  await expect(status).toContainText(/Paused\. Step [2-4] of 4/);
  const pausedStep = await page.getByRole("progressbar").getAttribute("aria-valuenow");
  await page.waitForTimeout(3_250);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", pausedStep!);
});

test("mobile live full-motion override enables both scenario timers and their CSS", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");
  await overrideMotion(page, false);
  await expect(page.getByRole("status")).toContainText("Paused. Step 1 of 4");
  await overrideMotion(page, true);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("button", { name: /After-hours leads/ }).click();
  await expect(page.getByRole("status")).toContainText("Running. Step 1 of 4");
  await expect(page.getByRole("status")).not.toContainText("Full showcase mode is on.");
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-name", /packet-travel/);
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-play-state", "running");
  await overrideMotion(page, false);
  await expect(page.getByRole("status")).toContainText(/Paused\. Step [1-4] of 4/);
  await expect(page.getByTestId("signal-packet")).toHaveCSS("animation-name", "none");
});

test("homepage and approach reveal readable content without IntersectionObserver (synthetic capability loss)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // The external auth script is deliberately denied by this local-only suite.
    // Do not confuse that explicit network boundary with a motion runtime error.
    if (!error.message.includes('code="failed_to_load_clerk_js"')) errors.push(error.message);
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => { Reflect.deleteProperty(window, "IntersectionObserver"); });
  await page.goto("/");
  expect(await page.evaluate(() => typeof IntersectionObserver)).toBe("undefined");
  for (const name of [
    "Tell us where the work sucks. We fix it.",
    "Different businesses, the same gap.",
    "Private by default. Clear by design.",
  ]) await expectOpaqueContent(page.getByRole("heading", { name, exact: true }));
  const proof = page.getByRole("complementary", { name: "Real client system" });
  await expect(proof).toHaveAttribute("data-client-proof-active", "true");
  await expectOpaqueContent(proof.locator('[data-client-proof-result="true"]'));

  await page.goto("/approach");
  expect(await page.evaluate(() => typeof IntersectionObserver)).toBe("undefined");
  await expectOpaqueContent(page.getByRole("heading", { name: "No automation until the business problem is actually understood." }));
  const stages = page.locator("main article");
  await expect(stages).toHaveCount(4);
  for (const stage of await stages.all()) await expectOpaqueContent(stage);
  expect(errors).toEqual([]);
});

test("desktop manual pause and synthetic document-hidden pause stop the step clock", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/demos");
  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await theatre.getByRole("button", { name: "Restart automation demo", exact: true }).click();
  const status = theatre.getByRole("status");
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(theatre).toHaveAttribute("data-mode", "playing");
  await theatre.getByRole("button", { name: "Pause After-hours leads automation" }).click();
  await expect(status).toContainText("Paused at Lead signal.");
  await page.waitForTimeout(3_250);
  await expect(status).toContainText("Paused at Lead signal.");

  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(theatre).toHaveAttribute("data-mode", "playing");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(status).toContainText("Paused at Lead signal.");
  await page.waitForTimeout(3_250);
  await expect(status).toContainText("Paused at Lead signal.");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(theatre).toHaveAttribute("data-mode", "paused");
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(status).toContainText("Playing automation: Intent scan.", { timeout: 5_000 });
});
