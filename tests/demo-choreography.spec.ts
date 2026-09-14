import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });

const scenarios = [
  { id: "after-hours-leads", label: "After-hours leads" },
  { id: "client-intake", label: "Client intake" },
  { id: "returning-clients", label: "Returning clients" },
];

const theatre = (page: Page) => page.getByRole("region", { name: "Automation theatre" });
const artifact = (page: Page) => theatre(page).locator("[data-artifact-step]:visible");

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Local demo choreography review: APIs disabled." } });
    return route.continue();
  });
});

async function openStage(page: Page) {
  await page.goto("/demos");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await expect(artifact(page)).toBeVisible();
}

async function pose(object: Locator) {
  return object.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: box.x, y: box.y, width: box.width, height: box.height, transform: style.transform, opacity: style.opacity, clipPath: style.clipPath };
  });
}

async function finishWorkflowWithClock(page: Page) {
  for (const step of [2, 3, 4]) {
    await page.clock.fastForward(3_050);
    await expect(artifact(page)).toHaveAttribute("data-artifact-step", String(step));
  }
  await page.clock.fastForward(3_050);
  await expect(theatre(page)).toHaveAttribute("data-mode", "complete");
}

test("desktop showcase starts when its stage first becomes visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 200 });
  await page.goto("/demos");
  await expect.poll(() => page.locator("#automation-stage").evaluate((element) => element.getBoundingClientRect().top >= innerHeight)).toBe(true);
  await expect(theatre(page)).toHaveAttribute("data-mode", "idle");
  await expect(theatre(page)).toHaveAttribute("data-showcase", "false");
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await expect(theatre(page)).toHaveAttribute("data-showcase", "true");
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  await expect(artifact(page)).toHaveAttribute("data-artifact-step", "1");
  await expect(page.getByRole("button", { name: "Pause this workflow", exact: true })).toBeVisible();
});

test("offscreen showcase pauses and resumes without overriding a manual pause", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await openStage(page);
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  await page.locator("footer").last().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("#automation-stage").evaluate((element) => element.getBoundingClientRect().bottom <= 0)).toBe(true);
  await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
  const stoppedStep = await artifact(page).getAttribute("data-artifact-step");
  await page.waitForTimeout(3_250);
  await expect(artifact(page)).toHaveAttribute("data-artifact-step", stoppedStep!);
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  await page.getByRole("button", { name: "Pause this workflow", exact: true }).click();
  await expect(theatre(page)).toHaveAttribute("data-showcase", "false");
  const manuallyPausedStep = await artifact(page).getAttribute("data-artifact-step");
  await page.locator("footer").last().scrollIntoViewIfNeeded();
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await page.waitForTimeout(3_250);
  await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
  await expect(artifact(page)).toHaveAttribute("data-artifact-step", manuallyPausedStep!);
});

test("restart cancels showcase until the user explicitly enables it again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await openStage(page);
  await theatre(page).getByRole("button", { name: "Restart automation demo", exact: true }).click();
  await expect(theatre(page)).toHaveAttribute("data-showcase", "false");
  await expect(theatre(page)).toHaveAttribute("data-mode", "idle");
  await page.locator("footer").last().scrollIntoViewIfNeeded();
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await page.waitForTimeout(3_250);
  await expect(theatre(page)).toHaveAttribute("data-mode", "idle");
  await expect(artifact(page)).toHaveAttribute("data-artifact-step", "0");
  await page.getByRole("button", { name: "Watch all workflows", exact: true }).click();
  await expect(theatre(page)).toHaveAttribute("data-showcase", "true");
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  await page.getByRole("button", { name: "Watch all workflows", exact: true }).click();
  await expect(theatre(page)).toHaveAttribute("data-showcase", "false");
  await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
});

