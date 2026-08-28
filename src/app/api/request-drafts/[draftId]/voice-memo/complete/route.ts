import { createHash } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processVoiceTranscriptions } from "@/lib/transcription/worker";

export const runtime = "nodejs";

const completionSchema = z.object({
  draftToken: z.string().min(32).max(128),
});

const MAX_BODY_BYTES = 4_096;
const MAX_AUDIO_BYTES = 15_728_640;

export async function POST(request: Request, context: RouteContext<"/api/request-drafts/[draftId]/voice-memo/complete">) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  const body = await readLimitedJson(request);
  if (body.status === "too_large") return Response.json({ error: "Request body is too large" }, { status: 413 });
  if (body.status === "invalid") {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = completionSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: "The draft capability is invalid." }, { status: 400 });

  const { draftId } = await context.params;
  const tokenHash = createHash("sha256").update(parsed.data.draftToken, "utf8").digest("hex");
  const admin = createSupabaseAdminClient();
  const { data: draft, error: draftError } = await admin
    .from("request_drafts")
    .select("id,payload,status,expires_at")
    .eq("id", draftId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (draftError || !draft || Date.parse(draft.expires_at) <= Date.now() || draft.status === "submitted") {
    return Response.json({ error: "The draft is unavailable." }, { status: 404 });
  }

  const { data: memo, error: memoError } = await admin
    .from("voice_memos")
    .select("id,storage_path,mime_type,original_filename,byte_length")
    .eq("request_draft_id", draft.id)
    .maybeSingle();
  if (memoError || !memo) return Response.json({ error: "The voice note is unavailable." }, { status: 404 });

  const { data: objectInfo, error: objectError } = await admin.storage.from("voice-memos").info(memo.storage_path);
  if (objectError || !objectInfo || !objectInfo.size) {
    return Response.json({ error: "The voice note upload is not complete." }, { status: 409 });
  }
  if (objectInfo.size > MAX_AUDIO_BYTES) {
    await admin.storage.from("voice-memos").remove([memo.storage_path]);
    return Response.json({ error: "The voice note exceeds the 15 MB limit." }, { status: 413 });
  }

  if (memo.byte_length && objectInfo.size !== memo.byte_length) {
    await admin.storage.from("voice-memos").remove([memo.storage_path]);
    return Response.json({ error: "The voice note upload does not match the captured recording." }, { status: 409 });
  }

  const { data: audio, error: downloadError } = await admin.storage.from("voice-memos").download(memo.storage_path);
  if (downloadError || !audio || !(await matchesAudioContainer(audio, memo.mime_type))) {
    await admin.storage.from("voice-memos").remove([memo.storage_path]);
    return Response.json({ error: "The uploaded file is not a supported audio recording." }, { status: 415 });
  }

  const payload = asRecord(draft.payload);
  const voiceMemo = asRecord(payload.voiceMemo);
  const { error: updateError } = await admin.from("voice_memos").update({
    status: "uploaded",
    byte_length: objectInfo.size,
    mime_type: objectInfo.contentType || memo.mime_type,
  }).eq("id", memo.id);
  if (updateError) return unavailable();

  const { error: jobError } = await admin.from("voice_memo_transcription_jobs").upsert({
    voice_memo_id: memo.id,
    status: "queued",
    next_attempt_at: new Date().toISOString(),
  }, { onConflict: "voice_memo_id", ignoreDuplicates: true });
  if (jobError) return unavailable();

  const { error: payloadError } = await admin.from("request_drafts").update({
    payload: {
      ...payload,
      voiceMemo: {
        ...voiceMemo,
        storagePath: memo.storage_path,
        status: "uploaded",
        fileName: memo.original_filename,
        mimeType: objectInfo.contentType || memo.mime_type,
        byteLength: objectInfo.size,
      },
    },
  }).eq("id", draft.id);
  if (payloadError) return unavailable();

  after(async () => {
    try {
      await processVoiceTranscriptions({ voiceMemoId: memo.id, limit: 1 });
    } catch (error) {
      console.error("Immediate voice transcription attempt failed", {
        voiceMemoId: memo.id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return Response.json({ voiceMemo: { status: "uploaded" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unavailable() {
  return Response.json({ error: "The voice note could not be finalized. Please retry." }, { status: 503 });
}

async function readLimitedJson(request: Request): Promise<
  | { status: "ok"; value: unknown }
  | { status: "invalid" }
  | { status: "too_large" }
> {
  if (!request.body) return { status: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return { status: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { status: "invalid" };
  }
}

export async function matchesAudioContainer(blob: Blob, mimeType: string) {
  if (blob.size < 12) return false;
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const type = mimeType.split(";", 1)[0]?.toLowerCase();

  if (type === "audio/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (type === "audio/mp4") return ascii(bytes, 4, 8) === "ftyp";
  if (type === "audio/ogg") return ascii(bytes, 0, 4) === "OggS";
  if (type === "audio/wav") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
  if (type === "audio/mpeg") {
    return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  return false;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
