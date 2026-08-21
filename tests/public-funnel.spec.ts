import { expect, test } from "@playwright/test";

test("a visitor can complete the public funnel and open account access without losing progress", async ({ page }) => {
  await page.goto("/record");

  await page.getByRole("button", { name: "Rather type it than say it?" }).click();
  await page.getByRole("textbox", { name: "Describe the work in writing" }).fill(
    "Website enquiries arrive after hours and our team misses the follow-up.",
  );
  await page.getByRole("button", { name: /^Continue/ }).click();

  await page.getByRole("button", { name: "When they ask about price or availability" }).click();
  await page.getByRole("button", { name: /save answer/i }).click();
  await page.getByRole("button", { name: /ready for review/i }).click();
  await page.getByRole("button", { name: /approve this route/i }).click();
  await page.getByRole("button", { name: /send the request/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Add the Clerk publishable and secret keys to activate account access here.");

  await page.getByRole("button", { name: "Close account access" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: /Everything is clear. Send the request./i })).toBeVisible();
});

test("the header sign-in entry leads to the protected portal", async ({ page }) => {
  await page.goto("/");

  const signIn = page.getByRole("link", { name: "Sign in" });
  await expect(signIn).toHaveAttribute("href", "/portal");
  await signIn.click();
  await expect(page).toHaveURL(/\/portal$/);
});

test("automation theatre runs play by play with accessible controls", async ({ page }) => {
  await page.goto("/demos");

  await expect(page.getByRole("heading", { name: /Watch the system work/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demos" }).first()).toHaveAttribute("aria-current", "page");
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

  await expect(page.getByRole("heading", { name: /The work is the proof/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The 7am portal lead that got the viewing." })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Different trades, the same shape/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Record a note/i }).first()).toBeVisible();
});

test("full motion is the default site experience", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await expect(page.getByRole("button", { name: /motion/i })).toHaveCount(0);
  const systemPreview = page.locator('svg[role="presentation"]').first();
  await expect(systemPreview.locator("rect").first()).not.toHaveCSS("display", "none");
  await expect(systemPreview.locator("rect").first()).toHaveCSS("animation-name", /wave/);
  await expect(systemPreview.locator("line").first()).toHaveCSS("animation-name", /draw/);
  await Promise.all([
    page.waitForURL("**/stories"),
    page.getByRole("link", { name: "Stories" }).first().click(),
  ]);
  await expect(page.locator(".route-transition")).toHaveCSS("animation-name", "route-enter");
  await expect(page.getByRole("link", { name: "Stories" }).first()).toHaveAttribute("aria-current", "page");
});

test("internal navigation shows branded progress and clears it after the route opens", async ({ page }) => {
  await page.goto("/");

  const feedback = page.locator('[data-visible][role="status"]');
  await expect(feedback).toHaveAttribute("data-ready", "true");
  await Promise.all([
    expect(feedback).toHaveAttribute("data-visible", "true"),
    page.getByRole("link", { name: "Stories" }).first().click(),
  ]);
  await expect(page).toHaveURL(/\/stories$/);
  await expect(feedback).toContainText("Opening stories");
  await expect(feedback).toHaveAttribute("data-visible", "false", { timeout: 2_000 });
});

test("mobile navigation fits the viewport and keeps every destination available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const header = page.locator("header").first();
  const headerOverflows = await header.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(headerOverflows).toBe(false);
  await expect(header.getByRole("link", { name: "Demos" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Stories" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Record a note" })).toBeVisible();

  await page.goto("/demos");
  const theatreOverflows = await page.getByRole("region", { name: "Automation theatre" }).evaluate((theatre) => theatre.scrollWidth > theatre.clientWidth);
  expect(theatreOverflows).toBe(false);
});
