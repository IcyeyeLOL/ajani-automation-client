import { expect, test } from "@playwright/test";

test("shared public chrome exposes a first-focusable skip link", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("home closing price card reflows without horizontal scrolling at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  const price = page.getByText("Based on your budget", { exact: true });
  await expect(price).toHaveCSS("white-space", "normal");
});

test("the reduced-motion fallback stays safe when the full-motion override is absent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");
  await page.locator("html").evaluate((element) => element.removeAttribute("data-motion"));

  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");
  const firstScenario = page.getByRole("tab", { name: /After-hours leads/ });
  await expect(firstScenario).toHaveCSS("animation-name", "none");

  await expect(page.getByRole("status")).toContainText("Motion is simplified for this device");
  await page.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(page.getByRole("status")).toContainText("Paused at Lead signal");
  await page.waitForTimeout(3_200);
  await expect(page.getByRole("status")).toContainText("Paused at Lead signal");
});

test("public hover states do not move click targets and mobile targets remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const audienceTab = page.getByRole("tab", { name: /Home services/ });
  await audienceTab.scrollIntoViewIfNeeded();
  const before = await audienceTab.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { height: rect.height, transform: getComputedStyle(node).transform, width: rect.width };
  });
  await audienceTab.hover();
  const after = await audienceTab.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { height: rect.height, transform: getComputedStyle(node).transform, width: rect.width };
  });
  expect(after).toEqual(before);

  const mobileMenu = page.locator('summary[aria-label="Open navigation menu"]');
  await mobileMenu.click();
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });

  for (const target of [
    mobileNavigation.getByRole("link", { name: /Demos/ }),
    mobileNavigation.getByRole("link", { name: /Stories/ }),
    page.locator("header").first().getByRole("link", { name: "Record a note" }),
  ]) {
    expect(await target.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
});

test("stories no longer labels the testimonial as verified", async ({ page }) => {
  await page.goto("/stories");
  await expect(page.getByText("Verified client story", { exact: true })).toHaveCount(0);
});
