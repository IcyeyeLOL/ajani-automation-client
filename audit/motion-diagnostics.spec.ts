import { expect, test } from "@playwright/test";

test("approach content should remain readable without viewport observation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });
  });
  await page.goto("/approach");
  await expect(page.getByRole("heading", { name: "No automation until the business problem is actually understood." })).toBeVisible();
  expect(errors.filter((message) => message.includes("IntersectionObserver"))).toEqual([]);
});

test("routing station labels keep their measured clearance after fonts settle", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const results: Array<{ width: number; stations: Array<{ label: string | null; gap: number; labelInside: boolean }> }> = [];
  for (const width of [1440, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const viewport = page.locator('[data-scene-viewport="true"]');
    await page.getByRole("button", { name: "Pause illustrative systems" }).click();
    await viewport.dispatchEvent("animationiteration");
    await expect(page.locator('[data-hero-carousel="true"]')).toHaveAttribute("data-active-scene", "routing");
    const stations = viewport.locator("svg:visible [data-stage]");
    await expect(stations).toHaveCount(4);
    results.push({ width, stations: await stations.evaluateAll((nodes) => nodes.map((node) => {
      const face = node.querySelector<SVGGraphicsElement>('[data-node-surface="true"]')!.getBBox();
      const label = node.querySelector<SVGGraphicsElement>('[data-station-label="true"]')!;
      const labelBox = label.getBBox();
      const indexBox = node.querySelector<SVGGraphicsElement>('[data-station-index="true"]')!.getBBox();
      return { label: label.textContent, gap: indexBox.x - (labelBox.x + labelBox.width), labelInside: labelBox.x >= face.x && labelBox.x + labelBox.width <= face.x + face.width };
    })) });
  }
  await testInfo.attach("routing-label-measurements", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  console.log("Settled routing-label measurements:", JSON.stringify(results));
  // This is a diagnostic check, intentionally not marked as an expected failure:
  // it distinguishes a real clearance regression from a first-load font race.
  expect(results.every((result) => result.stations.every((station) => station.labelInside && station.gap >= 5))).toBe(true);
});
