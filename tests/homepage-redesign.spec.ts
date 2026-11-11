import { expect, test } from "@playwright/test";

const credibilityNavigation = [
  ["Client work", "/#client-work"],
  ["Process", "/#process"],
  ["Demos", "/demos"],
  ["FAQ", "/#faq"],
] as const;

test("credibility-first homepage keeps supported navigation and section order", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    level: 1,
    name: "AI workflow systems for service businesses.",
  })).toBeVisible();
  for (const heading of [
    "Proof you can inspect.",
    "Client proof library. See the work move.",
    "You know the route before the build begins.",
    "The practical questions, answered plainly.",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  const header = page.getByRole("banner");
  for (const [name, href] of credibilityNavigation) {
    await expect(header.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  await expect(header.getByRole("link", { name: "Discuss a workflow" })).toHaveAttribute("href", /^mailto:/);

  const orderedSections = page.locator([
    "#client-work",
    "#process",
    "#faq",
  ].join(", "));
  expect(await orderedSections.evaluateAll((elements) => elements.map((element) => element.id))).toEqual([
    "client-work",
    "process",
    "faq",
  ]);

  const hero = page.getByRole("heading", {
    level: 1,
    name: "AI workflow systems for service businesses.",
  }).locator("xpath=ancestor::section[1]");
  await expect(hero.locator('[data-hero-carousel="true"]')).toHaveCount(1);

  const clientWork = page.locator("#client-work");
  await expect(clientWork.getByRole("button", { name: "Play Karol's client testimonial video" }))
    .toHaveCount(1);

  expect(await clientWork.evaluate((element) => element.nextElementSibling?.id)).toBe("process");
  expect(await page.locator("#process").evaluate((element) => element.nextElementSibling?.firstElementChild?.id))
    .toBe("faq");
});

test("homepage carousel cycles through all three systems and honors pause state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AI workflow systems for service businesses." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");

  const carousel = page.locator('[data-hero-carousel="true"]');
  const sceneViewport = carousel.locator('[data-scene-viewport="true"]');
  const mountedScenes = carousel.locator("[data-scene]");
  const heroVisual = carousel.locator("xpath=ancestor::aside[1]");
  const systemTitle = page.locator('[data-system-preview-title="true"]:visible');

  await expect(heroVisual).toHaveCount(1);
  await carousel.scrollIntoViewIfNeeded();
  await expect(carousel).toHaveAttribute("data-paused", "false");
  await page.getByRole("button", { name: "Pause illustrative systems" }).click();
  await expect(page.getByRole("button", { name: "Play illustrative systems" })).toBeVisible();
  // Increase playback speed without changing duration or seeking the timeline:
  // either can emit queued iteration events even while paused and skip a scene.
  const accelerated = await sceneViewport.evaluate((element) => {
    const animations = element.getAnimations();
    for (const animation of animations) {
      const duration = Number(animation.effect?.getTiming().duration);
      if (Number.isFinite(duration) && duration > 0) animation.updatePlaybackRate(duration / 1_500);
    }
    return animations.length;
  });
  expect(accelerated).toBeGreaterThan(0);

  const sceneTitles = {
    network: "System / lead triage map",
    routing: "System / after-hours routing desk",
    mindmap: "System / handoff mind map",
  } as const;

  const expectScene = async (scene: "network" | "routing" | "mindmap") => {
    await expect.poll(
      () => carousel.getAttribute("data-active-scene"),
      { timeout: 6_000 },
    ).toBe(scene);
    await expect(mountedScenes).toHaveCount(1);
    await expect(sceneViewport).toHaveAttribute("data-scene", scene);
    await expect(systemTitle).toHaveText(sceneTitles[scene]);
  };

  const sequence = ["network", "routing", "mindmap"] as const;
  const initialScene = await carousel.getAttribute("data-active-scene");
  const initialIndex = sequence.findIndex((scene) => scene === initialScene);
  expect(initialIndex).toBeGreaterThanOrEqual(0);
  await expectScene(sequence[initialIndex]);
  await page.getByRole("button", { name: "Play illustrative systems" }).click();
  await expect(carousel).toHaveAttribute("data-paused", "false");
  for (let step = 1; step <= sequence.length; step += 1) {
    await expectScene(sequence[(initialIndex + step) % sequence.length]);
  }

  await page.getByRole("button", { name: "Pause illustrative systems" }).click();
  await expect(carousel).toHaveAttribute("data-paused", "true");
  await expect(sceneViewport).toHaveCSS("animation-play-state", "paused");

  const manuallyPausedScene = await carousel.getAttribute("data-active-scene");
  await page.waitForTimeout(1_800);
  await expect(carousel).toHaveAttribute("data-active-scene", manuallyPausedScene ?? "");
  await expect(mountedScenes).toHaveCount(1);

  await page.getByRole("button", { name: "Play illustrative systems" }).click();
  await expect(carousel).toHaveAttribute("data-paused", "false");
  await expect(sceneViewport).toHaveCSS("animation-play-state", "running");
  const sceneAfterManualResume = manuallyPausedScene === "network"
    ? "routing"
    : manuallyPausedScene === "routing"
      ? "mindmap"
      : "network";
  await expectScene(sceneAfterManualResume);

  const faqHeading = page.getByRole("heading", { name: "The practical questions, answered plainly." });
  await faqHeading.scrollIntoViewIfNeeded();
  await expect(faqHeading).toBeVisible();
  await expect(carousel).toHaveAttribute("data-paused", "true");

  const offscreenPausedScene = await carousel.getAttribute("data-active-scene");
  await page.waitForTimeout(1_800);
  await expect(carousel).toHaveAttribute("data-active-scene", offscreenPausedScene ?? "");
  await expect(mountedScenes).toHaveCount(1);

  await carousel.scrollIntoViewIfNeeded();
  await expect(carousel).toHaveAttribute("data-paused", "false");
  const sceneAfterViewportResume = offscreenPausedScene === "network"
    ? "routing"
    : offscreenPausedScene === "routing"
      ? "mindmap"
      : "network";
  await expectScene(sceneAfterViewportResume);
});

test("after-hours routing labels fit their stations without colliding with stage numbers", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });

  for (const width of [1440, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const carousel = page.locator('[data-hero-carousel="true"]');
    const sceneViewport = carousel.locator('[data-scene-viewport="true"]');
    await carousel.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Pause illustrative systems" }).click();
    await sceneViewport.dispatchEvent("animationiteration");
    await expect(carousel).toHaveAttribute("data-active-scene", "routing");

    const stations = sceneViewport.locator("svg:visible [data-stage]");
    await expect(stations).toHaveCount(4);

    const measurements = await stations.evaluateAll((elements) => elements.map((station) => {
      const face = station.querySelector<SVGGraphicsElement>('[data-node-surface="true"]')!;
      const label = station.querySelector<SVGGraphicsElement>('[data-station-label="true"]')!;
      const index = station.querySelector<SVGGraphicsElement>('[data-station-index="true"]')!;
      const faceBox = face.getBBox();
      const labelBox = label.getBBox();
      const indexBox = index.getBBox();

      return {
        indexInside: indexBox.x + indexBox.width <= faceBox.x + faceBox.width,
        label: label.textContent,
        labelInside: labelBox.x >= faceBox.x && labelBox.x + labelBox.width <= faceBox.x + faceBox.width,
        spaceBeforeIndex: indexBox.x - (labelBox.x + labelBox.width),
      };
    }));

    expect(measurements.map(({ label }) => label)).toEqual([
      "New input",
      "Read context",
      "Shape route",
      "Human review",
    ]);
    expect(measurements.every(({ indexInside, labelInside }) => indexInside && labelInside)).toBe(true);
    expect(measurements.every(({ spaceBeforeIndex }) => spaceBeforeIndex >= 5)).toBe(true);
  }
});

