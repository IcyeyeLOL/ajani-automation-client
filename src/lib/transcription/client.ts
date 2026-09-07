import type { ProcessingNoticeAcknowledgment } from "@/lib/legal/processing-notice";
import { withRequestDeadline } from "@/lib/record/request-deadline";

export async function transcribeCapturedVoiceMemo(
  audio: Blob,
  acknowledgment: ProcessingNoticeAcknowledgment,
  signal?: AbortSignal,
) {
  const body = new FormData();
  body.set("audio", audio, "voice-note");
  body.set("processingAcknowledged", String(acknowledgment.processingAcknowledged));
  body.set("processingNoticeVersion", acknowledgment.processingNoticeVersion);

  return withRequestDeadline(async (requestSignal) => {
    const response = await fetch("/api/transcribe-voice", { method: "POST", body, signal: requestSignal });
    const result = await response.json().catch(() => ({})) as { transcript?: unknown; error?: unknown };
    if (!response.ok || typeof result.transcript !== "string" || !result.transcript.trim()) {
      throw new Error(typeof result.error === "string" ? result.error : "We could not put this voice note into writing.");
    }
    return result.transcript.trim();
  }, { signal, timeoutMs: 55_000, timeoutMessage: "Transcription took too long. Retry the saved recording or continue in writing." });
}
