import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT } from "@/lib/legal/processing-notice";
import { transcribeCapturedVoiceMemo } from "./client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("captured voice transcription client", () => {
  it("sends consent and audio, returning only a validated transcript", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ transcript: "  Correct written note.  " }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(transcribeCapturedVoiceMemo(new Blob(["fake audio"]), CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT)).resolves.toBe("Correct written note.");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.body as FormData).get("processingAcknowledged")).toBe("true");
    expect((init.body as FormData).get("audio")).toBeInstanceOf(Blob);
  });

  it("treats malformed response fields as a recoverable transcription error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ transcript: { text: "not a string" } })));
    await expect(transcribeCapturedVoiceMemo(new Blob(["fake"]), CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT)).rejects.toThrow("could not put this voice note into writing");
  });

  it("also times out when response headers arrive but the body stalls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => new Promise<never>(() => {}) }));
    const pending = transcribeCapturedVoiceMemo(new Blob(["fake"]), CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT);
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(55_000);
    await rejected;
  });
});
