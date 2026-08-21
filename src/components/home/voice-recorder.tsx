"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveWaveform } from "./live-waveform";
import styles from "./voice-recorder.module.css";

type Phase = "idle" | "requesting" | "recording" | "ready" | "blocked";

const MAX_SECONDS = 180;

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const statusCopy: Record<Phase, string> = {
  idle: "Ready to record",
  requesting: "Waiting for microphone",
  recording: "Recording",
  ready: "Voice note ready",
  blocked: "Microphone unavailable",
};

type RecorderProps = {
  id?: string;
  /**
   * Set when the recorder is a step inside a larger flow: the panel drops its
   * own send button and guidance, because the flow around it owns both.
   */
  embedded?: boolean;
  /** Fires when a recording finishes, with what was actually captured. */
  onCaptured?: (capture: { seconds: number; bytes: number }) => void;
};

export function VoiceRecorder({ id, embedded = false, onCaptured }: RecorderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [size, setSize] = useState(0);
  // The waveform needs the stream as a prop, so it is mirrored into state.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  // onstop fires outside React's render, so it reads the count from a ref
  // rather than from the state closure it was created in.
  const secondsRef = useRef(0);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLiveStream(null);
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        const next = value + 1;
        secondsRef.current = next;
        if (next >= MAX_SECONDS) stop();
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, stop]);

  const start = async () => {
    if (phase === "recording") {
      stop();
      setPhase("ready");
      return;
    }

    setSeconds(0);
    secondsRef.current = 0;
    setSize(0);
    chunks.current = [];
    setPhase("requesting");

    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      setLiveStream(media);
      const mediaRecorder = new MediaRecorder(media);
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const bytes = chunks.current.reduce((total, chunk) => total + chunk.size, 0);
        setSize(bytes);
        setPhase("ready");
        onCaptured?.({ seconds: secondsRef.current, bytes });
      };
      mediaRecorder.start();
      setPhase("recording");
    } catch {
      // No microphone, no permission, or an insecure origin. Say so plainly
      // rather than pretending a recording happened.
      stop();
      setPhase("blocked");
    }
  };

  const recording = phase === "recording";
  const label = recording ? "Stop recording" : "Record your voice note";

  return (
    <div className={styles.panel} data-phase={phase} id={id}>
      <header className={styles.head}>
        <span className={styles.status}>
          <i aria-hidden="true" />
          {statusCopy[phase]}
        </span>
        <b className={styles.timer}>{clock(seconds)}</b>
      </header>

      {recording ? (
        <div className={styles.visual}>
          <LiveWaveform stream={liveStream} />
        </div>
      ) : null}

      <div className={styles.stage}>
        <button
          aria-label={label}
          className={styles.record}
          disabled={phase === "requesting"}
          onClick={start}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        <strong>
          {phase === "ready"
            ? "Your note is ready to send"
            : recording
              ? "Tap when you're done"
              : phase === "blocked"
                ? "We couldn't reach your microphone"
                : "Tap to start your voice note"}
        </strong>
        <small>
          {phase === "blocked"
            ? "Allow microphone access, or tell us in writing instead."
            : "Speak for a minute or two. Up to three minutes."}
        </small>
      </div>

      {embedded && phase !== "ready" ? null : (
        <div className={styles.readout}>
          {embedded ? null : (
            <>
              <span>What to cover</span>
              <p>
                Where the work gets stuck, who is involved, and what good would look like.
                This is source material, not a test.
              </p>
            </>
          )}
          {phase === "ready" ? (
            <p className={styles.captured} role="status">
              Captured {clock(seconds)}
              {size > 0 ? ` · ${Math.max(1, Math.round(size / 1024))} KB` : ""}
            </p>
          ) : null}
        </div>
      )}

      {embedded ? null : (
        <div className={styles.actions}>
          <button className={styles.send} disabled={phase !== "ready"} type="button">
            Send this note <span aria-hidden="true">→</span>
          </button>
          <small>No account needed to start. You see the scope and the price before you pay.</small>
        </div>
      )}
    </div>
  );
}
