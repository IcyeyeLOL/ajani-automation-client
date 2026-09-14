import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const cases = [
  { label: "After-hours leads", id: "after-hours-leads", width: 1440 },
  { label: "Returning clients", id: "returning-clients", width: 1440 },
  { label: "Returning clients", id: "returning-clients", width: 390 },
];
const theatre = (page: Page) => page.getByRole("region", { name: "Automation theatre" });
const scene = (page: Page) => theatre(page).locator('[data-artifact-step]:visible');

type CursorFrame = {
  blinkOpacity: number;
  cursorIndex: number;
  gap: number;
  lastIndex: number;
  text: string;
  visible: number;
  wrapped: boolean;
  yOverlap: number;
};

async function sampleCursorTimeline(page: Page, timeline: number): Promise<CursorFrame> {
  return scene(page).evaluate(async (element, sampleTime) => {
    const animations = element.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = sampleTime;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const characters = [...element.querySelectorAll<HTMLElement>("[data-typing-character]")];
    const visible = characters.filter((character) => Number(getComputedStyle(character).opacity) >= 0.99);
    const cursors = [...element.querySelectorAll<HTMLElement>("[data-typing-cursor]")]
      .filter((cursor) => Number(getComputedStyle(cursor).opacity) > 0.5 && Number(getComputedStyle(cursor.parentElement!).opacity) >= 0.99);
    if (!visible.length || cursors.length !== 1) {
      throw new Error(`Expected one active caret at ${sampleTime}ms, found ${cursors.length}`);
    }

    const last = visible[visible.length - 1];
    const range = document.createRange();
    range.selectNodeContents(last.firstChild!);
    const glyph = range.getBoundingClientRect();
    const cursor = cursors[0].getBoundingClientRect();
    const firstGlyph = characters[0].getBoundingClientRect();
    return {
      blinkOpacity: Number(getComputedStyle(cursors[0], "::after").opacity),
      cursorIndex: Number(cursors[0].dataset.typingCursor),
      gap: cursor.left - glyph.right,
      lastIndex: Number(last.dataset.typingCharacter),
      text: last.textContent ?? "",
      visible: visible.length,
      wrapped: glyph.top > firstGlyph.top + 5,
      yOverlap: Math.min(cursor.bottom, glyph.bottom) - Math.max(cursor.top, glyph.top),
    };
  }, timeline);
}

async function armCursorTimeline(page: Page) {
  await page.evaluate(() => {
    document.documentElement.removeAttribute("data-cursor-timeline-ready");
    const pauseNewTimeline = () => {
      const stage = [...document.querySelectorAll<HTMLElement>('[data-artifact-step="3"][data-animated="true"]')]
        .find((element) => element.getClientRects().length > 0);
      if (!stage) return;
      const animations = stage.getAnimations({ subtree: true });
      if (!animations.some((animation) => (animation as CSSAnimation).animationName.includes("cursor-types"))) return;
      for (const animation of animations) animation.pause();
      document.documentElement.dataset.cursorTimelineReady = String(animations.length);
      observer.disconnect();
    };
    const observer = new MutationObserver(pauseNewTimeline);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-animated"], childList: true, subtree: true });
    pauseNewTimeline();
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Local cursor review: APIs disabled." } });
    return route.continue();
  });
});

