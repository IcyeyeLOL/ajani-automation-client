import { expect, test } from "@playwright/test";

// A page must never scroll sideways. Comparing scrollWidth against clientWidth on
// documentElement is the reliable check: under mobile emulation window.innerWidth
// reports the expanded layout viewport, so it silently matches an overflowing page.
// Protected routes redirect to Clerk for an unauthenticated browser, so testing
// them here would measure a third-party page rather than Ajani's portal UI.
const routes = ["/", "/demos", "/stories", "/approach", "/record", "/request"];
const widths = [320, 390, 600, 768, 1040];

for (const width of widths) {
  for (const route of routes) {
    test(`${route} does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      // /request is a compatibility redirect; measure the settled recorder,
      // not an execution context being replaced by the streamed redirect.
      if (route === "/request") await page.waitForURL(/\/record$/);

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });

      expect(overflow, `${route} overflows by ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    });
  }
}
