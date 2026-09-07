import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT } from "@/lib/legal/processing-notice";
import { fallbackAutomationShape } from "./automation-brief";
import { requestAutomationClarifications, requestAutomationShape } from "./automation-brief-client";

const transcript = "After-hours leads wait until morning and need a clear owner.";
const answers = [{ question: "Who owns it?", answer: "The sales team." }];
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("automation request client", () => {
  it("rejects missing handoffs so the UI can provide a usable backup route", async () => {
    const result = fallbackAutomationShape(transcript, answers);
    result.systemBlocks = result.systemBlocks.map((block) => ({ ...block, kind: "custom" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(result)));
    await expect(requestAutomationShape(transcript, answers, CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT)).rejects.toThrow("incomplete automation brief");
  });

  it("cancels obsolete work without sending a pre-canceled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestAutomationClarifications(transcript, CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds a stalled generation response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => new Promise<never>(() => {}) }));
    const pending = requestAutomationClarifications(transcript, CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT);
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(55_000);
    await rejected;
  });
});
