"use client";

import { useEffect, useRef } from "react";

/** Keep the scenario clock aligned with CSS animations when playback pauses. */
export function useDemoTimer(active: boolean, phase: string, duration: number, onElapsed: () => void) {
  const currentPhase = useRef(phase);
  const remaining = useRef(duration);
  const callback = useRef(onElapsed);

  useEffect(() => { callback.current = onElapsed; }, [onElapsed]);

  useEffect(() => {
    if (currentPhase.current !== phase) {
      currentPhase.current = phase;
      remaining.current = duration;
    }
    if (!active) return;

    const started = performance.now();
    const timer = window.setTimeout(() => {
      remaining.current = 0;
      callback.current();
    }, remaining.current);

    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [active, phase, duration]);
}
