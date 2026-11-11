import { expect, test } from "@playwright/test";

const expectedAnchors = [
  ["Client work", "/#client-work"],
  ["Process", "/#process"],
  ["Demos", "/demos"],
  ["FAQ", "/#faq"],
] as const;

test("credibility homepage exposes proof, process, and honest prelaunch states", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "AI workflow systems for service businesses." })).toBeVisible();
  await expect(page.locator("[data-hero-carousel='true']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play Karol's client testimonial video" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof you can inspect." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof you can inspect." }).locator("xpath=ancestor::section[1]"))
    .toContainText("5 examples");
  await expect(page.locator("#client-work")).not.toContainText("Measured case");
  await expect(page.locator("#solutions")).toHaveCount(0);
  await expect(page.locator("#industries")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A working request system, not a generic simulation." })).toHaveCount(0);
  await expect(page.locator("#process")).toBeVisible();
  await expect(page.locator("#engagement, #security, #about")).toHaveCount(0);
  await expect(page.locator("#faq")).toBeVisible();
  await expect(page.locator("#contact")).toHaveCount(0);
  expect(await page.locator("#process").evaluate((section) => section.nextElementSibling?.firstElementChild?.id)).toBe("faq");

  const header = page.getByRole("banner");
  for (const [name, href] of expectedAnchors) {
    await expect(header.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  await expect(header.getByRole("link", { name: "Discuss a workflow" })).toHaveAttribute("href", /^mailto:/);

  const testimonialRail = page.getByRole("list", { name: "Five client proof slides" });
  await expect(testimonialRail.locator(":scope > li")).toHaveCount(5);
  expect(await testimonialRail.locator(":scope > li > article").evaluateAll((articles) =>
    articles.map((article) => article.getAttribute("aria-label")),
  )).toEqual([
    "1 of 5: Dexter Game4Good testimonial video",
    "2 of 5: Machias Norwood testimonial video",
    "3 of 5: Karol client testimonial video",
    "4 of 5: Devon Realtor research workspace",
    "5 of 5: Tammy Ogar personal website",
  ]);
  await expect(testimonialRail.locator("[data-testimonial-status='current']")).toHaveCount(5);
  await expect(testimonialRail.locator("[data-testimonial-status='placeholder']")).toHaveCount(0);
  const tammyProject = testimonialRail.getByRole("article", { name: "5 of 5: Tammy Ogar personal website" });
  await expect(tammyProject.getByRole("img", { name: "Portrait of Tammy Ogar" })).toBeVisible();
  await expect(tammyProject.getByRole("img", { name: "Portrait of Tammy Ogar" }))
    .toHaveAttribute("src", /tammy-ogar-clean-cutout\.png/);
  await expect(tammyProject.getByRole("link", { name: "View Otaakara website" })).toHaveCount(0);
  await expect(tammyProject).toContainText("Client personal website");
  const devonProject = testimonialRail.getByRole("article", { name: "4 of 5: Devon Realtor research workspace" });
  await expect(devonProject).toContainText("Private client workspace");
  await expect(devonProject.getByRole("img", { name: /Portrait of Devon/ }))
    .toHaveAttribute("src", /devon-portrait-enhanced\.png/);
  const dexterProject = testimonialRail.getByRole("article", { name: "1 of 5: Dexter Game4Good testimonial video" });
  await expect(dexterProject).toContainText("CEO and founder · Game4Good");
  await expect(dexterProject.getByRole("link", { name: /Visit Game4Good/ })).toHaveAttribute("href", /game4good/i);
  await expect(dexterProject.getByRole("button", { name: "Play Dexter's client testimonial video" })).toBeVisible();
  await expect(testimonialRail.getByRole("article", { name: "3 of 5: Karol client testimonial video" })
    .getByRole("link", { name: "Open the full client story" })).toHaveCount(0);
  const machiasProject = testimonialRail.getByRole("article", { name: "2 of 5: Machias Norwood testimonial video" });
  await expect(machiasProject).toContainText("The process was very easy to understand and apply.");
  await expect(machiasProject.getByRole("button", { name: "Play Machias's client testimonial video" })).toBeVisible();
  expect(await page.locator("[id]").evaluateAll((elements) => {
    const ids = elements.map((element) => element.id).filter(Boolean);
    return ids.length - new Set(ids).size;
  })).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);

  await page.screenshot({ path: "test-results/homepage-credibility-desktop.png" });
  await page.getByRole("heading", { name: "Ajani integrates with" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "Ajani integrates with" }).locator("xpath=ancestor::section[1]").getByRole("button")).toHaveCount(0);
  await page.screenshot({ path: "test-results/homepage-integrations-desktop.png" });
  await page.locator("#client-work").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "Client proof library. See the work move." })).toBeVisible();
  const carousel = page.getByRole("group", { name: "Client proof carousel" });
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  const firstSlide = testimonialRail.locator('[data-proof-slide-index="0"]');
  const initialLeft = (await firstSlide.boundingBox())!.x;
  await page.waitForTimeout(450);
  expect((await firstSlide.boundingBox())!.x).toBeLessThan(initialLeft - 12);
  await testimonialRail.hover();
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  const hoveredLeft = (await firstSlide.boundingBox())!.x;
  await page.waitForTimeout(300);
  expect((await firstSlide.boundingBox())!.x).toBeLessThan(hoveredLeft - 8);
  await page.mouse.move(0, 0);
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  const pauseControl = carousel.getByRole("button", { name: "Pause client proof scroll" });
  await pauseControl.focus();
  await expect(carousel).toHaveAttribute("data-pause-reason", "focus");
  await pauseControl.evaluate((element) => (element as HTMLElement).blur());
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  await pauseControl.click();
  await expect(carousel).toHaveAttribute("data-pause-reason", "manual");
  await expect(carousel.getByRole("button", { name: "Play client proof scroll" })).toBeVisible();
  await expect(carousel.getByRole("button", { name: /client proof/i })).toHaveCount(1);
  await expect.poll(async () => testimonialRail.evaluate((rail) => {
    const index = Number(rail.closest('[data-testid="testimonial-carousel"]')?.getAttribute("data-active-index"));
    const slide = rail.querySelector<HTMLElement>(`[data-proof-slide-index="${index}"]`);
    return slide ? Math.abs(slide.getBoundingClientRect().left - rail.getBoundingClientRect().left) : Number.POSITIVE_INFINITY;
  })).toBeLessThanOrEqual(3);
  const currentIndex = Number(await carousel.getAttribute("data-active-index"));
  const currentSlide = testimonialRail.locator(`[data-proof-slide-index="${currentIndex}"]`);
  const pausedLeft = (await currentSlide.boundingBox())!.x;
  await page.waitForTimeout(300);
  expect(Math.abs((await currentSlide.boundingBox())!.x - pausedLeft)).toBeLessThan(2);
  await page.screenshot({ path: "test-results/homepage-testimonials-desktop.png" });

  await carousel.getByRole("button", { name: "Play client proof scroll" }).click();
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");

  await page.reload();
  await page.locator("#client-work").scrollIntoViewIfNeeded();
  await dexterProject.getByRole("button", { name: "Play Dexter's client testimonial video" }).click();
  const dexterVideo = dexterProject.locator('video[aria-label="Dexter client testimonial video"]');
  await expect(dexterVideo).toBeVisible();
  await expect(dexterVideo.locator("source")).toHaveAttribute("src", "/videos/testimonials/dexter-game4good.mp4");
  await expect(dexterVideo.locator("track")).toHaveAttribute("src", "/videos/testimonials/dexter-game4good.vtt");
  await expect(carousel).toHaveAttribute("data-pause-reason", "video");
  await machiasProject.getByRole("button", { name: "Play Machias's client testimonial video" }).click();
  const machiasVideo = machiasProject.locator('video[aria-label="Machias client testimonial video"]');
  await expect(machiasVideo).toBeVisible();
  await expect(machiasVideo.locator("source")).toHaveAttribute("src", "/videos/testimonials/machias-norwood.mp4");
  await expect(machiasVideo.locator("track")).toHaveAttribute("src", "/videos/testimonials/machias-norwood.vtt");
  await expect(carousel).toHaveAttribute("data-pause-reason", "video");
  await expect(dexterVideo).toHaveCount(0);
  await carousel.getByRole("button", { name: "Play Karol's client testimonial video" }).click();
  const testimonialFrame = carousel.getByTitle("Karol client testimonial video in the client proof carousel");
  await expect(testimonialFrame).toBeVisible();
  await expect(testimonialFrame).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  await expect(carousel).toHaveAttribute("data-carousel-state", "paused");
  await expect(carousel).toHaveAttribute("data-pause-reason", "video");
  await carousel.getByRole("button", { name: "Play client proof scroll" }).click();
  await expect(testimonialFrame).toHaveCount(0);
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");

  await page.locator("#faq").scrollIntoViewIfNeeded();
  await expect(page.locator("#faq section")).toHaveCount(3);
  await expect(page.locator("#faq button[aria-expanded]")).toHaveCount(8);
  await page.screenshot({ path: "test-results/homepage-faq-desktop.png" });
});

