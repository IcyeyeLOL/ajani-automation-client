import { expect, test, type Page } from "@playwright/test";

async function openNavigation(page: Page) {
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("navigation", { name: "Mobile navigation" }),
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`mobile navigation stays reachable and closes cleanly at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const dialog = await openNavigation(page);
    await page.evaluate(() => document.fonts.ready);

    await expect.poll(() => dialog.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= innerWidth + 1
        && bounds.top >= -1 && bounds.bottom <= innerHeight + 1
        && node.scrollWidth <= node.clientWidth + 1;
    })).toBe(true);

    for (const target of [
      dialog.getByRole("button", { name: "Close navigation menu" }),
      dialog.getByRole("link", { name: /Demos/ }),
      dialog.getByRole("link", { name: /Stories/ }),
      dialog.getByRole("link", { name: "Record a note" }),
    ]) {
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeInViewport();
      expect(await target.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeFocused();
    await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  });
}

test("mobile navigation traps keyboard focus and supports repeated open and close", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const dialog = await openNavigation(page);
    for (const key of ["Shift+Tab", ...Array<string>(12).fill("Tab")]) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await dialog.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  }
});

test("mobile menu dismisses on desktop resize without leaving an invisible modal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = await openNavigation(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
  await openNavigation(page);
  await page.keyboard.press("Escape");
});

test("primary menu links navigate and release modal state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const destination of [{ name: /Demos/, path: "/demos" }, { name: /Stories/, path: "/stories" }]) {
    const dialog = await openNavigation(page);
    await dialog.getByRole("link", { name: destination.name }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  }
});

test("mobile navigation remains operable when the device requests reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const dialog = await openNavigation(page);
  await dialog.getByRole("link", { name: /Stories/ }).click();
  await expect(page).toHaveURL(/\/stories$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
});

test("record action hands off to account access without stacking navigation dialogs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const navigation = await openNavigation(page);
  await navigation.getByRole("link", { name: "Record a note" }).click();
  const account = page.getByRole("dialog", { name: "Sign in to Ajani Automation" });
  await expect(account).toBeVisible();
  await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(1);
  await account.getByRole("button", { name: "Close account access" }).click();
  await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
});

test("mobile menu keeps its three destinations without a pitch or settings section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const navigation = await openNavigation(page);
  const destinations = navigation.getByRole("link").filter({ hasText: /Demos|Stories|Record a note/ });
  await expect(destinations).toHaveCount(3);
  const positions = await destinations.evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  await expect(navigation.getByText(/Your next step|Start with what|A voice note is enough/i)).toHaveCount(0);
  await expect(navigation.getByRole("navigation", { name: "Legal", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: /^(Legal|Terms|Privacy)$/ })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: /Use device setting|Play animations|Keep animations on/i })).toHaveCount(0);
  await expect(navigation.getByText(/Animations enabled by you/i)).toHaveCount(0);
});
