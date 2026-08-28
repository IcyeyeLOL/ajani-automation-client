"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveWaveform } from "./live-waveform";
import styles from "./voice-recorder.module.css";

type Phase = "idle" | "requesting" | "recording" | "paused" | "ready" | "blocked" | "error";

const MAX_SECONDS = 180;
const PERMISSION_TIMEOUT_MS = 30_000;

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const statusCopy: Record<Phase, string> = {
  idle: "Ready to record",
  requesting: "Microphone permission",
  recording: "Recording",
  paused: "Recording paused",
  ready: "Voice note ready",
  blocked: "Microphone blocked",
  error: "Recording failed",
};

type RecorderProps = {
  id?: string;
  embedded?: boolean;
  onCaptured?: (capture: VoiceMemoCapture) => void;
  onInvalidated?: () => void;
  onActiveChange?: (active: boolean) => void;
  onTranscriptChange?: (transcript: string) => void;
  savedCapture?: VoiceMemoCapture | null;
  transcript?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: {
    results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }>;
  }) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type VoiceMemoCapture = {
  blob: Blob;
  bytes: number;
  mimeType: "audio/webm" | "audio/mp4" | "audio/mpeg" | "audio/ogg" | "audio/wav";
  objectUrl: string;
  seconds: number;
  transcriptSource: "live" | "manual" | "none";
};

const supportedMimeTypes = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"] as const;
const recorderMimePreferences = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

function normalizeMimeType(value: string): VoiceMemoCapture["mimeType"] | null {
  const base = value.split(";", 1)[0]?.toLowerCase();
  return supportedMimeTypes.find((mimeType) => mimeType === base) ?? null;
}

