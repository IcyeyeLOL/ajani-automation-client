import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/transcription/worker", () => ({
  transcribeVoiceMemoBlob: mocks.transcribe,
}));

import {
  POST,
  isAllowedRequestOrigin,
  matchesAudioContainer,
  requestFingerprint,
} from "@/app/api/transcribe-voice/route";

const LOCAL_URL = "http://localhost:3001/api/transcribe-voice";
const VALID_WEBM_HEADER = [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0];

describe("POST /api/transcribe-voice", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    mocks.transcribe.mockReset().mockResolvedValue({ text: "A clear written note." });
    vi.stubEnv("REQUEST_RATE_LIMIT_SECRET", "test-rate-limit-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3001");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects a production request without an Origin before parsing the upload", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = audioRequest({ origin: null });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Request origin is not allowed." });
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it.each([
    ["same request origin", "https://deployment.example/api/transcribe-voice", "https://deployment.example"],
    ["configured application origin", "https://deployment.example/api/transcribe-voice", "https://ajaniflow.com"],
  ])("allows the %s in production", async (_label, url, origin) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ajaniflow.com/portal");

    const response = await POST(audioRequest({ origin, url }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transcript: "A clear written note." });
  });

  it("keeps an anonymous local recorder request working outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await POST(audioRequest({ origin: null }));

    expect(response.status).toBe(200);
    expect(mocks.transcribe).toHaveBeenCalledOnce();
  });

  it("rejects a cross-origin request", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(audioRequest({ origin: "https://attacker.example" }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before calling formData", async () => {
    const request = new Request(LOCAL_URL, {
      method: "POST",
      headers: {
        "content-length": String(15_728_640 + 65_536 + 1),
        "content-type": "multipart/form-data; boundary=upload",
        origin: "http://localhost:3001",
      },
    });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "The voice note exceeds the 15 MB limit." });
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects a malformed declared body length", async () => {
    const request = new Request(LOCAL_URL, {
      method: "POST",
      headers: {
        "content-length": "not-a-number",
        "content-type": "multipart/form-data; boundary=upload",
        origin: "http://localhost:3001",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Request headers are invalid." });
  });

  it("rejects an audio Blob larger than 15 MB even without a declared length", async () => {
    const oversizedAudio = new Blob([
      new Uint8Array(VALID_WEBM_HEADER),
      new Uint8Array(15_728_640 - VALID_WEBM_HEADER.length + 1),
    ], { type: "audio/webm" });

    const response = await POST(audioRequest({ audio: oversizedAudio }));

    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("rejects an empty audio file", async () => {
    const response = await POST(audioRequest({ audio: new Blob([], { type: "audio/webm" }) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Add a voice note to transcribe." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects provider processing without the current acknowledgment", async () => {
    const response = await POST(audioRequest({ acknowledged: false }));

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toEqual({
      error: "Review the current processing notice before transcribing this note.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it.each([
    ["an unapproved MIME type", new Blob([new Uint8Array(VALID_WEBM_HEADER)], { type: "application/octet-stream" })],
    ["bytes that do not match the declared MIME type", new Blob([new TextEncoder().encode("not a webm recording")], { type: "audio/webm" })],
  ])("rejects %s", async (_label, audio) => {
    const response = await POST(audioRequest({ audio }));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: "This voice-note format is not supported." });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("uses the shared database throttle before Deepgram", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await POST(audioRequest());

    expect(response.status).toBe(429);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_public_request_allowance", {
      p_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_limit: 8,
      p_window_seconds: 600,
    });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("fails closed with a stable response when the throttle is unavailable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("database detail") });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(audioRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Voice transcription is temporarily unavailable." });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("returns a stable safe error when Deepgram fails", async () => {
    mocks.transcribe.mockRejectedValue(new Error("provider detail"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(audioRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "We could not put this voice note into writing. Please retry or type the note.",
    });
  });
});

describe("transcription request validation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["audio/webm", [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["audio/mp4", [0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]],
    ["audio/ogg", [0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["audio/wav", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ["audio/mpeg", [0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])("recognizes a matching %s container", async (mimeType, bytes) => {
    await expect(matchesAudioContainer(
      new Blob([new Uint8Array(bytes as number[])], { type: mimeType as string }),
      mimeType as string,
    )).resolves.toBe(true);
  });

  it("keeps raw client metadata out of the database fingerprint", () => {
    vi.stubEnv("REQUEST_RATE_LIMIT_SECRET", "fingerprint-secret");
    const request = new Request(LOCAL_URL, {
      headers: {
        "user-agent": "test-browser",
        "x-forwarded-for": "203.0.113.42, 10.0.0.2",
      },
    });

    const fingerprint = requestFingerprint(request);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("203.0.113.42");
    expect(fingerprint).not.toContain("test-browser");
  });

  it("accepts the configured application origin independently of the deployment host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ajaniflow.com/portal");
    const request = new Request("https://deployment.example/api/transcribe-voice", {
      headers: { origin: "https://ajaniflow.com" },
    });

    expect(isAllowedRequestOrigin(request)).toBe(true);
  });
});

function audioRequest({
  acknowledged = true,
  audio = new Blob([new Uint8Array(VALID_WEBM_HEADER)], { type: "audio/webm" }),
  origin = "http://localhost:3001",
  url = LOCAL_URL,
}: {
  acknowledged?: boolean;
  audio?: Blob;
  origin?: string | null;
  url?: string;
} = {}) {
  const body = new FormData();
  body.set("audio", audio, "voice-note");
  body.set("processingAcknowledged", String(acknowledged));
  body.set("processingNoticeVersion", "request-processing-2026-09-02");
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request(url, { method: "POST", headers, body });
}