test("showcase cycles all workflows and cancels hidden and mobile transitions", async ({ page }) => {
  // This clock test checks route scheduling only. Real CSS motion is checked below.
  await page.clock.install();
  await openStage(page);
  const showcase = page.getByRole("button", { name: "Watch all workflows", exact: true });
  await theatre(page).getByRole("button", { name: "Restart automation demo", exact: true }).click();
  await expect(theatre(page)).toHaveAttribute("data-mode", "idle");
  await showcase.click();
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  for (const [index, scenario] of scenarios.entries()) {
    await expect(artifact(page)).toHaveAttribute("data-scenario", scenario.id);
    await expect(theatre(page).locator('span[class*="windowDots"] > i[data-filled="true"]')).toHaveCount(index + 1);
    await expect(artifact(page)).toHaveAttribute("data-artifact-step", "1");
    await finishWorkflowWithClock(page);
    await expect(theatre(page).locator('button[data-icon][data-state="complete"]')).toHaveCount(4);
    await page.clock.fastForward(2_250);
    await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  }
  await expect(artifact(page)).toHaveAttribute("data-scenario", scenarios[0].id);
  await expect(theatre(page).locator('span[class*="windowDots"] > i[data-filled="true"]')).toHaveCount(1);
  await finishWorkflowWithClock(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(theatre(page)).toHaveAttribute("data-showcase", "false");
  await page.clock.fastForward(3_250);
  await expect(artifact(page)).toHaveAttribute("data-scenario", scenarios[0].id);
  await expect(theatre(page)).toHaveAttribute("data-mode", "complete");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await showcase.click();
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(theatre(page)).toHaveAttribute("data-showcase", "false");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await page.clock.fastForward(3_250);
  await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
});

for (const scenario of scenarios) {
  test(`${scenario.label}: objects move, pause freezes them, and inspection settles the output`, async ({ page }) => {
    await openStage(page);
    await theatre(page).getByRole("tab", { name: new RegExp(scenario.label) }).click();
    await page.getByRole("button", { name: "Play this workflow", exact: true }).click();
    await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
    const source = artifact(page).locator('[data-motion-object="source"]');
    const movingObject = source;
    const initialPose = await pose(movingObject);
    await expect.poll(() => pose(movingObject), { timeout: 2_000 }).not.toEqual(initialPose);
    await page.getByRole("button", { name: "Pause this workflow", exact: true }).click();
    await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
    const pausedStep = await artifact(page).getAttribute("data-artifact-step");
    const frozenPose = await pose(movingObject);
    await page.waitForTimeout(350);
    expect(await pose(movingObject)).toEqual(frozenPose);
    await page.waitForTimeout(3_050);
    await expect(artifact(page)).toHaveAttribute("data-artifact-step", pausedStep!);
    await page.getByRole("button", { name: "Play this workflow", exact: true }).click();
    await theatre(page).getByRole("button", { name: /Pause at step 3:/ }).click();
    await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
    await expect(artifact(page)).toHaveAttribute("data-artifact-step", "3");
    const output = artifact(page).locator('[data-motion-object="output"]');
    await expect(output).toBeVisible();
    await expect(output).toHaveCSS("opacity", "1");
    const settledPose = await pose(output);
    await page.waitForTimeout(250);
    expect(await pose(output)).toEqual(settledPose);
    const typedCharacters = output.locator('p > span[aria-hidden="true"] > span');
    if (await typedCharacters.count()) {
      expect(await typedCharacters.evaluateAll((letters) => letters.every((letter) => Number(getComputedStyle(letter).opacity) >= 0.99))).toBe(true);
    }
  });
}

test("inspecting the current mobile step settles its partially typed output", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demos");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("button", { name: /After-hours leads/ }).click();
  await page.getByRole("button", { name: /Step 3 of 4/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForTimeout(200);
  // The selected step does not change. Inspection still needs a settled pose.
  await page.getByRole("button", { name: /Step 3 of 4/ }).click();
  await expect(page.getByRole("status")).toContainText("Paused. Step 3 of 4");
  const letters = artifact(page).locator('[data-motion-object="output"] p > span[aria-hidden="true"] > span');
  await expect(letters.first()).toBeVisible();
  expect(await letters.evaluateAll((nodes) => nodes.every((letter) => Number(getComputedStyle(letter).opacity) >= 0.99))).toBe(true);
});
test("system reduced-motion fallback leaves a fully readable still scene", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStage(page);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await expect(theatre(page)).toHaveAttribute("data-mode", "playing");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
  await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
  await theatre(page).getByRole("button", { name: "Restart automation demo", exact: true }).click();
  await theatre(page).getByRole("button", { name: "Run After-hours leads automation", exact: true }).click();
  await expect(theatre(page)).toHaveAttribute("data-mode", "paused");
  const source = artifact(page).locator('[data-motion-object="source"]');
  await expect(source).toHaveCSS("opacity", "1");
  const stillPose = await pose(source);
  await page.waitForTimeout(3_250);
  expect(await pose(source)).toEqual(stillPose);
  await expect(artifact(page)).toHaveAttribute("data-artifact-step", "1");
  expect(await artifact(page).evaluate((element) => element.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(false);
});

for (const width of [320, 390, 980, 1440]) {
  test(`all three scenes fit ${width}px during manual inspection`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 769 ? 844 : 1000 });
    await page.goto("/demos");
    for (const scenario of scenarios) {
      if (width < 769) {
        await page.getByRole("button", { name: "Change", exact: true }).click();
        await page.getByRole("button", { name: new RegExp(scenario.label) }).click();
        await page.getByRole("button", { name: /Step 3 of 4/ }).click();
      } else {
        await theatre(page).getByRole("tab", { name: new RegExp(scenario.label) }).click();
        await page.getByRole("button", { name: "Play this workflow", exact: true }).click();
        await theatre(page).getByRole("button", { name: /Pause at step 3:/ }).click();
      }
      await expect(artifact(page)).toHaveAttribute("data-scenario", scenario.id);
      await expect(artifact(page)).toHaveAttribute("data-artifact-step", "3");
      const geometry = await artifact(page).evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, viewport: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
    }
  });
}

