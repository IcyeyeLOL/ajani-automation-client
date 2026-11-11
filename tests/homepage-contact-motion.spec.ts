import { expect, test } from "@playwright/test";

test("FAQ answers expand smoothly and remain keyboard accessible", async ({ page }) => {
  await page.goto("/");
  const question = page.getByRole("button", { name: "What do I need to bring to the first conversation?" });
  const answer = page.locator("#faq-answer-01-0");
  await expect(question).toHaveAttribute("aria-expanded", "false");
  await expect(answer).toHaveAttribute("aria-hidden", "true");
  expect(await answer.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);

  await page.evaluate(() => {
    const trigger = document.querySelector<HTMLButtonElement>('#faq button[aria-controls="faq-answer-01-0"]')!;
    const panel = document.getElementById("faq-answer-01-0")!;
    (window as typeof window & { faqHeights: number[] }).faqHeights = [];
    trigger.addEventListener("click", () => {
      let frame = 0;
      const sample = () => {
        (window as typeof window & { faqHeights: number[] }).faqHeights.push(panel.getBoundingClientRect().height);
        if (++frame < 26) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { once: true });
  });
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(answer).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => answer.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(100);
  const heights = await page.evaluate(() => (window as typeof window & { faqHeights: number[] }).faqHeights);
  const finalHeight = heights.at(-1) ?? 0;
  expect(heights.some((height) => height > 0 && height < finalHeight - 10)).toBe(true);

  await question.press("Enter");
  await expect(question).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => answer.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
  await question.press("Space");
  await expect(question).toHaveAttribute("aria-expanded", "true");
});

test("desktop and mobile section links animate to the sticky-header offset", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "full";
    (window as typeof window & { scrollSamples: number[] }).scrollSamples = [];
    const original = window.scrollTo.bind(window);
    window.scrollTo = ((options: ScrollToOptions) => {
      (window as typeof window & { scrollSamples: number[] }).scrollSamples.push(options.top ?? 0);
      original(options);
    }) as typeof window.scrollTo;
  });
  await page.getByRole("banner").getByRole("link", { name: "FAQ" }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("faq");
  const desktop = await page.evaluate(() => ({
    samples: (window as typeof window & { scrollSamples: number[] }).scrollSamples,
    top: document.getElementById("faq")!.getBoundingClientRect().top,
  }));
  expect(desktop.samples.some((position) => position > 0 && position < desktop.samples.at(-1)! - 100)).toBe(true);
  expect(desktop.top).toBeGreaterThanOrEqual(88);
  expect(desktop.top).toBeLessThanOrEqual(96);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "full";
    (window as typeof window & { scrollSamples: number[] }).scrollSamples = [];
    const original = window.scrollTo.bind(window);
    window.scrollTo = ((options: ScrollToOptions) => {
      (window as typeof window & { scrollSamples: number[] }).scrollSamples.push(options.top ?? 0);
      original(options);
    }) as typeof window.scrollTo;
  });
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "FAQ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("faq");
  const mobile = await page.evaluate(() => ({
    samples: (window as typeof window & { scrollSamples: number[] }).scrollSamples,
    top: document.getElementById("faq")!.getBoundingClientRect().top,
  }));
  expect(mobile.samples.some((position) => position > 0 && position < mobile.samples.at(-1)! - 100)).toBe(true);
  expect(mobile.top).toBeGreaterThanOrEqual(88);
  expect(mobile.top).toBeLessThanOrEqual(96);
});

test("reduced motion makes FAQ and section navigation immediate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const question = page.getByRole("button", { name: "What do I need to bring to the first conversation?" });
  const answer = page.locator("#faq-answer-01-0");
  await expect(async () => {
    if (await question.getAttribute("aria-expanded") === "false") await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
  }).toPass();
  await expect(answer).toHaveCSS("transition-duration", "0s");

  await page.getByRole("banner").getByRole("link", { name: "FAQ" }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("faq");
  await expect(page.locator("#faq")).toBeInViewport();
});