for (const scenario of cases) {
  test(`${scenario.label} ${scenario.width}px: cursor follows typed glyphs through wraps and blinks`, async ({ page }, testInfo) => {
    const mobile = scenario.width < 769;
    await page.setViewportSize({ width: scenario.width, height: mobile ? 844 : 1000 });
    await page.goto("/demos");
    await page.evaluate(() => document.fonts.ready);
    if (mobile) {
      await page.getByRole("button", { name: "Change", exact: true }).click();
      await page.getByRole("button", { name: new RegExp(scenario.label) }).click();
      await page.getByRole("button", { name: /Step 3 of 4/ }).click();
    } else {
      await theatre(page).getByRole("tab", { name: new RegExp(scenario.label) }).click();
      await page.getByRole("button", { name: "Play this workflow", exact: true }).click();
      await theatre(page).getByRole("button", { name: /Pause at step 3:/ }).click();
    }
    await expect(scene(page)).toHaveAttribute("data-artifact-step", "3");
    await armCursorTimeline(page);
    await page.getByRole("button", { name: mobile ? "Continue" : "Play this workflow", exact: true }).click();
    await expect(scene(page)).toHaveAttribute("data-mode", "playing");
    await expect(scene(page)).toHaveAttribute("data-animated", "true");
    await expect(page.locator("html")).toHaveAttribute("data-cursor-timeline-ready", /\d+/);

    const layout = await scene(page).evaluate((element) => {
      const characters = [...element.querySelectorAll<HTMLElement>("[data-typing-character]")];
      const firstTop = characters[0].getBoundingClientRect().top;
      const nextPainted = (start: number) => characters.findIndex((character, index) => index >= start && !/^\s$/.test(character.textContent ?? ""));
      return {
        middleIndex: nextPainted(Math.floor(characters.length * 0.4)),
        wrappedIndex: characters.findIndex((character) => !/^\s$/.test(character.textContent ?? "") && character.getBoundingClientRect().top > firstTop + 5),
      };
    });
    expect(layout.middleIndex).toBeGreaterThan(9);
    expect(layout.wrappedIndex).toBeGreaterThan(layout.middleIndex);

    // Drive the CSS timeline directly. Real-time 28ms caret windows can be skipped
    // when a parallel CI worker is descheduled; fixed timeline positions test the
    // rendered animation itself without depending on host CPU scheduling.
    const blinkOn = await sampleCursorTimeline(page, 500);
    const measurements = [
      { phase: "early", frame: await sampleCursorTimeline(page, 690) },
      { phase: "middle", frame: await sampleCursorTimeline(page, 421 + layout.middleIndex * 28 + 14) },
      { phase: "wrapped", frame: await sampleCursorTimeline(page, 421 + layout.wrappedIndex * 28 + 14) },
    ];
    expect(blinkOn.blinkOpacity).toBeGreaterThan(0.5);
    expect(measurements[0].frame.blinkOpacity).toBeLessThanOrEqual(0.5);
    for (const measurement of measurements) {
      const { frame, phase } = measurement;
      expect(frame.text).not.toMatch(/^\s+$/);
      expect(frame.cursorIndex).toBe(frame.lastIndex);
      expect(frame.gap).toBeGreaterThanOrEqual(-0.25);
      expect(frame.gap).toBeLessThanOrEqual(2.5);
      expect(frame.yOverlap).toBeGreaterThan(0);
      if (phase === "wrapped") expect(frame.wrapped).toBe(true);
      await scene(page).screenshot({ path: testInfo.outputPath(`${phase}.png`) });
    }
    await writeFile(testInfo.outputPath("geometry.json"), JSON.stringify(measurements, null, 2));

    if (mobile) {
      await page.getByRole("button", { name: /Step 3 of 4/ }).click();
    } else {
      await theatre(page).getByRole("button", { name: /Run from step 2:/ }).click();
      await theatre(page).getByRole("button", { name: /Pause at step 3:/ }).click();
    }
    await expect(scene(page)).toHaveAttribute("data-mode", "paused");
    const settled = async () => scene(page).evaluate((element) => ({
      visible: [...element.querySelectorAll("[data-typing-character]")].every((letter) => Number(getComputedStyle(letter).opacity) >= 0.99),
      cursorHidden: [...element.querySelectorAll("[data-typing-cursor]")].every((cursor) => Number(getComputedStyle(cursor).opacity) === 0),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(await settled()).toEqual({ visible: true, cursorHidden: true, overflow: 0 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
    await expect(scene(page)).toHaveAttribute("data-motion-allowed", "false");
    expect(await settled()).toEqual({ visible: true, cursorHidden: true, overflow: 0 });
  });
}
