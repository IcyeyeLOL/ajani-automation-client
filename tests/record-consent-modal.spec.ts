import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { mockAutomationBrief } from "./helpers/mock-automation-brief";

const browserSignals = new WeakMap<Page, { pageErrors: string[]; consoleErrors: string[]; blockedResources: string[] }>();
type CaptureEvidence = { microphoneRequests: number; recorderStarts: number; bytes: number; errors: string[] };
const recorder = (page: Page) => page.getByRole("region", { name: "Voice note recorder" });
const startButton = (page: Page) => page.getByRole("button", { name: "Start recording your voice note", exact: true });
const captureEvidence = (page: Page) => page.evaluate(() =>
  (window as unknown as { __consentCapture: CaptureEvidence }).__consentCapture);

test.beforeEach(async ({ page }) => {
  const signals = { pageErrors: [] as string[], consoleErrors: [] as string[], blockedResources: [] as string[] };
  browserSignals.set(page, signals);
  page.on("pageerror", (error) => signals.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") signals.consoleErrors.push(message.text()); });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) { signals.blockedResources.push(url.href); return route.abort("blockedbyclient"); }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Consent review: unmocked APIs disabled." } });
    return route.continue();
  });
  await mockAutomationBrief(page);
  await page.route("**/api/transcribe-voice", (route) => route.fulfill({
    json: { transcript: "Customer appointment changes arrive after hours, and the office team needs a clear next action the following morning." },
  }));
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
    const evidence: CaptureEvidence = { microphoneRequests: 0, recorderStarts: 0, bytes: 0, errors: [] };
    Object.defineProperty(window, "__consentCapture", { configurable: true, value: evidence });
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      evidence.microphoneRequests += 1;
      return nativeGetUserMedia(constraints);
    };
    const NativeMediaRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeMediaRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        this.addEventListener("dataavailable", (event) => { evidence.bytes += event.data.size; });
        this.addEventListener("error", (event) => { evidence.errors.push(event.type); });
      }
      override start(timeslice?: number) {
        evidence.recorderStarts += 1;
        super.start(timeslice);
      }
    };
  });
});
const confirmation = (page: Page) => page.getByRole("dialog", { name: /^Before (?:you record|Ajani continues)\.$/ });
const consentCheckbox = (page: Page) => confirmation(page).getByRole("checkbox", { name: /I confirm I am 18 or older/ });
const recordingNotice = (page: Page) => recorder(page).locator("footer").filter({ hasText: "Before you record." });


async function waitForModalEntrance(page: Page) {
  await confirmation(page).evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  await expect(confirmation(page)).toHaveCSS("opacity", "1");
}
async function assertNoCapture(page: Page) {
  expect(await captureEvidence(page)).toEqual({ microphoneRequests: 0, recorderStarts: 0, bytes: 0, errors: [] });
}

