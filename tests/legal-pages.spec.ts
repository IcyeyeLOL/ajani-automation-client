import { expect, test } from "@playwright/test";

const legalPages = [
  { path: "/legal", heading: "Clear terms. Clear choices." },
  { path: "/terms", heading: "Terms of Service." },
  { path: "/privacy", heading: "Privacy Policy." },
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

  test("overview routes visitors to the right document", async ({ page }) => {
    await page.goto("/legal");
    await expect(page.getByRole("link", { name: /Read the terms/ })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: /Read the policy/ })).toHaveAttribute("href", "/privacy");
    await page.screenshot({ path: "artifacts/legal-review/legal-overview-mobile.png", fullPage: true });
  });
});
