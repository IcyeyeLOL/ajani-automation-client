"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { subscribeToMotionPreference } from "@/lib/motion/preference";
import { Reveal } from "./reveal";
import styles from "./how-it-works-timeline.module.css";

const ENABLE_HOW_IT_WORKS_MOTION = true;
const STEP_DELAYS = [".15s", "1s", "1.85s", "3.25s"] as const;
const LINE_DELAYS = [".35s", "1.2s", "2.75s", "0s"] as const;
const MARKER_DURATIONS = [".72s", ".72s", "1.2s", ".72s"] as const;

type HowItWorksStage = Readonly<{
  detail: string;
  title: string;
  when: string;
}>;

type HowItWorksTimelineProps = {
  labelledBy: string;
  railClassName: string;
  stages: readonly HowItWorksStage[];
  stepClassName: string;
  stepIndexClassName: string;
  stepWhenClassName: string;
};

export function HowItWorksTimeline(props: HowItWorksTimelineProps) {
  if (!ENABLE_HOW_IT_WORKS_MOTION) {
    return <LegacyHowItWorksTimeline {...props} />;
  }

  return <AnimatedHowItWorksTimeline {...props} />;
}

function AnimatedHowItWorksTimeline({
  labelledBy,
  railClassName,
  stages,
  stepClassName,
  stepIndexClassName,
  stepWhenClassName,
}: HowItWorksTimelineProps) {
  const timeline = useRef<HTMLOListElement>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [documentPaused, setDocumentPaused] = useState(true);
  const [enteredSteps, setEnteredSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [hasEntered, setHasEntered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [timelineInView, setTimelineInView] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [wideComplete, setWideComplete] = useState(false);

  useEffect(() => {
    const element = timeline.current;
    if (!element) return;

    let frame: number | undefined;
    const compactMedia = window.matchMedia("(max-width: 620px)");
    const stepElements = Array.from(element.querySelectorAll<HTMLElement>("[data-process-step]"));

    const syncDocumentPause = () => setDocumentPaused(document.hidden);
    const syncCompact = () => setCompact(compactMedia.matches);
    const unsubscribeMotion = subscribeToMotionPreference(setReducedMotion);

    syncCompact();
    syncDocumentPause();
    document.addEventListener("visibilitychange", syncDocumentPause);
    compactMedia.addEventListener("change", syncCompact);

    if (typeof IntersectionObserver !== "function") {
      frame = requestAnimationFrame(() => {
        setHasEntered(true);
        setTimelineInView(true);
        setEnteredSteps(new Set(stepElements.map((_, index) => index)));
        setVisibleSteps(new Set(stepElements.map((_, index) => index)));
      });

      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        document.removeEventListener("visibilitychange", syncDocumentPause);
        compactMedia.removeEventListener("change", syncCompact);
        unsubscribeMotion();
      };
    }

    const timelineObserver = new IntersectionObserver(
      ([entry]) => {
        setTimelineInView(entry.isIntersecting);
        if (entry.isIntersecting) setHasEntered(true);
      },
      { threshold: 0.3 },
    );

    const stepObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.processIndex);
          if (!Number.isInteger(index)) continue;

          setVisibleSteps((current) => updateIndexSet(current, index, entry.isIntersecting));
          if (entry.isIntersecting && compactMedia.matches) {
            setEnteredSteps((current) => updateIndexSet(current, index, true));
          }
        }
      },
      { threshold: 0.35, rootMargin: "0px 0px -8% 0px" },
    );

    timelineObserver.observe(element);
    for (const step of stepElements) stepObserver.observe(step);

    return () => {
      timelineObserver.disconnect();
      stepObserver.disconnect();
      document.removeEventListener("visibilitychange", syncDocumentPause);
      compactMedia.removeEventListener("change", syncCompact);
      unsubscribeMotion();
    };
  }, []);

  const motionComplete = reducedMotion
    || (compact ? completedSteps.size === stages.length : wideComplete);
  const motionStarted = compact ? enteredSteps.size > 0 : hasEntered;
  const timelineMotionActive = !reducedMotion && motionStarted;
  const timelinePaused = !reducedMotion && (documentPaused || (!compact && !timelineInView));

  return (
    <ol
      aria-labelledby={labelledBy}
      className={`${railClassName} ${styles.timeline}`}
      data-process-active={String(timelineMotionActive)}
      data-process-complete={String(motionComplete)}
      data-process-duration={compact ? ".65s-per-step" : "4.15s"}
      data-process-iteration-count="1"
      data-process-layout={compact ? "compact" : "wide"}
      data-process-motion={reducedMotion ? undefined : "true"}
      data-process-paused={String(timelinePaused)}
      data-process-phase={motionComplete ? "complete" : motionStarted ? "running" : "idle"}
      data-testid="how-it-works-timeline"
      ref={timeline}
    >
      {stages.map((stage, index) => {
        const number = String(index + 1).padStart(2, "0");
        const isLastStep = index === stages.length - 1;
        const delay = STEP_DELAYS[index] ?? `${0.25 + index * 0.9}s`;
        const lineDelay = LINE_DELAYS[index] ?? "0s";
        const markerDuration = MARKER_DURATIONS[index] ?? ".72s";
        const stepActive = !reducedMotion && (compact ? enteredSteps.has(index) : hasEntered);
        const stepPaused = !reducedMotion && (documentPaused || (compact && !visibleSteps.has(index)));

        return (
          <li
            className={`${stepClassName} ${styles.motionStep}`}
            data-process-active={String(stepActive)}
            data-process-complete={String(reducedMotion || (compact ? completedSteps.has(index) : wideComplete))}
            data-process-current={String(activeStep === index)}
            data-process-index={index}
            data-process-paused={String(stepPaused)}
            data-process-step={number}
            key={stage.title}
            style={{
              "--process-delay": delay,
              "--process-line-delay": lineDelay,
              "--process-marker-duration": markerDuration,
            } as CSSProperties}
          >
            <div className={stepIndexClassName}>
              <span
                data-process-marker
                onAnimationEnd={() => {
                  setActiveStep((current) => current === index ? null : current);
                  if (compact && isLastStep) {
                    setCompletedSteps((current) => updateIndexSet(current, index, true));
                  }
                }}
                onAnimationStart={() => setActiveStep(index)}
              >
                {number}
              </span>
              <i aria-hidden="true" data-process-line>
                <span
                  className={styles.progress}
                  data-process-progress
                  onAnimationEnd={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (compact) {
                      setCompletedSteps((current) => updateIndexSet(current, index, true));
                    } else if (index === 2) {
                      setWideComplete(true);
                    }
                  }}
                >
                  <span className={styles.progressFill} data-process-fill />
                </span>
              </i>
            </div>
            <p className={stepWhenClassName} data-process-when>{stage.when}</p>
            <h3>{stage.title}</h3>
            <p>{stage.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

function updateIndexSet(current: ReadonlySet<number>, index: number, include: boolean) {
  if (current.has(index) === include) return current;
  const next = new Set(current);
  if (include) next.add(index);
  else next.delete(index);
  return next;
}

function LegacyHowItWorksTimeline({
  labelledBy,
  railClassName,
  stages,
  stepClassName,
  stepIndexClassName,
  stepWhenClassName,
}: HowItWorksTimelineProps) {
  return (
    <ol aria-labelledby={labelledBy} className={`${railClassName} ${styles.timeline}`}>
      {stages.map((stage, index) => (
        <Reveal as="li" className={stepClassName} delay={index * 85} key={stage.title}>
          <div className={stepIndexClassName}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <i aria-hidden="true" />
          </div>
          <p className={stepWhenClassName}>{stage.when}</p>
          <h3>{stage.title}</h3>
          <p>{stage.detail}</p>
        </Reveal>
      ))}
    </ol>
  );
}
