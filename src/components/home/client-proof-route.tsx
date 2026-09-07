"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import styles from "./client-proof-route.module.css";

const ENABLE_REAL_CLIENT_PROOF_MOTION = true;

const steps = [
  {
    number: "01",
    label: "After hours",
    detail: "A patient calls while the front desk is closed.",
    visual: "call",
    delay: ".28s",
  },
  {
    number: "02",
    label: "On the call",
    detail: "The reason and relevant details are captured.",
    visual: "capture",
    delay: "1.05s",
  },
  {
    number: "03",
    label: "In the system",
    detail: "The request arrives as structured context.",
    visual: "structured",
    delay: "1.82s",
  },
  {
    number: "04",
    label: "Human handoff",
    detail: "Urgent cases reach the practice with the conversation attached.",
    visual: "handoff",
    delay: "2.59s",
  },
] as const;

type ClientProofRouteProps = { className?: string };

export function ClientProofRoute({ className }: ClientProofRouteProps) {
  if (!ENABLE_REAL_CLIENT_PROOF_MOTION) {
    return <LegacyClientProofRoute className={className} />;
  }

  return <AnimatedClientProofRoute className={className} />;
}

function AnimatedClientProofRoute({ className }: ClientProofRouteProps) {
  const route = useRef<HTMLElement>(null);
  const [hasEntered, setHasEntered] = useState(false);
  const [environmentPaused, setEnvironmentPaused] = useState(true);

  useEffect(() => {
    const element = route.current;
    if (!element) return;

    let inView = false;
    let frame: number | undefined;

    const syncEnvironmentPause = () => {
      setEnvironmentPaused(document.hidden || !inView);
    };

    document.addEventListener("visibilitychange", syncEnvironmentPause);

    if (typeof IntersectionObserver !== "function") {
      frame = requestAnimationFrame(() => {
        inView = true;
        setHasEntered(true);
        setEnvironmentPaused(document.hidden);
      });

      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        document.removeEventListener("visibilitychange", syncEnvironmentPause);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) setHasEntered(true);
        syncEnvironmentPause();
      },
      { threshold: 0.22 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncEnvironmentPause);
    };
  }, []);

  return (
    <aside
      aria-labelledby="real-client-system-title real-client-system-context"
      className={[className, styles.motionRoute].filter(Boolean).join(" ")}
      data-client-proof-active={String(hasEntered)}
      data-client-proof-motion="true"
      data-client-proof-paused={String(environmentPaused)}
      data-testid="client-proof-route"
      ref={route}
    >
      <header>
        <span id="real-client-system-title"><i aria-hidden="true" /> Real client system</span>
        <em id="real-client-system-context">After-hours patient calls</em>
      </header>

      <ol>
        {steps.map((step) => (
          <li
            data-client-proof-stage={step.number}
            key={step.number}
            style={{ "--case-delay": step.delay } as CSSProperties}
          >
            <b>{step.number}</b>
            <span><small>{step.label}</small>{step.detail}</span>
            <StepVisual kind={step.visual} />
          </li>
        ))}
      </ol>

      <footer data-client-proof-result="true">
        <i aria-hidden="true" /> A useful response without automating judgement.
      </footer>
    </aside>
  );
}

function StepVisual({ kind }: { kind: (typeof steps)[number]["visual"] }) {
  if (kind === "call") {
    return (
      <div aria-hidden="true" className={`${styles.stepVisual} ${styles.waveform}`}>
        {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
      </div>
    );
  }

  if (kind === "capture") {
    return (
      <div aria-hidden="true" className={`${styles.stepVisual} ${styles.capture}`}>
        <i /><i /><i />
      </div>
    );
  }

  if (kind === "structured") {
    return (
      <div aria-hidden="true" className={`${styles.stepVisual} ${styles.structured}`}>
        <span>Reason</span><span>Details</span>
      </div>
    );
  }

  return (
    <div aria-hidden="true" className={`${styles.stepVisual} ${styles.handoff}`}>
      <span className={styles.handoffPaper}><i /><i /></span>
      <span className={styles.humanBoundary} />
      <span className={styles.human}><i /></span>
    </div>
  );
}

function LegacyClientProofRoute({ className }: ClientProofRouteProps) {
  return (
    <aside className={className}>
      <header>
        <span><i aria-hidden="true" /> Real client system</span>
        <em>After-hours patient calls</em>
      </header>
      <ol>
        {steps.map((step) => (
          <li key={step.number}>
            <b>{step.number}</b>
            <span><small>{step.label}</small>{step.detail}</span>
          </li>
        ))}
      </ol>
      <footer><i aria-hidden="true" /> A useful response without automating judgement.</footer>
    </aside>
  );
}
