"use client";

import { type CSSProperties, type ElementType, type ReactNode, useEffect, useRef, useState } from "react";
import { getReducedMotionPreference, subscribeToMotionPreference } from "@/lib/motion/preference";
import styles from "./reveal.module.css";

const pendingReveals = new Map<HTMLElement, () => void>();
let revealObserver: IntersectionObserver | null = null;
let revealScrollFrame = 0;
let revealScrollListening = false;

function removeReveal(element: HTMLElement) {
  pendingReveals.delete(element);
  revealObserver?.unobserve(element);

  if (pendingReveals.size === 0) {
    revealObserver?.disconnect();
    revealObserver = null;
    window.removeEventListener("scroll", scheduleSkippedRevealCheck);
    revealScrollListening = false;
    if (revealScrollFrame) cancelAnimationFrame(revealScrollFrame);
    revealScrollFrame = 0;
  }
}

function showReveal(element: HTMLElement) {
  const show = pendingReveals.get(element);
  if (!show) return;
  removeReveal(element);
  show();
}

function checkSkippedReveals() {
  revealScrollFrame = 0;
  for (const element of pendingReveals.keys()) {
    if (element.getBoundingClientRect().top < window.innerHeight) showReveal(element);
  }
}

function scheduleSkippedRevealCheck() {
  if (!revealScrollFrame) revealScrollFrame = requestAnimationFrame(checkSkippedReveals);
}

function observeReveal(element: HTMLElement, show: () => void) {
  pendingReveals.set(element, show);

  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showReveal(entry.target as HTMLElement);
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
  );

  revealObserver.observe(element);
  if (!revealScrollListening) {
    window.addEventListener("scroll", scheduleSkippedRevealCheck, { passive: true });
    revealScrollListening = true;
  }

  return () => removeReveal(element);
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger, in ms. Use small steps — 70 to 110 reads as one gesture. */
  delay?: number;
  as?: ElementType;
  /** Merged with the reveal's own delay variable, for per-instance tokens. */
  style?: CSSProperties;
};

/**
 * Fades and lifts an element the first time it enters the viewport, then stops
 * observing.
 *
 * The shared motion policy and CSS both honor reduced motion. Server-rendered
 * content stays visible if JavaScript never starts, and missing observation
 * support resolves to readable content rather than an armed hidden reveal.
 */
export function Reveal({ children, className, delay = 0, as, style }: RevealProps) {
  const node = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<"server" | "armed" | "shown">("server");
  const Tag = (as ?? "div") as ElementType;

  useEffect(() => {
    const element = node.current;
    if (!element) return;

    let cancelled = false;
    let cleanup = () => {};
    let layoutFrame = 0;

    const armWhenLaidOut = () => {
      if (cancelled) return;

      // Next can hydrate this client island while its streamed segment is still
      // in a hidden template. In that moment every rectangle is 0,0 and would
      // look falsely above the fold. Wait until the browser has placed it in
      // the real document before deciding whether it should reveal on scroll.
      if (element.getClientRects().length === 0) {
        layoutFrame = requestAnimationFrame(armWhenLaidOut);
        return;
      }

      const reducedMotion = getReducedMotionPreference();
      const initialRect = element.getBoundingClientRect();

      // The server state is deliberately visible. Above-the-fold content stays
      // visible during hydration, and a deep-linked section is never hidden just
      // because it was already in view when this effect ran.
      if (
        reducedMotion
        || initialRect.top < window.innerHeight * 0.92
        || typeof IntersectionObserver !== "function"
      ) {
        setPhase("shown");
        return;
      }

      setPhase("armed");
      // One shared observer and one passive scroll fallback cover every reveal.
      // The fallback catches an anchor/End-key jump from below the viewport to
      // above it, where the intersection ratio can remain zero throughout.
      cleanup = observeReveal(element, () => setPhase("shown"));
    };

    layoutFrame = requestAnimationFrame(armWhenLaidOut);
    const unsubscribe = subscribeToMotionPreference((reduced) => {
      if (!reduced) return;
      cancelAnimationFrame(layoutFrame);
      cleanup();
      // A preference change must not leave an already armed reveal hidden.
      layoutFrame = requestAnimationFrame(() => { if (!cancelled) setPhase("shown"); });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(layoutFrame);
      cleanup();
      unsubscribe();
    };
  }, []);

  return (
    <Tag
      className={[styles.reveal, phase === "armed" ? styles.armed : "", phase === "shown" ? styles.shown : "", className]
        .filter(Boolean)
        .join(" ")}
      ref={node}
      style={{ ...style, "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
