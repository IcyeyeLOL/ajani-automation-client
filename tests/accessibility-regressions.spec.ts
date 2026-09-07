import { expect, test } from "@playwright/test";

test("shared public chrome exposes a first-focusable skip link", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("home process copy reflows without horizontal scrolling at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  const processCopy = page.getByText("The proposed build and budget stay clear before work begins or anything is charged.", { exact: true });
  await expect(processCopy).toHaveCSS("white-space", "normal");
});

test("the reduced-motion fallback stays safe when the full-motion override is absent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));

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

  const mobileMenu = page.getByRole("button", { name: "Open navigation menu" });
  await mobileMenu.click();
  const menuDialog = page.getByRole("dialog");
  const mobileNavigation = menuDialog.getByRole("navigation", { name: "Mobile navigation" });

  await expect(page.locator('header button[aria-label="Close navigation menu"]')).toBeVisible();

  for (const target of [
    mobileNavigation.getByRole("link", { name: /Demos/ }),
    mobileNavigation.getByRole("link", { name: /Stories/ }),
    menuDialog.getByRole("link", { name: "Record a note" }),
  ]) {
    expect(await target.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press("Escape");
  await expect(menuDialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeFocused();
});

test("secondary route mastheads keep their headings and supporting copy on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/demos");
  await expect(page.getByRole("heading", { name: "Watch the system work. Then decide if it fits." })).toBeVisible();
  await expect(page.getByText(/Choose a common business gap and run the route yourself/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);

  await page.goto("/stories");
  await expect(page.getByRole("heading", { name: "The work is the proof. Here is the work." })).toBeVisible();
  await expect(page.getByText(/Every build starts with a moment that keeps slipping/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});

test("record uses the shared funnel header and skip-link contract", async ({ page }) => {
  await page.goto("/record");

  await expect(page.getByText("Private build request", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back home" })).toHaveAttribute("href", "/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("stories no longer labels the testimonial as verified", async ({ page }) => {
  await page.goto("/stories");
  await expect(page.getByText("Verified client story", { exact: true })).toHaveCount(0);
});
