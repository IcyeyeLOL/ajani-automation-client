export async function transcribeCapturedVoiceMemo(audio: Blob) {
  const body = new FormData();
  body.set("audio", audio, "voice-note");

  const response = await fetch("/api/transcribe-voice", {
    method: "POST",
    body,
  });
  const result = await response.json().catch(() => ({})) as { transcript?: string; error?: string };
  if (!response.ok || !result.transcript?.trim()) {
    throw new Error(result.error || "We could not put this voice note into writing.");
  }
  return result.transcript.trim();
}