for (const scenario of scenarios.filter((candidate) => candidate.id !== "client-intake")) {
  test(`${scenario.label}: reply finishes typing before sent status appears`, async ({ page }) => {
    await openStage(page);
    await theatre(page).getByRole("tab", { name: new RegExp(scenario.label) }).click();
    await page.getByRole("button", { name: "Play this workflow", exact: true }).click();
    await theatre(page).getByRole("button", { name: /Pause at step 3:/ }).click();
    await expect(artifact(page)).toHaveAttribute("data-artifact-step", "3");
    await page.getByRole("button", { name: "Play this workflow", exact: true }).click();
    await expect(artifact(page)).toHaveAttribute("data-animated", "true");
    const samples = await artifact(page).evaluate(async (element) => {
      const letters = [...element.querySelectorAll('[data-motion-object="output"] p > span[aria-hidden="true"] > span')];
      const sent = [...element.querySelectorAll("div")].find((node) => /^(Personalized reply|Relevant message) sent$/.test(node.textContent?.trim() ?? ""));
      if (!sent || letters.length === 0) throw new Error("Reply timing targets are missing");
      const started = performance.now();
      let partial: { visible: number; sentOpacity: number } | null = null;
      while (performance.now() - started < 2_800) {
        const visible = letters.filter((letter) => Number(getComputedStyle(letter).opacity) >= 0.99).length;
        const sentOpacity = Number(getComputedStyle(sent).opacity);
        if (visible > 0 && visible < letters.length && partial === null) partial = { visible, sentOpacity };
        if (sentOpacity > 0) return { partial, visible, total: letters.length, sentOpacity };
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      throw new Error("The sent status did not appear during the reply phase");
    });
    expect(samples.partial).not.toBeNull();
    expect(samples.partial!.sentOpacity).toBe(0);
    expect(samples.visible).toBe(samples.total);
    expect(samples.sentOpacity).toBeGreaterThan(0);
  });
}

test("desktop header dots show cumulative workflow progress on manual selection", async ({ page }, testInfo) => {
  await openStage(page);
  for (const index of [0, 1, 2, 0]) {
    await theatre(page).getByRole("tab", { name: new RegExp(scenarios[index].label) }).click();
    const dots = theatre(page).locator('span[class*="windowDots"] > i');
    await expect(dots).toHaveCount(3);
    expect(await dots.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor)))
      .toEqual([0, 1, 2].map((dotIndex) => dotIndex <= index ? "rgb(232, 62, 89)" : "rgb(96, 104, 115)"));
    await page.screenshot({ path: testInfo.outputPath(`dots-${index + 1}.png`) });
  }
});
