import { expect, test } from "@playwright/test";

const credibilityNavigation = [
  ["Solutions", "/#solutions"],
  ["Industries", "/#industries"],
  ["Client work and Stories", "/stories"],
  ["Process", "/#process"],
  ["About", "/#about"],
  ["Demos", "/demos"],
  ["Contact", "/#contact"],
] as const;

test("credibility-first homepage keeps supported navigation and section order", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    level: 1,
    name: "AI workflow systems for service businesses.",
  })).toBeVisible();
  for (const heading of [
    "Proof you can inspect.",
    "A named client story. One measurable case.",
    "Start with the expensive handoff, not an AI shopping list.",
    "Different businesses. The same operational gap.",
    "A working request system, not a generic simulation.",
    "You know the route before the build begins.",
    "Start with the stronger result. Click through the proof.",
    "The controls should be as visible as the workflow.",
    "Know who is behind the system and what is still missing.",
    "Bring the process that keeps slipping. We will make the route discussable.",
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
    "#client-voices",
    "#solutions",
    "#industries",
    "#process",
    "#engagement",
    "#security",
    "#about",
    "#faq",
    "#contact",
  ].join(", "));
  expect(await orderedSections.evaluateAll((elements) => elements.map((element) => element.id))).toEqual([
    "client-work",
    "solutions",
    "industries",
    "process",
    "client-voices",
    "engagement",
    "security",
    "about",
    "faq",
    "contact",
  ]);

  const hero = page.getByRole("heading", {
    level: 1,
    name: "AI workflow systems for service businesses.",
  }).locator("xpath=ancestor::section[1]");
  await expect(hero.locator('[data-hero-carousel="true"]')).toHaveCount(1);

  const clientWork = page.locator("#client-work");
  await expect(clientWork.getByTitle("Karol from Granker's Team shares his experience working with Ajani"))
    .toHaveCount(1);
  expect(await clientWork.evaluate((element) => element.nextElementSibling?.id)).toBe("client-voices");

  const productionSystem = page.locator("#industries + section");
  await expect(productionSystem.getByRole("heading", {
    name: "A working request system, not a generic simulation.",
  })).toBeVisible();
  await expect(productionSystem.locator('[data-hero-carousel="true"]')).toHaveCount(0);
  await expect(productionSystem).toContainText("Request → route → review → delivery brief");
  expect(await productionSystem.evaluate((element) => element.nextElementSibling?.id)).toBe("process");

  const additionalClientWork = page.locator("#process + section");
  await expect(additionalClientWork.getByRole("heading", {
    name: "The route stays visible where judgment matters.",
  })).toBeVisible();
  await expect(additionalClientWork.getByRole("complementary", { name: "Real client system" })).toHaveCount(1);
  expect(await additionalClientWork.evaluate((element) => element.nextElementSibling?.firstElementChild?.id))
    .toBe("engagement");
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

  const securityHeading = page.getByRole("heading", { name: "The controls should be as visible as the workflow." });
  const securityReveal = securityHeading.locator("xpath=../..");
  await expect(securityReveal).toHaveCSS("opacity", "0");
  await securityHeading.scrollIntoViewIfNeeded();
  await expect(securityReveal).toHaveCSS("opacity", "1");
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

