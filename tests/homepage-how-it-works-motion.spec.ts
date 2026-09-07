import { expect, test, type Page } from "@playwright/test";

const timelineSelector = '[data-testid="how-it-works-timeline"]';

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function timelineAnimationFrame(page: Page) {
  return page.locator(timelineSelector).evaluate((element) => {
    const animations = element.getAnimations({ subtree: true });
    const trace = animations.find((animation) => (
      animation instanceof CSSAnimation
      && animation.animationName.includes("process-trace-presence")
    ));

    return {
      currentTime: Number(trace?.currentTime ?? -1),
      names: animations
        .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
        .map((animation) => animation.animationName),
      playState: trace?.playState ?? "missing",
    };
  });
}

test("how-it-works runs one ordered wide handoff and reaches a fully settled final state", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/");

  const timeline = page.locator(timelineSelector);
  await expect(timeline).toHaveAttribute("aria-labelledby", "how-it-works-title");
  await expect(timeline).toHaveAttribute("data-process-layout", "wide");
  await expect(timeline).toHaveAttribute("data-process-duration", "4.15s");
  await expect(timeline).toHaveAttribute("data-process-iteration-count", "1");
  await expect(timeline).toHaveAttribute("data-process-phase", "idle");
  await expect(timeline).toHaveAttribute("data-process-paused", "true");
  await expect(timeline.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("list", { name: "You will know exactly what happens next." })).toHaveCount(1);
  expect((await timelineAnimationFrame(page)).names).toEqual([]);

  await timeline.evaluate((element) => {
    const runtimeWindow = window as typeof window & { __howMarkerOrder?: string[] };
    runtimeWindow.__howMarkerOrder = [];
    element.addEventListener("animationstart", (event) => {
      if (!(event instanceof AnimationEvent) || !event.animationName.includes("process-marker")) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches("[data-process-marker]")) return;
      const step = target.closest<HTMLElement>("[data-process-step]")?.dataset.processStep;
      const order = runtimeWindow.__howMarkerOrder ?? [];
      if (step && !order.includes(step)) runtimeWindow.__howMarkerOrder = [...order, step];
    });
  });

  await timeline.scrollIntoViewIfNeeded();
  await expect(timeline).toHaveAttribute("data-process-active", "true");
  await expect(timeline).toHaveAttribute("data-process-paused", "false");

  await expect.poll(
    () => page.evaluate(() => (
      window as typeof window & { __howMarkerOrder?: string[] }
    ).__howMarkerOrder?.join(",") ?? ""),
    { timeout: 15_000 },
  ).toBe("01,02,03,04");

  await expect(timeline).toHaveAttribute("data-process-complete", "true", { timeout: 2_000 });
  await expect(timeline).toHaveAttribute("data-process-phase", "complete");
  await expect(timeline.locator('[data-process-current="true"]')).toHaveCount(0);
  await expect.poll(async () => (await timelineAnimationFrame(page)).playState, { timeout: 5_000 }).toBe("finished");

  const finalFrame = await timelineAnimationFrame(page);
  await page.waitForTimeout(350);
  expect(await timelineAnimationFrame(page)).toEqual(finalFrame);
  expect(errors).toEqual([]);
});

test("how-it-works pauses its wide animation clock offscreen and while the document is hidden", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/");

  const timeline = page.locator(timelineSelector);
  await timeline.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await timelineAnimationFrame(page)).currentTime, { timeout: 10_000 })
    .toBeGreaterThan(80);

  await page.getByRole("heading", { name: "Tell us where the work sucks. We fix it." }).scrollIntoViewIfNeeded();
  await expect(timeline).toHaveAttribute("data-process-paused", "true");
  await expect.poll(async () => (await timelineAnimationFrame(page)).playState).toBe("paused");
  const offscreenFrame = await timelineAnimationFrame(page);
  await page.waitForTimeout(400);
  const heldOffscreenFrame = await timelineAnimationFrame(page);
  expect(Math.abs(heldOffscreenFrame.currentTime - offscreenFrame.currentTime)).toBeLessThanOrEqual(20);

  await timeline.scrollIntoViewIfNeeded();
  await expect(timeline).toHaveAttribute("data-process-paused", "false");
  await expect.poll(async () => (await timelineAnimationFrame(page)).playState).toBe("running");

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(timeline).toHaveAttribute("data-process-paused", "true");
  const hiddenFrame = await timelineAnimationFrame(page);
  await page.waitForTimeout(400);
  const heldHiddenFrame = await timelineAnimationFrame(page);
  expect(Math.abs(heldHiddenFrame.currentTime - hiddenFrame.currentTime)).toBeLessThanOrEqual(20);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(timeline).toHaveAttribute("data-process-paused", "false");
  const resumedFrame = await timelineAnimationFrame(page);
  await page.waitForTimeout(300);
  expect((await timelineAnimationFrame(page)).currentTime - resumedFrame.currentTime).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});

test("how-it-works exposes a complete neutral fallback under reduced motion", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");

  const timeline = page.locator(timelineSelector);
  await expect(timeline).not.toHaveAttribute("data-process-motion", "true");
  await expect(timeline).toHaveAttribute("data-process-complete", "true");
  await expect(timeline).toHaveAttribute("data-process-phase", "complete");
  await expect(timeline.locator('[data-process-complete="true"]')).toHaveCount(4);
  await expect(timeline.getByRole("listitem")).toHaveCount(4);
  expect(await timeline.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const neutralTrace = await timeline.locator("[data-process-progress]").first().evaluate((element) => ({
    opacity: getComputedStyle(element).opacity,
    transform: getComputedStyle(element.querySelector("[data-process-fill]")!).transform,
  }));
  expect(neutralTrace.opacity).toBe("0");
  expect(neutralTrace.transform).toBe("matrix(0, 0, 0, 1, 0, 0)");
  expect(errors).toEqual([]);
});

for (const width of [390, 320]) {
  test(`how-it-works stays contained and animates each visible step once at ${width}px`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");

    const timeline = page.locator(timelineSelector);
    await expect(timeline).toHaveAttribute("data-process-layout", "compact");
    await expect(timeline).toHaveAttribute("data-process-duration", ".65s-per-step");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    for (const step of ["01", "02", "03", "04"]) {
      const item = timeline.locator(`[data-process-step="${step}"]`);
      await item.scrollIntoViewIfNeeded();
      await expect(item).toHaveAttribute("data-process-active", "true");
      await expect(item).toHaveAttribute("data-process-paused", "false");
      await expect(item).toHaveAttribute("data-process-complete", "true", { timeout: 3_000 });
      expect(await item.evaluate((element) => element.getAnimations({ subtree: true })
        .every((animation) => animation.effect?.getTiming().iterations === 1))).toBe(true);
    }

    await expect(timeline).toHaveAttribute("data-process-complete", "true");
    await expect(timeline).toHaveAttribute("data-process-phase", "complete");
    expect(await timeline.evaluate((element) => {
      const viewportWidth = document.documentElement.clientWidth;
      const bounds = [element, ...element.querySelectorAll<HTMLElement>("*")]
        .map((node) => node.getBoundingClientRect());
      return bounds.every((box) => box.left >= -1 && box.right <= viewportWidth + 1);
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
