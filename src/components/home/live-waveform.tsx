"use client";

import { useEffect, useRef } from "react";
import styles from "./live-waveform.module.css";

const BAR_COUNT = 40;
const HISTORY_LENGTH = Math.ceil(BAR_COUNT / 2);
const BAR_GAP = 4;
const MIN_BAR_HEIGHT = 8;
const SAMPLE_INTERVAL_MS = 48;

/** A centered time-domain waveform driven by the active microphone stream. */
export function LiveWaveform({ stream }: { stream: MediaStream | null }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !stream) return;

    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const context = new AudioCtx();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1_024;
    analyser.smoothingTimeConstant = 0.78;
    context.createMediaStreamSource(stream).connect(analyser);

    const data = new Float32Array(analyser.fftSize);
    const smoothedBars = new Float32Array(BAR_COUNT).fill(MIN_BAR_HEIGHT);
    const levelHistory = new Float32Array(HISTORY_LENGTH);
    const ctx = node.getContext("2d");
    let frame = 0;
    let envelope = 0;
    let lastSampleAt = 0;

    const resumeContext = () => {
      if (context.state === "suspended") void context.resume().catch(() => {});
    };
    resumeContext();
    document.addEventListener("pointerdown", resumeContext, { passive: true });
    document.addEventListener("keydown", resumeContext);

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (!ctx) return;

      const ratio = window.devicePixelRatio || 1;
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (node.width !== width * ratio || node.height !== height * ratio) {
        node.width = width * ratio;
        node.height = height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        analyser.getFloatTimeDomainData(data);
        let energy = 0;
        let peak = 0;
        for (let sample = 0; sample < data.length; sample += 1) {
          const magnitude = Math.abs(data[sample]);
          energy += magnitude * magnitude;
          peak = Math.max(peak, magnitude);
        }

        const rms = Math.sqrt(energy / data.length);
        const activity = Math.max(0, rms - 0.006, peak * 0.28 - 0.006);
        const level = 1 - Math.exp(-Math.min(1, activity * 17) * 2.15);
        const response = level > envelope ? 0.62 : 0.22;
        envelope += (level - envelope) * response;

        levelHistory.copyWithin(1, 0, HISTORY_LENGTH - 1);
        levelHistory[0] = envelope;
        lastSampleAt = now;
      }

      const availableWidth = Math.min(width, 316);
      const barGap = availableWidth < 280 ? 3 : BAR_GAP;
      const barWidth = Math.max(2, Math.min(4, (availableWidth - barGap * (BAR_COUNT - 1)) / BAR_COUNT));
      const waveformWidth = barWidth * BAR_COUNT + barGap * (BAR_COUNT - 1);
      const waveformStart = (width - waveformWidth) / 2;
      const mid = height / 2;
      const maxBarHeight = Math.min(48, height * 0.84);
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const position = (i + 0.5) / BAR_COUNT;
        const centerShape = Math.sin(position * Math.PI);
        const texture = (Math.sin(i * 1.71 + 0.8) + 1) / 2;
        const restingHeight = MIN_BAR_HEIGHT + centerShape * 5 + texture * 2.5;
        const distanceFromCenter = Math.floor(Math.abs(i - (BAR_COUNT - 1) / 2));
        const historicalLevel = levelHistory[Math.min(distanceFromCenter, HISTORY_LENGTH - 1)] ?? 0;
        const organicVariation = 0.93 + texture * 0.07;
        const activityShape = 0.74 + centerShape * 0.26;
        const targetHeight = restingHeight
          + Math.pow(historicalLevel, 0.76) * (maxBarHeight - restingHeight) * organicVariation * activityShape;
        const easing = targetHeight > smoothedBars[i] ? 0.42 : 0.2;
        smoothedBars[i] += (targetHeight - smoothedBars[i]) * easing;

        const barHeight = Math.max(MIN_BAR_HEIGHT, smoothedBars[i]);
        const x = waveformStart + i * (barWidth + barGap);
        const radius = barWidth / 2;
        const gradient = ctx.createLinearGradient(0, mid - barHeight / 2, 0, mid + barHeight / 2);
        gradient.addColorStop(0, "#e3b287");
        gradient.addColorStop(0.52, "#c85b68");
        gradient.addColorStop(1, "#aa082b");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, mid - barHeight / 2, barWidth, barHeight, radius);
        ctx.fill();
      }
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", resumeContext);
      document.removeEventListener("keydown", resumeContext);
      context.close().catch(() => {});
    };
  }, [stream]);

  return <canvas aria-hidden="true" className={styles.canvas} ref={canvas} />;
}