test("real client proof plays one sourced sequential halo and fully settles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  await page.goto("/");

  const proof = page.getByRole("complementary", { name: "Real client system" });
  const stages = proof.locator("[data-client-proof-stage]");
  const route = proof.locator("ol");
  const result = proof.locator('[data-client-proof-result="true"]');
  const storyLink = page.getByRole("link", { name: "Review the client-work library" });

  await expect(proof).toHaveCount(1);
  await expect(proof).toHaveAttribute("data-client-proof-motion", "true");
  await expect(proof.getByRole("button")).toHaveCount(0);
  await expect(stages).toHaveCount(4);
  expect(await stages.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-client-proof-stage"))))
    .toEqual(["01", "02", "03", "04"]);
  await expect(storyLink).toHaveAttribute("href", "/stories");

  const sourcedSteps = [
    "A patient calls while the front desk is closed.",
    "The reason and relevant details are captured.",
    "The request arrives as structured context.",
    "Urgent cases reach the practice with the conversation attached.",
  ];
  for (const [index, copy] of sourcedSteps.entries()) {
    await expect(stages.nth(index)).toContainText(copy);
    await expect(stages.nth(index)).toBeVisible();
  }

  await proof.scrollIntoViewIfNeeded();
  await expect(proof).toHaveAttribute("data-client-proof-active", "true");
  await expect(proof).toHaveAttribute("data-client-proof-paused", "false");

  expect(await route.evaluate((element) => ({
    afterAnimation: getComputedStyle(element, "::after").animationName,
    afterContent: getComputedStyle(element, "::after").content,
    beforeAnimation: getComputedStyle(element, "::before").animationName,
    beforeContent: getComputedStyle(element, "::before").content,
  }))).toEqual({
    afterAnimation: "none",
    afterContent: "none",
    beforeAnimation: "none",
    beforeContent: "none",
  });

  const stageStyles = await stages.evaluateAll((elements) => elements.map((element) => {
    const row = getComputedStyle(element, "::before");
    const badge = getComputedStyle(element.querySelector("b")!);
    const visual = getComputedStyle(element.querySelector(':scope > [aria-hidden="true"]')!);
    return {
      badgeCount: badge.animationIterationCount,
      badgeName: badge.animationName,
      delay: row.animationDelay,
      duration: row.animationDuration,
      rowCount: row.animationIterationCount,
      rowName: row.animationName,
      visualCount: visual.animationIterationCount,
      visualName: visual.animationName,
    };
  }));
  expect(stageStyles.map((style) => style.delay)).toEqual(["0.28s", "1.05s", "1.82s", "2.59s"]);
  for (const style of stageStyles) {
    expect(style.rowName).toMatch(/case-row-halo/);
    expect(style.duration).toBe("0.86s");
    expect(style.rowCount).toBe("1");
    expect(style.badgeName).toBe("none");
    expect(style.badgeCount).toBe("1");
    expect(style.visualName).toBe("none");
    expect(style.visualCount).toBe("1");
  }
  await expect(result).toHaveCSS("animation-name", "none");
  await expect(result).toHaveCSS("animation-iteration-count", "1");

  const haloFrame = () => proof.evaluate((element) => {
    const animations = element.getAnimations({ subtree: true })
      .filter((candidate): candidate is CSSAnimation => (
        candidate instanceof CSSAnimation && candidate.animationName.includes("case-row-halo")
      ));
    const outcome = element.querySelector<HTMLElement>('[data-client-proof-result="true"]')!;
    // The first halo legitimately finishes at 1.14s while the sequence keeps
    // running until 3.45s. Measure the last halo's clock so a completed first
    // stage cannot be mistaken for a stalled resume under a busy test runner.
    const sequenceClock = animations.at(-1);
    return {
      currentTime: Number(sequenceClock?.currentTime ?? -1),
      haloOpacities: Array.from(element.querySelectorAll("li"), (stage) => (
        getComputedStyle(stage, "::before").opacity
      )),
      names: animations.map((animation) => animation.animationName),
      outcomeOpacity: getComputedStyle(outcome).opacity,
      outcomeTransform: getComputedStyle(outcome).transform,
      playState: sequenceClock?.playState ?? "missing",
      playStates: animations.map((animation) => animation.playState),
    };
  });

  await expect.poll(async () => (await haloFrame()).currentTime, { timeout: 1_500 }).toBeGreaterThan(80);
  expect((await haloFrame()).names).toHaveLength(4);
  expect((await haloFrame()).names.every((name) => name.endsWith("case-row-halo"))).toBe(true);
  await page.getByRole("heading", { name: "AI workflow systems for service businesses." }).scrollIntoViewIfNeeded();
  await expect(proof).toHaveAttribute("data-client-proof-paused", "true");
  await expect.poll(async () => (await haloFrame()).playState).toBe("paused");
  const pausedFrame = await haloFrame();
  await page.waitForTimeout(400);
  const heldOffscreenFrame = await haloFrame();
  expect(Math.abs(heldOffscreenFrame.currentTime - pausedFrame.currentTime)).toBeLessThanOrEqual(20);
  expect(heldOffscreenFrame.haloOpacities).toEqual(pausedFrame.haloOpacities);

  await proof.scrollIntoViewIfNeeded();
  await expect(proof).toHaveAttribute("data-client-proof-paused", "false");
  await expect.poll(async () => (await haloFrame()).playState).toBe("running");
  const resumedFrame = await haloFrame();
  await expect.poll(async () => (await haloFrame()).currentTime - resumedFrame.currentTime,
    { timeout: 1_500 }).toBeGreaterThan(150);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(proof).toHaveAttribute("data-client-proof-paused", "true");
  const hiddenFrame = await haloFrame();
  await page.waitForTimeout(400);
  const heldHiddenFrame = await haloFrame();
  expect(Math.abs(heldHiddenFrame.currentTime - hiddenFrame.currentTime)).toBeLessThanOrEqual(20);
  expect(heldHiddenFrame.haloOpacities).toEqual(hiddenFrame.haloOpacities);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(proof).toHaveAttribute("data-client-proof-paused", "false");

  await expect.poll(async () => (await haloFrame()).playStates, { timeout: 5_000 })
    .toEqual(["finished", "finished", "finished", "finished"]);
  const completedFrame = await haloFrame();
  expect(completedFrame.haloOpacities).toEqual(["0", "0", "0", "0"]);
  expect(completedFrame.outcomeOpacity).toBe("1");
  await page.waitForTimeout(400);
  expect(await haloFrame()).toEqual(completedFrame);
  expect(runtimeErrors).toEqual([]);
});

