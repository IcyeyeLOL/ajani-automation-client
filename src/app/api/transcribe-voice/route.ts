import { createHash } from "node:crypto";
import { processingNoticeAcknowledgmentSchema } from "@/lib/legal/processing-notice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { transcribeVoiceMemoBlob } from "@/lib/transcription/worker";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 15_728_640;
const MAX_MULTIPART_OVERHEAD_BYTES = 65_536;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
const RATE_LIMIT_BUCKET = "transcribe-voice:v1";
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const MAX_TRANSCRIPTIONS_PER_WINDOW = 8;
const acceptedAudioTypes = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"]);

type RateLimitClient = Pick<ReturnType<typeof createSupabaseAdminClient>, "rpc">;

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return errorResponse("Request origin is not allowed.", 403);
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(Number(declaredLength))) {
      return errorResponse("Request headers are invalid.", 400);
    }
    if (Number(declaredLength) > MAX_REQUEST_BYTES) {
      return errorResponse("The voice note exceeds the 15 MB limit.", 413);
    }
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("Add a voice note to transcribe.", 400);
  }

  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return errorResponse("Add a voice note to transcribe.", 400);
  }

  const acknowledgment = processingNoticeAcknowledgmentSchema.safeParse({
    processingAcknowledged: body.get("processingAcknowledged") === "true",
    processingNoticeVersion: body.get("processingNoticeVersion"),
  });
  if (!acknowledgment.success) {
    return errorResponse("Review the current processing notice before transcribing this note.", 428);
  }

  const audio = body.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return errorResponse("Add a voice note to transcribe.", 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return errorResponse("The voice note exceeds the 15 MB limit.", 413);
  }

  const mimeType = audio.type.split(";", 1)[0]?.toLowerCase();
  if (!acceptedAudioTypes.has(mimeType) || !(await matchesAudioContainer(audio, mimeType))) {
    return errorResponse("This voice-note format is not supported.", 415);
  }

  try {
    const admin = createSupabaseAdminClient();
    const allowed = await consumeTranscriptionAllowance(admin, requestFingerprint(request));
    if (!allowed) {
      return errorResponse("Too many voice notes were submitted. Please wait a few minutes and retry.", 429);
    }
  } catch (error) {
    console.error("[transcribe-voice] rate_limit_failed", {
      message: error instanceof Error ? error.message : "unknown_rate_limit_error",
    });
    return errorResponse("Voice transcription is temporarily unavailable.", 503);
  }

  try {
    const result = await transcribeVoiceMemoBlob(audio, mimeType);
    if (!result.text) {
      return errorResponse("We could not hear enough speech to create the written note.", 422);
    }
    return Response.json({ transcript: result.text }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[transcribe-voice] failed", {
      message: error instanceof Error ? error.message : "unknown_transcription_error",
    });
    return errorResponse("We could not put this voice note into writing. Please retry or type the note.", 503);
  }
}

export async function consumeTranscriptionAllowance(admin: RateLimitClient, fingerprint: string) {
  const { data, error } = await admin.rpc("consume_public_request_allowance", {
    p_fingerprint: fingerprint,
    p_limit: MAX_TRANSCRIPTIONS_PER_WINDOW,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (error) throw error;
  return Boolean(data);
}

export function isAllowedRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  const allowedOrigins = new Set([new URL(request.url).origin]);
  const configuredOrigin = appOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);

  const requestOrigin = appOrigin(origin);
  return requestOrigin !== null && allowedOrigins.has(requestOrigin);
}

export function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const salt = process.env.REQUEST_RATE_LIMIT_SECRET || process.env.AJANI_ADMIN_SESSION_SECRET;
  if (!salt && process.env.NODE_ENV === "production") throw new Error("request_rate_limit_secret_missing");
  return createHash("sha256")
    .update(`${RATE_LIMIT_BUCKET}:${address}:${userAgent}:${salt || "development"}`)
    .digest("hex");
}

export async function matchesAudioContainer(blob: Blob, mimeType: string) {
  if (blob.size < 12) return false;
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());

  if (mimeType === "audio/webm") {
    return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  if (mimeType === "audio/mp4") return ascii(bytes, 4, 8) === "ftyp";
  if (mimeType === "audio/ogg") return ascii(bytes, 0, 4) === "OggS";
  if (mimeType === "audio/wav") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
  if (mimeType === "audio/mpeg") {
    return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  return false;
}

function appOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
