import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { processVoiceTranscriptions } from "./worker";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function client() {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [{ job_id: "job", voice_memo_id: "memo", attempt_count: 2, max_attempts: 3, model: "nova-3" }], error: null })
    .mockResolvedValue({ data: true, error: null });
  return { rpc,
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: "memo", storage_path: "private/note.webm", mime_type: "audio/webm" }, error: null }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: new Blob(["synthetic"]), error: null }) }) },
  };
}
describe("transcription attempt fencing", () => {
  it("persists successful memo and job state in one fenced RPC", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "synthetic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ transcript: "Approved text", confidence: 0.9 }] }] } })));
    const admin = client();
    const result = await processVoiceTranscriptions({ admin: admin as never, limit: 1 });
    expect(result.succeeded).toBe(1);
    expect(admin.rpc).toHaveBeenLastCalledWith("finish_voice_memo_transcription", expect.objectContaining({
      p_job_id: "job", p_attempt: 2, p_status: "succeeded", p_result: expect.objectContaining({ text: "Approved text" }),
    }));
  });
  it("persists provider failure against the current attempt only", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "synthetic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ err_code: "unavailable" }, { status: 503 })));
    const admin = client();
    const result = await processVoiceTranscriptions({ admin: admin as never, limit: 1 });
    expect(result.retryableFailures).toBe(1);
    expect(admin.rpc).toHaveBeenLastCalledWith("finish_voice_memo_transcription", expect.objectContaining({ p_attempt: 2, p_status: "retryable_failed" }));
  });
  it("does not claim when the remaining invocation budget is too small", async () => {
    const admin = client();
    const result = await processVoiceTranscriptions({ admin: admin as never, deadlineAt: Date.now() + 500 });
    expect(result.claimed).toBe(0);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
