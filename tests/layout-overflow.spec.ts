import { expect, test } from "@playwright/test";

// A page must never scroll sideways. Comparing scrollWidth against clientWidth on
// documentElement is the reliable check: under mobile emulation window.innerWidth
// reports the expanded layout viewport, so it silently matches an overflowing page.
const routes = ["/", "/demos", "/stories", "/approach", "/record", "/request", "/portal", "/portal/builds"];
const widths = [390, 600, 768, 1040];

for (const width of widths) {
  for (const route of routes) {
    test(`${route} does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });

      expect(overflow, `${route} overflows by ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    });
  }
}

test("the home route grid collapses to one column on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const columns = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="home-routes"]');
    if (!grid) throw new Error("route grid is missing");
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  });

  expect(columns).toBe(1);
});
