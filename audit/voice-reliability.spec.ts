import { expect, test, type Page } from "@playwright/test";
import { mockAutomationBrief } from "../tests/helpers/mock-automation-brief";

// These are isolated audit reproductions. All speech is synthetic and every API
// request is intercepted before the page can send data to an application service.
async function prepareSyntheticRecorder(page: Page, serverTranscript: string) {
  const transcriptionRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        await route.abort("blockedbyclient");
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "External application calls are disabled in this audit." }),
        });
        return;
      }
    }
    await route.continue();
  });
  await mockAutomationBrief(page);
  await page.route("**/api/transcribe-voice", async (route) => {
    transcriptionRequests.push(route.request().method());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ transcript: serverTranscript }),
    });
  });
  await page.addInitScript(() => {
    type SyntheticResult = {
      results: Array<{ 0: { transcript: string }; isFinal: boolean }>;
    };
    class SyntheticSpeechRecognition {
      static instances: SyntheticSpeechRecognition[] = [];
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onresult: ((event: SyntheticResult) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      stopped = false;
      constructor() {
        SyntheticSpeechRecognition.instances.push(this);
      }
      start() {}
      stop() { this.stopped = true; }
      abort() { this.stopped = true; }
      emit(text: string, final = true) {
        this.onresult?.({ results: [{ 0: { transcript: text }, isFinal: final }] });
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: SyntheticSpeechRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: SyntheticSpeechRecognition });
    Object.defineProperty(window, "__voiceAudit", { configurable: true, value: SyntheticSpeechRecognition });
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  const confirmation = page.getByRole("dialog", { name: "Before you record.", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await confirmation.getByRole("button", { name: "Confirm & start recording", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice note recorder" }).getByRole("status")).toHaveText("Recording");
  return { transcriptionRequests };
}

async function emitSpeech(page: Page, instance: number, text: string, final = true) {
  await page.evaluate(({ instance, text, final }) => {
    const audit = (window as unknown as {
      __voiceAudit: { instances: Array<{ emit: (value: string, isFinal: boolean) => void }> };
    }).__voiceAudit;
    if (!audit.instances[instance]) throw new Error(`Synthetic recognition session ${instance} did not start.`);
    audit.instances[instance].emit(text, final);
  }, { instance, text, final });
}

test("manual transcript corrections survive resumed speech and completion", async ({ page }, testInfo) => {
  const original = "Orders above 500 dollars need review by operations.";
  const corrected = "Orders above 50 dollars need review by operations.";
  const continuation = "Notify the shared operations queue.";
  const providerTranscript = `${original} ${continuation}`;
  const { transcriptionRequests } = await prepareSyntheticRecorder(page, providerTranscript);
  await emitSpeech(page, 0, original);
  // Let the real MediaRecorder collect fake-device audio for a nonzero capture.
  await page.waitForTimeout(1_100);
  await page.getByRole("button", { name: "Pause & edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit your voice note transcript" });
  await editor.fill(corrected);
  await expect(editor).toHaveValue(corrected);
  await page.getByRole("button", { name: "Continue recording", exact: true }).click();
  await emitSpeech(page, 1, continuation);
  const liveDraft = page.getByRole("region", { name: "Voice note recorder" }).locator("p").filter({ hasText: "Live draft" });
  await expect(liveDraft).toContainText(corrected);
  const beforeFinish = await liveDraft.textContent();
  await page.getByRole("button", { name: "Finish note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  const finalNote = page.getByRole("textbox", { name: "Add or confirm the written version" });
  await expect(finalNote).toBeVisible();
  const afterFinish = await finalNote.inputValue();
  await testInfo.attach("manual-edit-loss-evidence", {
    body: JSON.stringify({ corrected, beforeFinish, afterFinish, transcriptionRequests }, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("manual-edit-loss.png"), fullPage: true });
  expect(afterFinish).toContain(corrected);
});

test("late speech results cannot overwrite the paused transcript editor", async ({ page }, testInfo) => {
  const original = "We send all incoming leads to the support queue.";
  const corrected = "We send qualified incoming leads to the sales queue.";
  await prepareSyntheticRecorder(page, original);
  await emitSpeech(page, 0, original, false);
  await page.getByRole("button", { name: "Pause & edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit your voice note transcript" });
  await editor.fill(corrected);
  await expect(editor).toHaveValue(corrected);
  const stoppedSession = await page.evaluate(() => {
    const audit = (window as unknown as {
      __voiceAudit: { instances: Array<{ stopped: boolean; onresult: unknown }> };
    }).__voiceAudit;
    return { stopped: audit.instances[0].stopped, resultHandlerAttached: Boolean(audit.instances[0].onresult) };
  });
  expect(stoppedSession.stopped).toBe(true);
  // SpeechRecognition.stop() can deliver its final result asynchronously.
  await emitSpeech(page, 0, original, true);
  // Flush the React update from the synthetic browser event before reading it.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const afterLateResult = await editor.inputValue();
  await testInfo.attach("late-speech-result-evidence", {
    body: JSON.stringify({ corrected, stoppedSession, afterLateResult }, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("late-speech-result.png"), fullPage: true });
  await expect(editor).toHaveValue(corrected);
});
