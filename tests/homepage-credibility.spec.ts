import { expect, test } from "@playwright/test";

const expectedAnchors = [
  ["Solutions", "/#solutions"],
  ["Industries", "/#industries"],
  ["Client work and Stories", "/stories"],
  ["Process", "/#process"],
  ["About", "/#about"],
  ["Demos", "/demos"],
  ["Contact", "/#contact"],
] as const;

test("credibility homepage exposes proof, process, and honest prelaunch states", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "AI workflow systems for service businesses." })).toBeVisible();
  await expect(page.locator("[data-hero-carousel='true']")).toBeVisible();
  await expect(page.getByTitle("Karol from Granker's Team shares his experience working with Ajani")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof you can inspect." })).toBeVisible();
  await expect(page.locator("#client-work")).toContainText("6 calls booked in the first month");
  await expect(page.locator("#solutions")).toBeVisible();
  await expect(page.locator("#industries")).toBeVisible();
  await expect(page.locator("#process")).toBeVisible();
  await expect(page.locator("#security")).toBeVisible();
  await expect(page.locator("#about")).toBeVisible();
  await expect(page.locator("#contact")).toBeVisible();

  const header = page.getByRole("banner");
  for (const [name, href] of expectedAnchors) {
    await expect(header.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  await expect(header.getByRole("link", { name: "Discuss a workflow" })).toHaveAttribute("href", /^mailto:/);

  const testimonialRail = page.getByRole("list", { name: "Six client proof slides" });
  await expect(testimonialRail.getByRole("listitem")).toHaveCount(6);
  await expect(testimonialRail.locator("[data-testimonial-status='current']")).toHaveCount(2);
  const placeholders = testimonialRail.locator("[data-testimonial-status='placeholder']");
  await expect(placeholders).toHaveCount(4);
  for (const placeholder of await placeholders.all()) {
    await expect(placeholder).toContainText("Internal preview");
    await expect(placeholder).toContainText("Awaiting approved client material");
    await expect(placeholder).toContainText("Not for launch until approved");
  }

  expect(await page.locator("[id]").evaluateAll((elements) => {
    const ids = elements.map((element) => element.id).filter(Boolean);
    return ids.length - new Set(ids).size;
  })).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);

  await page.screenshot({ path: "test-results/homepage-credibility-desktop.png" });
  await page.getByRole("heading", { name: "Ajani integrates with" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/homepage-integrations-desktop.png" });
  await page.locator("#client-voices").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "Start with the stronger result. Click through the proof." })).toBeVisible();
  expect(await testimonialRail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const carousel = page.getByRole("group", { name: "Client proof carousel" });
  await expect(carousel.getByText("01 / 06", { exact: true })).toBeVisible();
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  const nextControl = carousel.getByRole("button", { name: "Next client proof" });
  await nextControl.focus();
  await expect(carousel).toHaveAttribute("data-pause-reason", "focus");
  await nextControl.evaluate((element) => (element as HTMLElement).blur());
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  const startingScrollLeft = await testimonialRail.evaluate((element) => element.scrollLeft);
  await expect.poll(
    () => carousel.getAttribute("data-active-index"),
    { timeout: 9_000 },
  ).toBe("1");
  await expect(carousel.getByText("02 / 06", { exact: true })).toBeVisible();
  expect(await testimonialRail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(startingScrollLeft);

  await carousel.getByRole("button", { name: "Previous client proof" }).click();
  await expect(carousel.getByText("01 / 06", { exact: true })).toBeVisible();
  await expect(carousel).toHaveAttribute("data-pause-reason", "manual");
  await expect(carousel.getByRole("button", { name: "Play client proof rotation" })).toBeVisible();
  await page.screenshot({ path: "test-results/homepage-testimonials-desktop.png" });

  await carousel.getByRole("button", { name: "Previous client proof" }).click();
  await expect(carousel.getByText("06 / 06", { exact: true })).toBeVisible();
  await expect.poll(async () => testimonialRail.evaluate((rail) => {
    const slide = rail.querySelector<HTMLElement>('[data-proof-slide-index="5"]');
    if (!slide) return Number.POSITIVE_INFINITY;
    return Math.abs(slide.getBoundingClientRect().left - rail.getBoundingClientRect().left);
  })).toBeLessThanOrEqual(3);
  await carousel.getByRole("button", { name: "Next client proof" }).click();
  await expect(carousel.getByText("01 / 06", { exact: true })).toBeVisible();
  await carousel.getByRole("button", { name: "Next client proof" }).click();
  await expect(carousel.getByText("02 / 06", { exact: true })).toBeVisible();
  await expect(carousel.locator("iframe")).toHaveCount(0);
  await carousel.getByRole("button", { name: "Play Karol's client testimonial video" }).click();
  const testimonialFrame = carousel.getByTitle("Karol client testimonial video in the client proof carousel");
  await expect(testimonialFrame).toBeVisible();
  await expect(testimonialFrame).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  await expect(carousel).toHaveAttribute("data-carousel-state", "paused");
  await expect(carousel).toHaveAttribute("data-pause-reason", "video");
  await carousel.getByRole("button", { name: "Play client proof rotation" }).click();
  await expect(carousel.getByTitle("Karol client testimonial video in the client proof carousel")).toHaveCount(0);
  await expect(carousel).toHaveAttribute("data-carousel-state", "playing");
  await page.locator("#security").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "The controls should be as visible as the workflow." })).toBeVisible();
  await page.screenshot({ path: "test-results/homepage-security-desktop.png" });
});

test("credibility homepage and conventional navigation remain contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "AI workflow systems for service businesses." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

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

  const sections = page.locator("#client-work, #solutions, #industries, #process, #client-voices, #security, #about, #faq, #contact");
  expect(await sections.evaluateAll((elements) => elements.every((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1;
  }))).toBe(true);

  const faq = page.locator("#faq details").filter({ hasText: "Which tools can Ajani work with?" }).locator("summary");
  await faq.click();
  await expect(page.getByText("The current integration list includes HubSpot", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator("#client-voices").scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Start with the stronger result. Click through the proof." })).toBeVisible();
    const carousel = page.getByRole("group", { name: "Client proof carousel" });
    for (const controlName of ["Previous client proof", "Next client proof", "Pause client proof rotation"]) {
      const bounds = await carousel.getByRole("button", { name: controlName }).boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#client-voices").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/homepage-testimonials-mobile.png" });
});