function preferredRecorderMimeType() {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return recorderMimePreferences.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function VoiceRecorder({
  id,
  embedded = false,
  onActiveChange,
  onCaptured,
  onInvalidated,
  onTranscriptChange,
  savedCapture = null,
  transcript = "",
}: RecorderProps) {
  const [phase, setPhase] = useState<Phase>(savedCapture ? "ready" : "idle");
  const [seconds, setSeconds] = useState(savedCapture?.seconds ?? 0);
  const [size, setSize] = useState(savedCapture?.bytes ?? 0);
  const [audioUrl, setAudioUrl] = useState<string | null>(savedCapture?.objectUrl ?? null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [transcriptionMode, setTranscriptionMode] = useState<"idle" | "live" | "manual">("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const secondsRef = useRef(0);
  const audioUrlRef = useRef<string | null>(audioUrl);
  const urlTransferred = useRef(Boolean(savedCapture));
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const captureFailed = useRef(false);
  const transcriptRef = useRef(transcript);
  const transcriptSourceRef = useRef<VoiceMemoCapture["transcriptSource"]>(savedCapture?.transcriptSource ?? "none");

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    onActiveChange?.(phase === "requesting" || phase === "recording" || phase === "paused");
  }, [onActiveChange, phase]);

  const stopRecognition = useCallback((abort = false) => {
    const current = recognition.current;
    recognition.current = null;
    if (!current) return;
    current.onend = null;
    try {
      if (abort) current.abort();
      else current.stop();
    } catch {
      // Recognition may already have ended after a stretch of silence.
    }
  }, []);

  const startRecognition = useCallback(() => {
    const recognitionWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = recognitionWindow.SpeechRecognition ?? recognitionWindow.webkitSpeechRecognition;
    if (!Recognition || !onTranscriptChange) {
      setTranscriptionMode("manual");
      return;
    }

    const nextRecognition = new Recognition();
    const base = transcriptRef.current.trim();
    nextRecognition.continuous = true;
    nextRecognition.interimResults = true;
    nextRecognition.lang = document.documentElement.lang || "en-US";
    nextRecognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const phrase = result?.[0]?.transcript?.trim();
        if (!phrase) continue;
        if (result.isFinal) finalText += `${phrase} `;
        else interimText += `${phrase} `;
      }
      const nextTranscript = [base, finalText.trim(), interimText.trim()].filter(Boolean).join(" ");
      transcriptSourceRef.current = "live";
      transcriptRef.current = nextTranscript;
      onTranscriptChange(nextTranscript);
    };
    nextRecognition.onerror = () => {
      if (recognition.current === nextRecognition) recognition.current = null;
      setTranscriptionMode("manual");
    };
    nextRecognition.onend = () => {
      if (recognition.current === nextRecognition) recognition.current = null;
    };

    try {
      recognition.current = nextRecognition;
      nextRecognition.start();
      setTranscriptionMode("live");
    } catch {
      recognition.current = null;
      setTranscriptionMode("manual");
    }
  }, [onTranscriptChange]);

  const releaseStream = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLiveStream(null);
  }, []);

  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    urlTransferred.current = false;
    setAudioUrl(null);
  }, []);

  const invalidateCapture = useCallback(() => {
    revokeAudioUrl();
    setSize(0);
    onInvalidated?.();
  }, [onInvalidated, revokeAudioUrl]);

  const finish = useCallback(() => {
    stopRecognition();
    const current = recorder.current;
    if (current && current.state !== "inactive") current.stop();
    releaseStream();
  }, [releaseStream, stopRecognition]);

  useEffect(() => {
    // React Strict Mode runs an extra setup/cleanup cycle in development.
    // Reset this guard during setup so successful permission requests are not
    // mistaken for late results from an unmounted recorder.
    mounted.current = true;
    return () => {
      mounted.current = false;
      onActiveChange?.(false);
      requestGeneration.current += 1;
      stopRecognition(true);
      const current = recorder.current;
      if (current && current.state !== "inactive") {
        current.ondataavailable = null;
        current.onstop = null;
        current.onerror = null;
        current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current && !urlTransferred.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [onActiveChange, stopRecognition]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        const next = value + 1;
        secondsRef.current = next;
        return Math.min(next, MAX_SECONDS);
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [finish, phase]);

  useEffect(() => {
    if (phase !== "recording" || seconds < MAX_SECONDS) return;
    const timer = window.setTimeout(finish, 0);
    return () => window.clearTimeout(timer);
  }, [finish, phase, seconds]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("error");
      return;
    }

    invalidateCapture();
    stopRecognition(true);
    transcriptRef.current = "";
    transcriptSourceRef.current = "none";
    onTranscriptChange?.("");
    setTranscriptionMode("idle");
    captureFailed.current = false;
    setSeconds(0);
    secondsRef.current = 0;
    chunks.current = [];
    setPhase("requesting");
    const generation = ++requestGeneration.current;
    let permissionTimer = 0;

    try {
      const mediaRequest = navigator.mediaDevices.getUserMedia({ audio: true });
      void mediaRequest.then((lateMedia) => {
        if (!mounted.current || generation !== requestGeneration.current) {
          lateMedia.getTracks().forEach((track) => track.stop());
        }
      }).catch(() => {});
      const permissionTimeout = new Promise<never>((_, reject) => {
        permissionTimer = window.setTimeout(
          () => reject(new DOMException("Microphone permission timed out", "NotAllowedError")),
          PERMISSION_TIMEOUT_MS,
        );
      });
      const media = await Promise.race([mediaRequest, permissionTimeout]);
      window.clearTimeout(permissionTimer);
      if (!mounted.current || generation !== requestGeneration.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }

      const preferredMimeType = preferredRecorderMimeType();
      stream.current = media;
      const nextRecorder = new MediaRecorder(media, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
      recorder.current = nextRecorder;
      setLiveStream(media);

      media.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (nextRecorder.state === "inactive") return;
          captureFailed.current = true;
          nextRecorder.stop();
        };
      });

      nextRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      nextRecorder.onerror = () => {
        captureFailed.current = true;
        stopRecognition(true);
        releaseStream();
        invalidateCapture();
        setPhase("error");
      };
      nextRecorder.onstop = () => {
        const mimeType = normalizeMimeType(nextRecorder.mimeType || chunks.current[0]?.type || "audio/webm");
        if (captureFailed.current || !mimeType) {
          releaseStream();
          invalidateCapture();
          setPhase("error");
          return;
        }
        const blob = new Blob(chunks.current, { type: mimeType });
        const bytes = blob.size;
        releaseStream();

        if (bytes === 0 || secondsRef.current === 0) {
          invalidateCapture();
          setPhase("error");
          return;
        }

        const nextUrl = URL.createObjectURL(blob);
        audioUrlRef.current = nextUrl;
        urlTransferred.current = true;
        setAudioUrl(nextUrl);
        setSize(bytes);
        setPhase("ready");
        onCaptured?.({ blob, seconds: secondsRef.current, bytes, mimeType, objectUrl: nextUrl, transcriptSource: transcriptSourceRef.current });
      };
      nextRecorder.start(1_000);
      startRecognition();
      setPhase("recording");
    } catch (reason) {
      window.clearTimeout(permissionTimer);
      requestGeneration.current += 1;
      stopRecognition(true);
      releaseStream();
      invalidateCapture();
      const permissionDenied = reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "SecurityError");
      setPhase(permissionDenied ? "blocked" : "error");
    }
  };

  const pause = () => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    stopRecognition();
    setPhase("paused");
  };

  const resume = () => {
    if (recorder.current?.state !== "paused") return;
    recorder.current.resume();
    startRecognition();
    setPhase("recording");
  };

  const discard = () => {
    requestGeneration.current += 1;
    stopRecognition(true);
    invalidateCapture();
    transcriptRef.current = "";
    transcriptSourceRef.current = "none";
    onTranscriptChange?.("");
    setTranscriptionMode("idle");
    setSeconds(0);
    secondsRef.current = 0;
    chunks.current = [];
    setPhase("idle");
  };

  const recording = phase === "recording";
  const paused = phase === "paused";
  const ready = phase === "ready";

  return (
    <section aria-label="Voice note recorder" className={styles.panel} data-phase={phase} id={id}>
      <header className={styles.head}>
        <span aria-live="polite" className={styles.status} role="status">
          <i aria-hidden="true" />
          {statusCopy[phase]}
        </span>
        <b className={styles.timer}>{clock(seconds)} <span>/ 03:00</span></b>
      </header>

      <div className={styles.body}>
        {recording ? (
          <div className={styles.visual}>
            <LiveWaveform stream={liveStream} />
          </div>
        ) : null}

        {paused ? (
          <div className={styles.pausedWorkspace}>
            <header>
              <div>
                <span><i aria-hidden="true" /> Recording paused at {clock(seconds)}</span>
                <strong>Edit the note before you continue</strong>
              </div>
              <b>{transcriptionMode === "live" ? "Transcript ready" : "Written note"}</b>
            </header>

            <div className={styles.pausedMeter} aria-hidden="true">
              {Array.from({ length: 32 }, (_, index) => <i key={index} />)}
              <span>Recording paused</span>
            </div>

            <label className={styles.transcriptEditor}>
              <span>Your written note</span>
              <textarea
                aria-label="Edit your voice note transcript"
                autoFocus
                onChange={(event) => {
                  transcriptSourceRef.current = "manual";
                  transcriptRef.current = event.target.value;
                  onTranscriptChange?.(event.target.value);
                }}
                placeholder="Your browser may add speech here automatically. Correct it, add context, or write the important parts in your own words."
                rows={6}
                value={transcript}
              />
            </label>

            <div className={styles.pausedMeta}>
              <span>{transcript.trim().length} characters</span>
              <span>Your edits stay when you resume</span>
            </div>

            <ol className={styles.pauseRoute} aria-label="Paused recording workflow">
              <li data-done="true"><b>01</b><span>Recorded</span></li>
              <li data-current="true"><b>02</b><span>Review note</span></li>
              <li><b>03</b><span>Continue</span></li>
            </ol>

            <div className={styles.recordingActions}>
              <button className={styles.resumeControl} onClick={resume} type="button">Continue recording</button>
              <button className={styles.stopControl} onClick={finish} type="button">Use this note</button>
            </div>
          </div>
        ) : ready && audioUrl ? (
          <div className={styles.readyState}>
            <span className={styles.readyMark} aria-hidden="true">✓</span>
            <div>
              <strong>Voice note saved</strong>
              <small>{clock(seconds)} · {Math.max(1, Math.round(size / 1024))} KB · private to this request</small>
            </div>
            <audio aria-label="Review your voice note" controls preload="metadata" src={audioUrl} />
            <div className={styles.readyActions}>
              <button onClick={() => void start()} type="button">Redo note</button>
              <button onClick={discard} type="button">Discard</button>
            </div>
          </div>
        ) : (
          <div className={styles.captureState}>
            {recording ? (
              <>
                <strong>Speak naturally. Rambling is fine.</strong>
                <small>Pause whenever you want to correct the written version, then resume to add more.</small>
                {transcript.trim() ? (
                  <p aria-live="polite" className={styles.liveTranscript}><b>Live draft</b>{transcript}</p>
                ) : (
                  <p className={styles.transcriptWaiting}>{transcriptionMode === "live" ? "Listening for the first words…" : "Pause to add or edit the written version."}</p>
                )}
                <div className={styles.recordingActions}>
                  <button className={styles.secondaryControl} onClick={pause} type="button">Pause &amp; edit</button>
                  <button className={styles.stopControl} onClick={finish} type="button">Finish note</button>
                </div>
              </>
            ) : (
              <>
                <button
                  aria-label="Start recording your voice note"
                  className={styles.record}
                  disabled={phase === "requesting"}
                  onClick={() => void start()}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.idleWave}>
                    {Array.from({ length: 28 }, (_, index) => <i key={index} />)}
                  </span>
                  <b>{phase === "requesting" ? "Waiting for microphone" : "Start voice note"}</b>
                </button>
                <strong>
                  {phase === "requesting"
                    ? "Check your browser for microphone access"
                    : phase === "blocked"
                      ? "Your browser blocked the microphone"
                      : phase === "error"
                        ? "We could not capture that recording"
                        : "Talk through the messy part"}
                </strong>
                <small>
                  {phase === "blocked"
                    ? "Update this site's microphone permission, then try again — or use the written option."
                    : phase === "error"
                      ? "Check your microphone and retry. You can always continue in writing."
                      : "Up to three minutes. Explain what happens today, where it gets stuck, and what a better outcome would look like."}
                </small>
                {phase === "blocked" || phase === "error" ? (
                  <button className={styles.retry} onClick={() => void start()} type="button">Try microphone again</button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      <footer className={styles.privacy}>
        <span aria-hidden="true">◇</span>
        <p><strong>Private by default.</strong> The recording stays in this tab until you choose Use this note. It is then sent securely for transcription and saved only when you approve the handoff.</p>
      </footer>

      {embedded ? null : (
        <div className={styles.actions}>
          <button className={styles.send} disabled={!ready} type="button">Use this note <span aria-hidden="true">→</span></button>
          <small>You see the route and commercial terms before anything is built.</small>
        </div>
      )}
    </section>
  );
}
