"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./inline-automation.module.css";

const STEP_MS = 2600;

const steps = [
  {
    label: "Lead signal",
    detail: "A message reaches the intake channel after hours.",
    time: "00:00",
    event: "Inquiry captured",
    artifact: "“Hi, I need help with an appointment tonight.”",
    meta: "Website inbox · New lead",
  },
  {
    label: "Intent scan",
    detail: "Ajani reads urgency, service, and timing.",
    time: "00:04",
    event: "Intent mapped",
    artifact: "High intent · Same-day availability",
    meta: "Service request · Time sensitive",
  },
  {
    label: "Personal reply",
    detail: "A useful answer goes out with the next step attached.",
    time: "00:07",
    event: "Reply sent",
    artifact: "“We can help — here are tonight’s open times.”",
    meta: "Personalised response · Delivered",
  },
  {
    label: "Team handoff",
    detail: "The owner gets the thread and the action to take.",
    time: "00:11",
    event: "Opportunity routed",
    artifact: "Mia notified · Follow up within 4 minutes",
    meta: "Priority lead · Handoff complete",
  },
];

export function InlineAutomation() {
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const region = useRef<HTMLDivElement | null>(null);

  // Only run while the band is actually on screen, and stop entirely when the
  // visitor prefers reduced motion — they can still step through by hand.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(reduced.matches);
    apply();
    reduced.addEventListener("change", apply);
    return () => reduced.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const node = region.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const playing = inView && !reducedMotion && !manuallyPaused;
    if (!playing) return;
    const timer = window.setInterval(() => {
      setActive((value) => (value + 1) % steps.length);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [inView, manuallyPaused, reducedMotion]);

  const current = steps[active];

  return (
    <div className={styles.theatre} ref={region}>
      <div className={styles.map}>
        <div className={styles.mapHead}>
          <span>System map</span>
          <span>After-hours lead handoff</span>
        </div>
        <ol className={styles.nodes}>
          {steps.map((step, index) => (
            <li key={step.label}>
              <button
                aria-current={index === active ? "step" : undefined}
                className={styles.node}
                data-state={index < active ? "done" : index === active ? "active" : "waiting"}
                onClick={() => {
                  setManuallyPaused(true);
                  setActive(index);
                }}
                type="button"
              >
                <span className={styles.num}>0{index + 1}</span>
                <b>{step.label}</b>
                <small>{step.detail}</small>
                <i>{index < active ? "Complete" : index === active ? "In focus" : "Waiting"}</i>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <aside className={styles.output}>
        <div className={styles.outputHead}>
          <span>Live output</span>
          <span>{active === steps.length - 1 ? "Delivered" : "Updating"}</span>
        </div>
        <article className={styles.artifact} key={current.label}>
          <span>{current.event}</span>
          <strong>{current.artifact}</strong>
          <small>{current.meta}</small>
        </article>
        <ol className={styles.ledger} aria-label="Automation event ledger">
          {steps.map((step, index) => (
            <li data-state={index < active ? "done" : index === active ? "active" : "waiting"} key={step.event}>
              <time>{step.time}</time>
              <b>{step.event}</b>
              <i aria-hidden="true">{index < active ? "✓" : index === active ? "●" : "·"}</i>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
