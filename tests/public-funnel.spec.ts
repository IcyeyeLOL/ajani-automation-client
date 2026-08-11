import { expect, test } from "@playwright/test";

test("a visitor can complete the public funnel and open account access without losing progress", async ({ page }) => {
  await page.goto("/request");

  await page.getByRole("button", { name: "Record voice note" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: /submit voice note/i }).click();

  await page.getByRole("button", { name: "They ask about availability" }).click();
  await page.getByRole("button", { name: /save answer/i }).click();
  await page.getByRole("button", { name: /ready for review/i }).click();
  await page.getByRole("button", { name: /approve system/i }).click();
  await page.getByRole("button", { name: /request build/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Create an account to request this build.");

  await page.getByRole("button", { name: "Close account access" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Everything is clear. Now send the build request.")).toBeVisible();
});

test("the header account dialog supports keyboard dismissal", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("automation theatre runs play by play with accessible controls", async ({ page }) => {
  await page.goto("/demos");

  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await expect(theatre.getByRole("tab", { name: /After-hours leads/i })).toHaveAttribute("aria-selected", "true");
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).press("Enter");
  await expect(theatre.getByRole("button", { name: "Pause After-hours leads automation" })).toBeVisible();
  await expect(theatre.getByRole("status")).toContainText("Playing automation: Lead signal");
  await theatre.getByRole("button", { name: "Pause After-hours leads automation" }).press("Enter");
  await theatre.getByRole("button", { name: "Advance one automation step" }).press("Enter");
  await expect(theatre.getByRole("status")).toContainText("Paused at Intent scan");
  await expect(theatre.getByRole("list", { name: "Automation event ledger" }).getByText("Intent mapped")).toBeVisible();
  await theatre.getByRole("tab", { name: /Client intake/i }).press("Enter");
  await expect(theatre.getByRole("status")).toContainText("Ready to trace the system");
  expect(await theatre.getByRole("button", { name: "Inspect step 1: Context arrives" }).evaluate((node) => getComputedStyle(node).animationName)).toContain("graph-node-enter");
});

test("each automation route has its own step icon set", async ({ page }) => {
  await page.goto("/demos");

  const theatre = page.getByRole("region", { name: "Automation theatre" });
  const icons = () => theatre.locator("span[data-icon]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-icon")));

  await expect.poll(icons).toEqual(["sun", "intent", "reply", "handoff"]);
  await theatre.getByRole("tab", { name: /Client intake/i }).click();
  await expect.poll(icons).toEqual(["inbox", "magnify", "brief", "alignment"]);
  await theatre.getByRole("tab", { name: /Returning clients/i }).click();
  await expect.poll(icons).toEqual(["spark", "relationship", "nudge", "owner"]);
});

test("automation theatre plays through reduced motion preferences after user intent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");

  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(theatre.getByRole("status")).toContainText("Playing automation: Lead signal");
  await page.waitForTimeout(3_100);
  await expect(theatre.getByRole("status")).toContainText("Playing automation: Intent scan");
  await page.waitForTimeout(9_300);
  await expect(theatre.getByRole("status")).toContainText("Playing automation: Lead signal");
});

test("stories presents visual system narratives instead of a placeholder", async ({ page }) => {
  await page.goto("/stories");

  await expect(page.getByRole("heading", { name: /Proof feels better/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The lead that would have waited until tomorrow." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The context that arrives before the meeting starts." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The client moment that does not disappear quietly." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Tell us where work sticks/i })).toBeVisible();
});

test("full motion is the default site experience", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await expect(page.getByRole("button", { name: /motion/i })).toHaveCount(0);
  await Promise.all([
    page.waitForURL("**/approach"),
    page.getByRole("link", { name: "Approach" }).click(),
  ]);
  await expect(page.locator(".route-transition")).toHaveCSS("animation-name", "route-enter");
  await expect(page.getByRole("link", { name: "Approach" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Approach" })).toHaveClass(/is-active/);
});

test("mobile navigation fits the viewport and keeps every destination available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const headerOverflows = await page.locator(".site-header").evaluate((header) => header.scrollWidth > header.clientWidth);
  expect(headerOverflows).toBe(false);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Stories" })).toBeVisible();

  await page.goto("/demos");
  const theatreOverflows = await page.getByRole("region", { name: "Automation theatre" }).evaluate((theatre) => theatre.scrollWidth > theatre.clientWidth);
  expect(theatreOverflows).toBe(false);
});