test("voice confirmation traps focus and cancels without requesting a microphone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/record");
  await expect(startButton(page)).toBeEnabled();
  await expect(recordingNotice(page)).toBeVisible();
  await assertNoCapture(page);
  for (const cancel of ["Not now", "Escape", "Close", "Backdrop"]) {
    await startButton(page).click();
    await expect(confirmation(page)).toBeVisible();
    await expect(confirmation(page)).toHaveAttribute("aria-modal", "true");
    await expect(consentCheckbox(page)).not.toBeChecked();
    await expect(consentCheckbox(page)).toBeFocused();
    const submit = confirmation(page).getByRole("button", { name: "Confirm & start recording", exact: true });
    await expect(submit).toBeDisabled();
    await assertNoCapture(page);
    if (cancel === "Not now") {
      await waitForModalEntrance(page);
      await page.screenshot({ path: testInfo.outputPath("desktop-confirmation.png") });
      for (const key of ["Shift+Tab", "Shift+Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Tab"]) {
        await page.keyboard.press(key);
        expect(await confirmation(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
    }
    await consentCheckbox(page).check();
    await expect(submit).toBeEnabled();
    await assertNoCapture(page);
    if (cancel === "Not now") await confirmation(page).getByRole("button", { name: "Not now", exact: true }).click();
    else if (cancel === "Escape") await page.keyboard.press("Escape");
    else if (cancel === "Close") await confirmation(page).getByRole("button", { name: "Close processing confirmation", exact: true }).click();
    else await page.mouse.click(4, 4);
    await expect(confirmation(page)).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();
    await expect(recordingNotice(page)).toBeVisible();
    await expect(recorder(page).getByRole("status")).toHaveText("Ready to record");
    await assertNoCapture(page);
  }
});

for (const width of [1440, 390, 320]) {
  test(`confirmed recording starts once and keeps paused edits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 769 ? 844 : 1000 });
    await page.goto("/record");
    await startButton(page).click();
    await expect(confirmation(page)).toBeVisible();
    await assertNoCapture(page);
    if (width === 390) {
      await waitForModalEntrance(page);
      await page.screenshot({ path: testInfo.outputPath("mobile-confirmation.png") });
    }
    await consentCheckbox(page).check();
    await assertNoCapture(page);
    await confirmation(page).getByRole("button", { name: "Confirm & start recording", exact: true }).click();
    await expect(confirmation(page)).toHaveCount(0);
    await expect(recorder(page).getByRole("status")).toHaveText("Recording");
    await expect.poll(async () => (await captureEvidence(page)).bytes).toBeGreaterThan(0);
    expect(await captureEvidence(page)).toMatchObject({ microphoneRequests: 1, recorderStarts: 1, errors: [] });
    await expect(recordingNotice(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Pause & edit", exact: true }).click();
    await expect(recorder(page).getByRole("status")).toHaveText("Recording paused");
    const editor = page.getByRole("textbox", { name: "Edit your voice note transcript", exact: true });
    await expect(editor).toBeFocused();
    const contrast = await editor.evaluate((element) => {
      const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (color: number[]) => color.map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const style = getComputedStyle(element);
      const background = luminance(rgb(style.backgroundColor));
      const ratio = (color: string) => { const foreground = luminance(rgb(color)); return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05); };
      return { text: ratio(style.color), placeholder: ratio(getComputedStyle(element, "::placeholder").color) };
    });
    await testInfo.attach("paused-editor-contrast", { body: JSON.stringify(contrast), contentType: "application/json" });
    const edited = "After-hours appointment requests should reach the office team with a clear next action and the correct client context.";
    await editor.fill(edited);
    await recorder(page).screenshot({ path: testInfo.outputPath(`paused-editor-${width}.png`) });
    expect(contrast.text).toBeGreaterThanOrEqual(4.5);
    expect(contrast.placeholder).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.getByRole("button", { name: "Continue recording", exact: true }).click();
    await expect(recorder(page).getByRole("status")).toHaveText("Recording");
    await page.getByRole("button", { name: "Pause & edit", exact: true }).click();
    await expect(editor).toHaveValue(edited);
    await page.getByRole("button", { name: "Use this note", exact: true }).click();
    await expect(recorder(page).getByRole("status")).toHaveText("Voice note ready");
    await expect(page.getByRole("button", { name: "Continue to clarify", exact: true })).toBeEnabled();
    await expect(recordingNotice(page)).toHaveCount(0);
    expect(await captureEvidence(page)).toMatchObject({ microphoneRequests: 1, recorderStarts: 1, errors: [] });
  });
}

test("typed Continue requires confirmation and preserves only committed current-version acknowledgment", async ({ page }) => {
  const briefRequests: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/automation-brief" && request.method() === "POST") briefRequests.push(request.postDataJSON());
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const note = page.getByRole("textbox", { name: "Tell us where the work gets stuck", exact: true });
  const written = "After-hours customer appointment changes wait until morning, and the office team needs a clear next action.";
  await note.fill(written);
  const continueButton = page.getByRole("button", { name: "Continue to clarify", exact: true });
  await continueButton.click();
  await expect(confirmation(page)).toBeVisible();
  await expect(confirmation(page).locator("#processing-confirmation-description")).not.toContainText("microphone");
  const confirmContinue = confirmation(page).getByRole("button", { name: "Confirm & continue", exact: true });
  await expect(confirmContinue).toBeDisabled();
  expect(briefRequests).toHaveLength(0);
  await consentCheckbox(page).check();
  await confirmation(page).getByRole("button", { name: "Not now", exact: true }).click();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(note).toHaveValue(written);
  expect(briefRequests).toHaveLength(0);
  await assertNoCapture(page);
  await continueButton.click();
  await expect(consentCheckbox(page)).not.toBeChecked();
  await consentCheckbox(page).check();
  await confirmContinue.click();
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route.", exact: true })).toBeVisible();
  expect(briefRequests.length).toBeGreaterThan(0);
  expect(briefRequests.every((request) => request.processingAcknowledged === true && request.processingNoticeVersion === "request-processing-2026-09-02")).toBe(true);
  await expect.poll(() => page.evaluate(() => { const stored = JSON.parse(sessionStorage.getItem("ajani_record_flow_v3") ?? "{}"); return { acknowledged: stored.processingAcknowledged, stage: stored.stage }; })).toEqual({ acknowledged: true, stage: 1 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route.", exact: true })).toBeVisible();
  await expect(confirmation(page)).toHaveCount(0);
  await assertNoCapture(page);
  // Seed before hydration so the running page's debounced autosave cannot replace the old notice version.
  await page.addInitScript(() => {
    const stored = JSON.parse(sessionStorage.getItem("ajani_record_flow_v3") ?? "{}");
    stored.processingNoticeVersion = "outdated-test-version";
    sessionStorage.setItem("ajani_record_flow_v3", JSON.stringify(stored));
  });
  await page.reload();
  await expect(note).toHaveValue(written);
  await continueButton.click();
  await expect(confirmation(page)).toBeVisible();
  await expect(consentCheckbox(page)).not.toBeChecked();
  await assertNoCapture(page);
});

test.afterEach(async ({ page }, testInfo) => {
  const signals = browserSignals.get(page) ?? { pageErrors: [], consoleErrors: [], blockedResources: [] };
  // This isolated fixture blocks external scripts. Retain the resulting Clerk timeout in
  // evidence, while failing on every page error that is not tied to that blocked script.
  const blockedClerk = signals.blockedResources.some((url) => new URL(url).hostname.endsWith(".clerk.accounts.dev") && url.endsWith("/clerk.browser.js"));
  const expectedBlockedProviderErrors = signals.pageErrors.filter((error) => blockedClerk && error.startsWith("Clerk: Failed to load Clerk JS, failed to load script:") && error.includes('code="failed_to_load_clerk_js"'));
  const unexpectedPageErrors = signals.pageErrors.filter((error) => !expectedBlockedProviderErrors.includes(error));
  const expectedBlockedProviderConsoleErrors = signals.consoleErrors.filter((error) => blockedClerk
    && error.startsWith("ClerkRuntimeError: Clerk: Failed to load Clerk JS")
    && error.includes('code="failed_to_load_clerk_js"'));
  const unexpectedConsoleErrors = signals.consoleErrors.filter((error) =>
    !error.startsWith("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT")
    && !expectedBlockedProviderConsoleErrors.includes(error));
  const path = testInfo.outputPath("browser-signals.json");
  await writeFile(path, JSON.stringify({ ...signals, expectedBlockedProviderErrors, expectedBlockedProviderConsoleErrors, unexpectedPageErrors, unexpectedConsoleErrors }, null, 2));
  await testInfo.attach("browser-signals", { path, contentType: "application/json" });
  expect(unexpectedPageErrors).toEqual([]);
  expect(unexpectedConsoleErrors).toEqual([]);
});