test("homepage has a meaningful static route when the full-motion override is absent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");

  const carousel = page.locator('[data-hero-carousel="true"]');
  const sceneViewport = carousel.locator('[data-scene-viewport="true"]');
  const fallback = carousel.locator('[data-static-fallback="true"]');

  await expect(sceneViewport).toBeHidden();
  await expect(sceneViewport).toHaveCSS("display", "none");
  await expect(fallback).toBeVisible();
  await expect(fallback.locator('[data-route-path="true"]').first()).toHaveCSS("animation-name", "none");
  await expect(fallback.locator('[data-waveform="true"]').first()).toHaveCSS("animation-name", "none");
  await expect(fallback.locator('[data-node-surface="true"]').first()).toHaveCSS("opacity", "1");
  await expect(fallback.locator("p")).toContainText("Your note");
  await expect(fallback.locator("p")).toContainText("a route your team can review");
  expect(await fallback.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const clinics = page.getByRole("tab", { name: "Clinics & practices" });
  await clinics.click();
  await expect(page.locator("[data-audience-copy]")).toHaveCSS("animation-name", "none");
  const audienceProof = page.getByTestId("audience-proof");
  await audienceProof.scrollIntoViewIfNeeded();
  await expect(audienceProof).toHaveAttribute("data-story-motion", "true");
  await expect(audienceProof.locator('[data-control-state="playing"]')).toBeHidden();
  await expect(audienceProof.getByRole("button", { name: /automation example/i })).toHaveCount(0);
  await expect(audienceProof.locator('[data-proof-stage="input"]')).toBeVisible();
  await expect(audienceProof.locator('[data-proof-connector="true"]')).toBeVisible();
  await expect(audienceProof.locator('[data-proof-stage="action"]')).toBeVisible();
  await expect(audienceProof.locator('[data-proof-stage="result"]')).toBeVisible();
  for (const element of await audienceProof.locator('[data-proof-stage], [data-proof-connector="true"] span').all()) {
    await expect(element).toHaveCSS("animation-name", "none");
    await expect(element).toHaveCSS("opacity", "1");
  }
  expect(await audienceProof.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const clientProof = page.getByRole("complementary", { name: "Real client system" });
  const clientProofStages = clientProof.locator("[data-client-proof-stage]");
  await clientProof.scrollIntoViewIfNeeded();
  await expect(clientProof).toHaveAttribute("data-client-proof-motion", "true");
  await expect(clientProof).toHaveAttribute("data-client-proof-active", "true");
  await expect(clientProofStages).toHaveCount(4);
  for (const stage of await clientProofStages.all()) {
    await expect(stage).toBeVisible();
    await expect(stage).toHaveCSS("opacity", "1");
  }
  await expect(clientProof.locator('[data-client-proof-result="true"]')).toBeVisible();
  await expect(clientProof.locator('[data-client-proof-result="true"]')).toHaveCSS("opacity", "1");
  expect(await clientProof.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await clientProof.locator("ol").evaluate((element) => ({
    content: getComputedStyle(element, "::after").content,
    name: getComputedStyle(element, "::after").animationName,
    transform: getComputedStyle(element, "::after").transform,
  }))).toEqual({ content: "none", name: "none", transform: "none" });

  const integrationMarquee = page.getByRole("heading", { name: "Ajani integrates with" })
    .locator("xpath=ancestor::section[1]");
  await expect(integrationMarquee.getByRole("list", {
    name: "Platforms and connection methods Ajani works with",
  })).toBeVisible();
  await expect(integrationMarquee.getByRole("button", { name: "Pause integration marquee" })).toBeHidden();
  expect(await integrationMarquee.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const testimonialCarousel = page.getByRole("group", { name: "Client proof carousel" });
  await testimonialCarousel.scrollIntoViewIfNeeded();
  await expect(testimonialCarousel).toHaveAttribute("data-carousel-state", "paused");
  await expect(testimonialCarousel).toHaveAttribute("data-pause-reason", "reduced-motion");
  await expect(testimonialCarousel.getByRole("button", { name: /client proof rotation/i })).toHaveCount(0);
  await expect(testimonialCarousel.getByRole("button", { name: "Next client proof" })).toHaveCSS("transition-duration", "0s");
  await expect(testimonialCarousel.locator("[data-testimonial-status='current']").first()).toHaveCSS("transition-duration", "0s");
  expect(await testimonialCarousel.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const processTimeline = page.getByTestId("how-it-works-timeline");
  await processTimeline.scrollIntoViewIfNeeded();
  await expect(processTimeline).toHaveAttribute("data-process-complete", "true");
  await expect(processTimeline).not.toHaveAttribute("data-process-motion", "true");
  await expect(processTimeline.locator("[data-process-step]")).toHaveCount(4);
  expect(await processTimeline.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test("homepage content remains visible if viewport observation is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "IntersectionObserver");
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AI workflow systems for service businesses." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof you can inspect." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Different businesses. The same operational gap." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A working request system, not a generic simulation." })).toBeVisible();
  const clientProof = page.getByRole("complementary", { name: "Real client system" });
  await expect(clientProof).toHaveAttribute("data-client-proof-active", "true");
  await expect(clientProof).toHaveAttribute("data-client-proof-paused", "false");
  await expect(clientProof.locator("[data-client-proof-stage]")).toHaveCount(4);
  await expect(clientProof.locator('[data-client-proof-result="true"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "The controls should be as visible as the workflow." })).toBeVisible();
});

test("homepage remains contained at narrow mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
  for (const [name, href] of credibilityNavigation) {
    const link = mobileNavigation.getByRole("link", { exact: true, name });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }
  await page.getByRole("button", { name: "Close navigation menu" }).click();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    const heroCarousel = page.locator('[data-hero-carousel="true"]');
    const heroScene = heroCarousel.locator('[data-scene-viewport="true"]');
    const systemTitle = page.locator('[data-system-preview-title="true"]:visible');
    await heroCarousel.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Pause illustrative systems" }).click();

    for (const [scene, title] of [
      ["network", "System / lead triage map"],
      ["routing", "System / after-hours routing desk"],
      ["mindmap", "System / handoff mind map"],
    ] as const) {
      await expect(heroCarousel).toHaveAttribute("data-active-scene", scene);
      await expect(systemTitle).toHaveText(title);
      expect(await systemTitle.evaluate((element) => ({
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        verticalOverflow: element.scrollHeight - element.clientHeight,
      }))).toEqual({ horizontalOverflow: 0, verticalOverflow: 0 });
      await heroScene.dispatchEvent("animationiteration");
    }

    await page.getByRole("button", { name: "Play illustrative systems" }).click();

    const audienceProof = page.getByTestId("audience-proof");
    await audienceProof.scrollIntoViewIfNeeded();
    await expect(audienceProof).toBeVisible();
    expect(await audienceProof.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    const clientProof = page.getByRole("complementary", { name: "Real client system" });
    await clientProof.scrollIntoViewIfNeeded();
    await expect(clientProof.locator("[data-client-proof-stage]")).toHaveCount(4);
    expect(await clientProof.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    await page.getByRole("heading", { name: "The controls should be as visible as the workflow." }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "The controls should be as visible as the workflow." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
  }
});
