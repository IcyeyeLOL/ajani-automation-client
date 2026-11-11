import { expect, test, type Locator, type Page } from "@playwright/test";

async function readBackdropFilters(element: Locator) {
  return element.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      standard: style.backdropFilter,
      webkit: style.getPropertyValue("-webkit-backdrop-filter")
        || (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter,
      webkitSupported: CSS.supports("(-webkit-backdrop-filter: blur(1px))"),
    };
  });
}

async function expectBackdropFilter(element: Locator, expected: string) {
  const filters = await readBackdropFilters(element);
  expect(filters.standard).toBe(expected);
  if (filters.webkitSupported) expect(filters.webkit).toBe(expected);
}

async function openNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("navigation", { name: "Mobile navigation" }),
  });
  await expect(async () => {
    await trigger.click();
    await expect(dialog).toBeVisible();
  }).toPass();
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
      dialog.getByRole("link", { name: /Client work/ }),
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

test("mobile home header stays opaque over the client proof section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const header = page.locator('header[data-variant="marketing"][data-tone="light"]');
  await expect(header).toHaveCount(1);
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 247)");
  await expectBackdropFilter(header, "none");

  const initialBounds = await header.boundingBox();
  expect(initialBounds?.height).toBeCloseTo(63, 1);

  const proof = page.locator("#client-work");
  await proof.evaluate((section) => {
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top, behavior: "instant" });
  });

  const scrollState = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: window.scrollY,
  }));
  const scrolledHeaderBounds = await header.boundingBox();
  const proofBounds = await proof.boundingBox();

  expect(scrollState.scrollY).toBeGreaterThan(0);
  expect(scrollState.overflow).toBeLessThanOrEqual(1);
  expect(Math.abs(scrolledHeaderBounds?.y ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
  expect(proofBounds?.y).toBeLessThanOrEqual(scrolledHeaderBounds?.height ?? 0);
  expect((proofBounds?.y ?? 0) + (proofBounds?.height ?? 0)).toBeGreaterThan(0);
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 247)");
  await expectBackdropFilter(header, "none");
  expect(scrolledHeaderBounds?.height).toBeCloseTo(63, 1);
});

test("homepage fills iPhone safe areas in portrait and landscape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#fbfaf7");

  const header = page.locator('header[data-variant="marketing"][data-tone="light"]');
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("data-safe-area", "cover");
  const headerInner = header.locator(":scope > div").first();
  const safeAreaOverride = await page.addStyleTag({
    content: `
      html { --site-status-area-height: 47px; }
      body div:has(> header[data-safe-area="cover"]) {
        --site-safe-area-top: 47px;
        --site-safe-area-right: 0px;
        --site-safe-area-bottom: 34px;
        --site-safe-area-left: 0px;
      }
    `,
  });

  const initialHeader = await header.boundingBox();
  const initialInner = await headerInner.boundingBox();
  expect(initialHeader?.height).toBeCloseTo(110, 0);
  expect((initialInner?.y ?? 0) - (initialHeader?.y ?? 0)).toBeCloseTo(55, 0);

  const root = page.locator("html");
  const statusAreaPaint = await root.evaluate((node) => {
    const style = getComputedStyle(node, "::before");
    return { background: style.backgroundColor, height: style.height, position: style.position };
  });
  expect(statusAreaPaint).toEqual({
    background: "rgb(251, 250, 247)",
    height: "47px",
    position: "fixed",
  });

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  const hiddenSkipLink = await skipLink.boundingBox();
  expect((hiddenSkipLink?.y ?? 0) + (hiddenSkipLink?.height ?? 0)).toBeLessThanOrEqual(0);
  await skipLink.evaluate((node) => {
    (node as HTMLElement).focus();
  });
  await expect.poll(async () => (await skipLink.boundingBox())?.y).toBeCloseTo(55, 0);

  const footerInner = page.locator("footer > div").first();
  await expect(footerInner).toHaveCSS("padding-bottom", "58px");

  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
  const scrolledHeader = await header.boundingBox();
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 247)");
  expect(Math.abs(scrolledHeader?.y ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
  expect(scrolledHeader?.height).toBeCloseTo(110, 0);

  await page.setViewportSize({ width: 844, height: 390 });
  await safeAreaOverride.evaluate((node) => {
    node.textContent = `
      html { --site-status-area-height: 0px; }
      body div:has(> header[data-safe-area="cover"]) {
        --site-safe-area-top: 0px;
        --site-safe-area-right: 47px;
        --site-safe-area-bottom: 21px;
        --site-safe-area-left: 47px;
      }
    `;
  });

  const landscapeHeader = await header.boundingBox();
  const landscapeInner = await headerInner.boundingBox();
  expect(landscapeHeader?.height).toBeCloseTo(63, 0);
  expect(landscapeInner?.x).toBeGreaterThanOrEqual(47);
  expect((landscapeInner?.x ?? 0) + (landscapeInner?.width ?? 0)).toBeLessThanOrEqual(844 - 47);
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 247)");
  await expectBackdropFilter(header, "none");
  expect(await root.evaluate((node) => getComputedStyle(node, "::before").height)).toBe("1px");
});

test("homepage safe-area metadata and paint restore after mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const homeHeader = page.locator('header[data-variant="marketing"][data-tone="light"]');
  await expect(homeHeader).toBeVisible();
  await expect(homeHeader).toHaveAttribute("data-safe-area", "cover");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);

  const navigation = await openNavigation(page);
  await navigation.getByRole("link", { name: /Demos/ }).click();
  await expect(page).toHaveURL(/\/demos$/);
  const demosHeader = page.locator('header[data-variant="marketing"][data-tone="light"]');
  await expect(demosHeader).toBeVisible();
  await expect(demosHeader).not.toHaveAttribute("data-safe-area", "cover");
  await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content", /viewport-fit=cover/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(homeHeader).toBeVisible();
  await expect(homeHeader).toHaveAttribute("data-safe-area", "cover");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#fbfaf7");
});

test("homepage header stays opaque through iPhone landscape widths", async ({ page }) => {
  const header = page.locator('header[data-variant="marketing"][data-tone="light"]');

  await page.setViewportSize({ width: 760, height: 844 });
  await page.goto("/");
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 247)");
  await expectBackdropFilter(header, "none");

  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 247)");
  await expectBackdropFilter(header, "none");

  await page.setViewportSize({ width: 1121, height: 844 });
  await expect(header).toHaveCSS("background-color", "rgba(251, 250, 247, 0.76)");
  await expectBackdropFilter(header, "blur(18px) saturate(1.1)");
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
  for (const destination of [{ name: /Demos/, path: "/demos" }, { name: /Client work/, path: "/#client-work" }]) {
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
  await dialog.getByRole("link", { name: /Client work/ }).click();
  await expect(page).toHaveURL(/\/#client-work$/);
  await expect(page.locator("#client-work")).toBeInViewport();
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
  const destinations = navigation.getByRole("link").filter({ hasText: /Client work|Demos|Record a note/ });
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