test("client proofs follow the site's motion policy even when the device requests reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("#client-work").scrollIntoViewIfNeeded();

  const carousel = page.getByRole("group", { name: "Client proof carousel" });
  const firstSlide = page.getByRole("list", { name: "Five client proof slides" }).locator('[data-proof-slide-index="0"]');
  await expect(carousel.getByRole("button", { name: "Pause client proof scroll" })).toBeVisible();
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  const initialLeft = (await firstSlide.boundingBox())!.x;
  await page.waitForTimeout(450);
  expect((await firstSlide.boundingBox())!.x).toBeLessThan(initialLeft - 12);

  await page.evaluate(() => { document.documentElement.dataset.motion = "system"; });
  await expect(carousel).toHaveAttribute("data-pause-reason", "reduced-motion");
  await expect(carousel.getByText("Motion reduced")).toBeVisible();
  const reducedRail = page.getByRole("list", { name: "Five client proof slides" });
  expect(await reducedRail.evaluate((rail) => rail.scrollWidth > rail.clientWidth)).toBe(true);

  await page.evaluate(() => { document.documentElement.dataset.motion = "full"; });
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
});

test("credibility homepage and conventional navigation remain contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "AI workflow systems for service businesses." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.locator("#client-work").scrollIntoViewIfNeeded();
  await expect(page.getByRole("group", { name: "Client proof carousel" })).toHaveAttribute("data-carousel-state", "playing");
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  for (const [name] of expectedAnchors) {
    const destination = navigation.getByRole("link", { exact: true, name });
    await destination.scrollIntoViewIfNeeded();
    await expect(destination).toBeVisible();
  }
  await expect(navigation.getByRole("link", { exact: true, name: "Discuss a workflow" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: /^Record a note/ })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation menu" }).click();

  const sections = page.locator("#client-work, #process, #faq");
  expect(await sections.evaluateAll((elements) => elements.every((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1;
  }))).toBe(true);

  const faq = page.locator("#faq").getByRole("button", { name: "Which tools can Ajani work with?" });
  await faq.click();
  await expect(page.getByText("The current integration list includes HubSpot", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator("#client-work").scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Client proof library. See the work move." })).toBeVisible();
    const carousel = page.getByRole("group", { name: "Client proof carousel" });
    for (const controlName of ["Pause client proof scroll"]) {
      const bounds = await carousel.getByRole("button", { name: controlName }).boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#client-work").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/homepage-testimonials-mobile.png" });
});
