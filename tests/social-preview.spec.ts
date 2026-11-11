import { expect, test } from "@playwright/test";

test("publishes the Ajani brand card for social previews", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://ajaniflow.com/og.png",
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", "Ajani Automation");
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    "https://ajaniflow.com/og.png",
  );

  const image = await request.get("/og.png");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
  expect((await image.body()).byteLength).toBeGreaterThan(10_000);
});
