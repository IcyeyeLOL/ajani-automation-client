import { expect, test } from "@playwright/test";
import { mockAutomationBrief } from "./helpers/mock-automation-brief";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 503, json: { error: "Voice regression: unmocked APIs disabled." } });
    }
    return route.continue();
  });
  await mockAutomationBrief(page);
  await page.route("**/api/transcribe-voice", (route) => route.fulfill({
    json: { transcript: "Customer appointment changes arrive after hours, and the office team needs a clear next action the following morning." },
  }));
  await page.addInitScript(() => {
    // Keep native fake-device MediaRecorder, but never invoke a browser-hosted
    // speech provider. Native data events prove audio exists independently of UI.
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
    const evidence = { bytes: 0, errors: [] as string[], stopped: false };
    Object.defineProperty(window, "__captureEvidence", { value: evidence });
    const NativeMediaRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeMediaRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        evidence.bytes = 0;
        evidence.errors = [];
        evidence.stopped = false;
        this.addEventListener("dataavailable", (event) => { evidence.bytes += event.data.size; });
        this.addEventListener("error", (event) => { evidence.errors.push(event.type); });
        this.addEventListener("stop", () => { evidence.stopped = true; });
      }
    };
  });
});

const capturedBytes = (page: import("@playwright/test").Page) => page.evaluate(() =>
  (window as unknown as { __captureEvidence: { bytes: number } }).__captureEvidence.bytes);

test("a captured voice note is transcribed before Clarify and restored on Back", async ({ page }) => {
  const transcript = "Customer appointment changes arrive after hours, and the office team needs a clear next action the following morning.";
  await page.route("**/api/transcribe-voice", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      body: JSON.stringify({ transcript }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/record");
  await page.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await expect.poll(() => capturedBytes(page)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Finish note" }).click();

  await expect(page.getByRole("region", { name: "Voice note recorder" }).getByRole("status")).toHaveText("Voice note ready");
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to clarify" }).click();

  await expect(page.getByText(/Voice note transcribed/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Add or confirm the written version" })).toHaveValue(transcript);
  await page.getByRole("button", { name: "Back to your note" }).click();

  await expect(page.getByRole("region", { name: "Voice note recorder" }).getByRole("status")).toHaveText("Voice note ready");
  await expect(page.getByRole("button", { name: "Redo note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 1_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/record-review/saved-note-back-state.png", fullPage: false });
});

test("valid captured audio survives delayed display-timer callbacks", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeInterval(timeout === 1_000 ? () => {} : handler, timeout, ...args)) as typeof window.setInterval;
  });
  await page.goto("/record");
  await page.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  const recorder = page.getByRole("region", { name: "Voice note recorder" });
  await expect(recorder.getByRole("status")).toHaveText("Recording");
  await expect.poll(() => capturedBytes(page)).toBeGreaterThan(0);
  await expect(recorder.locator("header").first()).toContainText("00:00");
  await page.getByRole("button", { name: "Finish note" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __captureEvidence: { stopped: boolean } }).__captureEvidence.stopped)).toBe(true);
  await testInfo.attach("native-audio-without-display-tick", {
    body: JSON.stringify(await page.evaluate(() =>
      (window as unknown as { __captureEvidence: unknown }).__captureEvidence)),
    contentType: "application/json",
  });
  await expect(recorder.getByRole("status")).toHaveText("Voice note ready");
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await expect(recorder.getByLabel("Review your voice note")).toHaveAttribute("src", /^blob:/);
});

test("recording duration excludes paused time and resets for a new capture (synthetic monotonic clock)", async ({ page }) => {
  await page.addInitScript(() => {
    const recordingClock = { now: 10_000 };
    Object.defineProperty(window, "__recordingClock", { value: recordingClock });
    Object.defineProperty(performance, "now", { configurable: true, value: () => recordingClock.now });
  });
  const advanceClock = (milliseconds: number) => page.evaluate((amount) => {
    (window as unknown as { __recordingClock: { now: number } }).__recordingClock.now += amount;
  }, milliseconds);
  await page.goto("/record");
  await page.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  const recorder = page.getByRole("region", { name: "Voice note recorder" });
  await expect(recorder.getByRole("status")).toHaveText("Recording");
  await expect.poll(() => capturedBytes(page)).toBeGreaterThan(0);
  await advanceClock(2_000);
  await page.getByRole("button", { name: "Pause & edit" }).click();
  await expect(recorder.locator("header").first()).toContainText("00:02");
  await advanceClock(90_000);
  await page.getByRole("button", { name: "Continue recording", exact: true }).click();
  await advanceClock(1_000);
  await page.getByRole("button", { name: "Finish note" }).click();
  await expect(recorder.getByRole("status")).toHaveText("Voice note ready");
  await expect(recorder.locator("header").first()).toContainText("00:03");

  await page.getByRole("button", { name: "Redo note", exact: true }).click();
  await expect(recorder.getByRole("status")).toHaveText("Recording");
  await expect(recorder.locator("header").first()).toContainText("00:00");
  await expect.poll(() => capturedBytes(page)).toBeGreaterThan(0);
  await advanceClock(2_000);
  await page.getByRole("button", { name: "Finish note" }).click();
  await expect(recorder.getByRole("status")).toHaveText("Voice note ready");
  await expect(recorder.locator("header").first()).toContainText("00:02");
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
});

test("the active-time recording deadline works without display ticks (synthetic elapsed time)", async ({ page }) => {
  await page.addInitScript(() => {
    const recordingClock = { now: 10_000 };
    Object.defineProperty(window, "__recordingClock", { value: recordingClock });
    Object.defineProperty(performance, "now", { configurable: true, value: () => recordingClock.now });
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeInterval(timeout === 1_000 ? () => {} : handler, timeout, ...args)) as typeof window.setInterval;
  });
  const advanceClock = (milliseconds: number) => page.evaluate((amount) => {
    (window as unknown as { __recordingClock: { now: number } }).__recordingClock.now += amount;
  }, milliseconds);
  await page.goto("/record");
  await page.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  const recorder = page.getByRole("region", { name: "Voice note recorder" });
  await expect(recorder.getByRole("status")).toHaveText("Recording");
  await expect.poll(() => capturedBytes(page)).toBeGreaterThan(0);
  await advanceClock(179_000);
  await page.getByRole("button", { name: "Pause & edit" }).click();
  await expect(recorder.locator("header").first()).toContainText("02:59");
  // An arbitrarily long pause does not consume the remaining active second.
  await advanceClock(300_000);
  await page.getByRole("button", { name: "Continue recording", exact: true }).click();
  await advanceClock(1_000);
  // No Finish click and no display tick: the independent remaining-time timeout
  // must close the native recorder itself and preserve the captured audio.
  await expect(recorder.getByRole("status")).toHaveText("Voice note ready", { timeout: 5_000 });
  await expect(recorder.locator("header").first()).toContainText("03:00");
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
});
