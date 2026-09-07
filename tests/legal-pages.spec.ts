import { expect, test } from "@playwright/test";

const legalPages = [
  { path: "/legal", heading: "Clear rules. Visible practices." },
  { path: "/terms", heading: "Terms of Service." },
  { path: "/privacy", heading: "Privacy Policy." },
  { path: "/acceptable-use", heading: "Acceptable Use." },
  { path: "/accessibility", heading: "Accessibility Statement." },
  { path: "/subprocessors", heading: "Service providers & subprocessors." },
] as const;

test.describe("organized legal section", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const legalPage of legalPages) {
    test(`${legalPage.path} is readable without mobile overflow`, async ({ page }) => {
      await page.goto(legalPage.path);
      await expect(page.getByRole("heading", { level: 1, name: legalPage.heading })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  test("overview presents exactly three organized legal groups", async ({ page }) => {
    await page.goto("/legal");
    const groups = page.locator('[data-legal-group="true"]');
    await expect(groups).toHaveCount(3);

    const terms = groups.filter({ has: page.getByRole("heading", { name: "Terms of Service" }) });
    await expect(terms.getByRole("link", { name: /Read the terms/ })).toHaveAttribute("href", "/terms");
    await expect(terms.getByRole("link", { name: /Detailed acceptable-use rules/ })).toHaveAttribute("href", "/acceptable-use");

    const privacy = groups.filter({ has: page.getByRole("heading", { name: "Privacy Policy" }) });
    await expect(privacy.getByRole("link", { name: /Read the policy/ })).toHaveAttribute("href", "/privacy");
    await expect(privacy.getByRole("link", { name: /Current service-provider inventory/ })).toHaveAttribute("href", "/subprocessors");

    const access = groups.filter({ has: page.getByRole("heading", { name: "Accessibility & support" }) });
    await expect(access.getByRole("link", { name: /Read the statement/ })).toHaveAttribute("href", "/accessibility");
    await expect(access.getByRole("link", { name: /Contact Ajani/ })).toHaveAttribute("href", /mailto:hello@ajaniautomation\.com/);

    await expect(page.getByRole("navigation", { name: "Legal documents" }).getByRole("link")).toHaveCount(3);
    await page.screenshot({ path: "artifacts/legal-review/legal-overview-mobile.png", fullPage: true });
  });

  test("desktop overview keeps the three legal groups in one compact row", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/legal");

    const groups = page.locator('[data-legal-group="true"]');
    await expect(groups).toHaveCount(3);
    const boxes = await groups.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { height: box.height, top: box.top, width: box.width };
    }));

    expect(Math.max(...boxes.map(({ top }) => top)) - Math.min(...boxes.map(({ top }) => top))).toBeLessThanOrEqual(1);
    expect(boxes.every(({ height, width }) => height < 560 && width > 330)).toBe(true);
    expect((await page.getByRole("contentinfo").boundingBox())?.height).toBeLessThan(400);
  });
});
