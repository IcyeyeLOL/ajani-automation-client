"use client";

import { useEffect, useRef } from "react";
import styles from "./live-waveform.module.css";

/**
 * The real thing: bars driven by the actual microphone stream while recording,
 * so the panel reacts to the visitor's voice rather than looping a fake.
 */
export function LiveWaveform({ stream }: { stream: MediaStream | null }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !stream) return;

    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const context = new AudioCtx();
    const analyser = context.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    context.createMediaStreamSource(stream).connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const ctx = node.getContext("2d");
    let frame = 0;

    const draw = () => {
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

      analyser.getByteFrequencyData(data);
      const bars = 28;
      const gap = 4;
      const barWidth = (width - gap * (bars - 1)) / bars;
      const mid = height / 2;

      ctx.fillStyle = "#bd9670";
      for (let i = 0; i < bars; i += 1) {
        const value = data[Math.floor((i / bars) * data.length)] / 255;
        const bar = Math.max(3, value * height * 0.92);
        const x = i * (barWidth + gap);
        const radius = Math.min(barWidth / 2, 2);
        ctx.beginPath();
        ctx.roundRect(x, mid - bar / 2, barWidth, bar, radius);
        ctx.fill();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(frame);
      context.close().catch(() => {});
    };
  }, [stream]);

  return <canvas aria-hidden="true" className={styles.canvas} ref={canvas} />;
}
