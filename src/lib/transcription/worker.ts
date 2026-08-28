import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type ClaimedJob = {
  job_id: string;
  voice_memo_id: string;
  attempt_count: number;
  max_attempts: number;
  model: string;
};

type VoiceMemo = {
  id: string;
  storage_path: string;
  mime_type: string | null;
};

type DeepgramResponse = {
  metadata?: { request_id?: string; duration?: number };
  results?: {
    channels?: Array<{
      detected_language?: string;
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
    }>;
  };
  err_code?: string;
  err_msg?: string;
};

export type TranscriptionSweepResult = {
  claimed: number;
  succeeded: number;
  retryableFailures: number;
  terminalFailures: number;
};

export async function processVoiceTranscriptions(options: { limit?: number; voiceMemoId?: string; admin?: AdminClient } = {}) {
  const admin = options.admin ?? createSupabaseAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 3, 1), 10);
  const result: TranscriptionSweepResult = {
    claimed: 0,
    succeeded: 0,
    retryableFailures: 0,
    terminalFailures: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const job = await claimJob(admin, options.voiceMemoId);
    if (!job) break;
    result.claimed += 1;

    try {
      const memo = await loadVoiceMemo(admin, job.voice_memo_id);
      const audio = await downloadVoiceMemo(admin, memo);
      const transcript = await transcribeVoiceMemoBlob(audio, memo.mime_type, job.model);
      if (!transcript.text) throw new TerminalTranscriptionError("empty_transcript");

      const { error: memoError } = await admin.from("voice_memos").update({
        status: "ready",
        provider: "deepgram",
        duration_seconds: Math.max(Math.round(transcript.durationSeconds), 0),
        transcript: transcript.text,
        transcript_metadata: {
          requestId: transcript.requestId,
          language: transcript.language,
          confidence: transcript.confidence,
          model: job.model,
        },
      }).eq("id", memo.id);
      if (memoError) throw new Error(`voice_memo_update_failed:${memoError.message}`);

      const { error: jobError } = await admin.from("voice_memo_transcription_jobs").update({
        status: "succeeded",
        provider_request_id: transcript.requestId,
        language: transcript.language,
        confidence: transcript.confidence,
        error_code: null,
        next_attempt_at: null,
        completed_at: new Date().toISOString(),
      }).eq("id", job.job_id).eq("status", "running");
      if (jobError) throw new Error(`transcription_state_update_failed:${jobError.message}`);
      result.succeeded += 1;
    } catch (error) {
      const retryable = !(error instanceof TerminalTranscriptionError) && job.attempt_count < job.max_attempts;
      const { error: jobError } = await admin.from("voice_memo_transcription_jobs").update({
        status: retryable ? "retryable_failed" : "terminal_failed",
        error_code: safeErrorCode(error),
        next_attempt_at: retryable ? retryAt(job.attempt_count) : null,
        completed_at: retryable ? null : new Date().toISOString(),
      }).eq("id", job.job_id).eq("status", "running");

      if (!retryable) {
        await admin.from("voice_memos").update({ status: "failed" }).eq("id", job.voice_memo_id);
      }
      if (jobError) {
        console.error("Transcription job state update failed", { jobId: job.job_id, message: jobError.message });
      }
      if (retryable) result.retryableFailures += 1;
      else result.terminalFailures += 1;
    }

    if (options.voiceMemoId) break;
  }

  return result;
}

async function claimJob(admin: AdminClient, voiceMemoId?: string) {
  const { data, error } = await admin.rpc("claim_voice_memo_transcription_job", {
    p_voice_memo_id: voiceMemoId ?? null,
  });
  if (error) throw new Error(`transcription_claim_failed:${error.message}`);
  const claimed = Array.isArray(data) ? data[0] : data;
  return claimed ? claimed as ClaimedJob : null;
}

async function loadVoiceMemo(admin: AdminClient, id: string) {
  const { data, error } = await admin.from("voice_memos")
    .select("id,storage_path,mime_type")
    .eq("id", id)
    .single();
  if (error || !data) throw new TerminalTranscriptionError("voice_memo_missing");
  return data as VoiceMemo;
}

async function downloadVoiceMemo(admin: AdminClient, memo: VoiceMemo) {
  const { data, error } = await admin.storage.from("voice-memos").download(memo.storage_path);
  if (error || !data) throw new Error(`voice_memo_download_failed:${error?.message ?? "not_found"}`);
  return data;
}

export async function transcribeVoiceMemoBlob(audio: Blob, mimeType: string | null, model = "nova-3") {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new TerminalTranscriptionError("deepgram_not_configured");

  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", model || "nova-3");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("mip_opt_out", "true");
  url.searchParams.set("detect_language", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Token ${apiKey}`,
      "content-type": mimeType || audio.type || "application/octet-stream",
    },
    body: audio,
    signal: AbortSignal.timeout(50_000),
  });
  const payload = await response.json().catch(() => ({})) as DeepgramResponse;
  if (!response.ok) {
    const message = payload.err_code || payload.err_msg || `deepgram_http_${response.status}`;
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new TerminalTranscriptionError(message);
    }
    throw new Error(message);
  }

  const channel = payload.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  return {
    text: alternative?.transcript?.trim() ?? "",
    confidence: finiteNumber(alternative?.confidence),
    language: channel?.detected_language ?? null,
    requestId: payload.metadata?.request_id ?? null,
    durationSeconds: finiteNumber(payload.metadata?.duration) ?? 0,
  };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function retryAt(attempt: number) {
  return new Date(Date.now() + Math.min(2 ** Math.max(attempt - 1, 0) * 60_000, 15 * 60_000)).toISOString();
}

function safeErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "unknown_transcription_error";
  return value.toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 120);
}

class TerminalTranscriptionError extends Error {}