test("homepage keeps a useful static route when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));

  const hero = page.locator('[data-hero-carousel="true"]');
  await expect(hero.locator('[data-static-fallback="true"]')).toBeVisible();
  await expect(hero.locator('[data-scene-viewport="true"]')).toBeHidden();

  const integrations = page.getByRole("heading", { name: "Ajani integrates with" })
    .locator("xpath=ancestor::section[1]");
  await expect(integrations.getByRole("button")).toHaveCount(0);
  expect(await integrations.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const proofs = page.getByRole("group", { name: "Client proof carousel" });
  await proofs.scrollIntoViewIfNeeded();
  await expect(proofs).toHaveAttribute("data-pause-reason", "reduced-motion");
  await expect(proofs.getByRole("button", { name: /client proof scroll/i })).toHaveCount(0);
  expect(await proofs.getByRole("list", { name: "Five client proof slides" })
    .evaluate((rail) => rail.scrollWidth > rail.clientWidth)).toBe(true);

  const process = page.locator("#process");
  await process.scrollIntoViewIfNeeded();
  await expect(process.getByTestId("how-it-works-timeline").getByRole("listitem")).toHaveCount(4);
  await expect(page.locator("#faq button[aria-expanded]")).toHaveCount(8);
  await expect(page.locator("#contact")).toHaveCount(0);
});

test("homepage content remains visible if viewport observation is unavailable", async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "IntersectionObserver"));
  await page.goto("/");

  for (const heading of [
    "AI workflow systems for service businesses.",
    "Proof you can inspect.",
    "Client proof library. See the work move.",
    "You know the route before the build begins.",
    "The practical questions, answered plainly.",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("homepage remains contained at narrow mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");
  await page.locator("#client-work").scrollIntoViewIfNeeded();
  await expect(page.getByRole("group", { name: "Client proof carousel" })).toHaveAttribute("data-carousel-state", "playing");
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
  for (const [name, href] of credibilityNavigation) {
    await expect(mobileNavigation.getByRole("link", { exact: true, name })).toHaveAttribute("href", href);
  }
  await page.getByRole("button", { name: "Close navigation menu" }).click();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    for (const section of ["#client-work", "#process", "#faq"]) {
      await expect(page.locator(section)).toBeVisible();
    }
  }
});
