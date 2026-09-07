"use client";

import { useEffect, useRef, useState } from "react";
import { getReducedMotionPreference, subscribeToMotionPreference } from "@/lib/motion/preference";
import { RecordNoteAction } from "@/components/record-note-action";
import styles from "./mobile-demo-theatre.module.css";

const STEP_DURATION = 3_000;
const AUTO_HOLD_DURATION = 2_200;
type PlaybackMode = "idle" | "playing" | "paused" | "complete";
type NodeKind = "trigger" | "intelligence" | "action" | "handoff";
type MobileScenario = {
  id: string;
  label: string;
  subtitle: string;
  metric: string;
  metricLabel: string;
  summary: string;
  outcome: string;
  nodes: Array<{ label: string; detail: string; kind: NodeKind }>;
  events: Array<{ timestamp: string; label: string; detail: string; artifactLabel: string; artifactValue: string; artifactMeta: string }>;
};

type SystemProfile = {
  channel: string;
  systems: [string, string, string, string];
};

const phaseLabels: Record<NodeKind, string> = {
  trigger: "What arrived",
  intelligence: "What Ajani decided",
  action: "What was sent",
  handoff: "Team handoff",
};

const systemProfiles: Record<string, SystemProfile> = {
  "after-hours-leads": {
    channel: "Lead response network",
    systems: ["Website inbox", "Ajani triage", "Messaging", "Owner CRM"],
  },
  "client-intake": {
    channel: "Client delivery network",
    systems: ["Intake sources", "Ajani analysis", "Brief builder", "Team workspace"],
  },
  "returning-clients": {
    channel: "Relationship network",
    systems: ["Client activity", "Ajani context", "Messaging", "Owner queue"],
  },
};

function ControlIcon({ name }: { name: "back" | "play" | "pause" | "next" | "restart" | "arrow" }) {
  if (name === "play") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 8 6-8 6V4Z" /></svg>;
  if (name === "pause") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 4v12M13 4v12" /></svg>;
  if (name === "back") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m13 5-6 5 6 5" /></svg>;
  if (name === "next") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 5 6 5-6 5" /></svg>;
  if (name === "arrow") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h12M12 6l4 4-4 4" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15 9a5.5 5.5 0 1 1-1.6-3.9" /><path d="M14 2.8v3.6h-3.6" /></svg>;
}

function SystemIcon({ kind }: { kind: NodeKind }) {
  if (kind === "trigger") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16v12H4z" /><path d="m4 8 8 6 8-6" /></svg>;
  if (kind === "intelligence") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 7 4v10l-7 4-7-4V7l7-4Z" /><path d="M9 12h6M12 9v6" /></svg>;
  if (kind === "action") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h14" /><path d="m13 7 5 5-5 5" /><path d="M4 6v12" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.8-3.7 2.6-5.5 5.5-5.5s4.7 1.8 5.5 5.5M16 10h5M18.5 7.5v5" /></svg>;
}

export function MobileDemoTheatre({ scenarios }: { scenarios: MobileScenario[] }) {
  const [view, setView] = useState<"chooser" | "player">("chooser");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [mode, setMode] = useState<PlaybackMode>("idle");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [autoCycle, setAutoCycle] = useState(false);
  const [environmentPaused, setEnvironmentPaused] = useState(false);
  const autoCycleRef = useRef(false);
  const focusPlayerOnOpen = useRef(false);
  const playerRef = useRef<HTMLElement>(null);
  const playerHeading = useRef<HTMLHeadingElement>(null);
  const chooserButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const scenario = scenarios[scenarioIndex];
  const totalSteps = scenario.nodes.length;
  const stepIndex = Math.max(0, Math.min(activeStep - 1, totalSteps - 1));
  const node = scenario.nodes[stepIndex];
  const event = scenario.events[stepIndex];
  const profile = systemProfiles[scenario.id] ?? {
    channel: "Connected workflow",
    systems: [scenario.nodes[0]?.label ?? "Input", scenario.nodes[1]?.label ?? "Decision", scenario.nodes[2]?.label ?? "Action", scenario.nodes[3]?.label ?? "Handoff"],
  };
  const routePosition = activeStep === 0 ? 0 : ((activeStep - 1) / Math.max(totalSteps - 1, 1)) * 100;
  const packetPosition = Math.max(activeStep - 1, 0) * (100 / Math.max(totalSteps - 1, 1));

  useEffect(() => {
    autoCycleRef.current = autoCycle;
  }, [autoCycle]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 768px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      const reduce = getReducedMotionPreference();
      autoCycleRef.current = !reduce;
      setAutoCycle(!reduce);
      setScenarioIndex(0);
      setActiveStep(1);
      setMode(reduce ? "paused" : "playing");
      setView("player");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return subscribeToMotionPreference((shouldReduceMotion) => {
      setReducedMotion(shouldReduceMotion);
      if (shouldReduceMotion) {
        autoCycleRef.current = false;
        setAutoCycle(false);
        setMode((current) => current === "playing" ? "paused" : current);
      }
    });
  }, []);

  useEffect(() => {
    if (environmentPaused || mode !== "playing" || (reducedMotion && !autoCycle)) return;
    const timer = window.setTimeout(() => {
      if (activeStep >= totalSteps) {
        setMode("complete");
        return;
      }
      setActiveStep((step) => step + 1);
    }, STEP_DURATION);
    return () => window.clearTimeout(timer);
  }, [activeStep, autoCycle, environmentPaused, mode, reducedMotion, totalSteps]);

  useEffect(() => {
    if (environmentPaused || !autoCycle || mode !== "complete") return;
    const timer = window.setTimeout(() => {
      setScenarioIndex((index) => (index + 1) % scenarios.length);
      setActiveStep(1);
      setMode("playing");
    }, AUTO_HOLD_DURATION);
    return () => window.clearTimeout(timer);
  }, [autoCycle, environmentPaused, mode, scenarios.length]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 768px)");
    let inView = true;
    const syncEnvironment = () => {
      const unavailable = document.hidden || !mobileViewport.matches;
      setEnvironmentPaused(unavailable || !inView);
      if (unavailable) {
        // Stop the between-scenario hold too: a completed route must not start
        // another workflow after the user backgrounds or leaves mobile view.
        autoCycleRef.current = false;
        setAutoCycle(false);
        setMode((current) => current === "playing" ? "paused" : current);
      }
    };
    const observer = typeof IntersectionObserver === "function" && playerRef.current
      ? new IntersectionObserver(([entry]) => {
          inView = entry.isIntersecting;
          syncEnvironment();
        }, { threshold: 0 })
      : null;
    if (observer && playerRef.current) observer.observe(playerRef.current);
    syncEnvironment();
    document.addEventListener("visibilitychange", syncEnvironment);
    mobileViewport.addEventListener("change", syncEnvironment);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncEnvironment);
      mobileViewport.removeEventListener("change", syncEnvironment);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "player" || !focusPlayerOnOpen.current) return;
    focusPlayerOnOpen.current = false;
    const frame = window.requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      playerHeading.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const reset = () => {
    setAutoCycle(false);
    setActiveStep(0);
    setMode("idle");
  };

  const chooseScenario = (index: number) => {
    const shouldReduceMotion = getReducedMotionPreference();
    setAutoCycle(false);
    setScenarioIndex(index);
    setActiveStep(1);
    setMode(shouldReduceMotion ? "paused" : "playing");
    focusPlayerOnOpen.current = true;
    setView("player");
  };

  const runFullShowcase = () => {
    autoCycleRef.current = true;
    setAutoCycle(true);
    setScenarioIndex(0);
    setActiveStep(1);
    setMode("playing");
    focusPlayerOnOpen.current = true;
    setView("player");
  };

  const changeScenario = () => {
    setAutoCycle(false);
    reset();
    setView("chooser");
    window.setTimeout(() => chooserButtons.current[scenarioIndex]?.focus(), 0);
  };

  const runOrPause = () => {
    if (reducedMotion && !autoCycle) {
      if (mode === "complete") {
        setActiveStep(1);
        setMode("paused");
      } else if (activeStep === 0) {
        setActiveStep(1);
        setMode("paused");
      } else if (activeStep < totalSteps) {
        setActiveStep((step) => step + 1);
        setMode("paused");
      } else {
        setMode("complete");
      }
      return;
    }

    if (mode === "playing") {
      setMode("paused");
      return;
    }
    if (mode === "complete") setActiveStep(1);
    else if (activeStep === 0) setActiveStep(1);
    setMode("playing");
  };

  const previous = () => {
    setAutoCycle(false);
    if (mode === "complete") {
      setActiveStep(totalSteps - 1);
      setMode("paused");
      return;
    }
    const nextStep = Math.max(activeStep - 1, 0);
    setActiveStep(nextStep);
    setMode(nextStep === 0 ? "idle" : "paused");
  };

  const next = () => {
    setAutoCycle(false);
    if (activeStep >= totalSteps) {
      setMode("complete");
      return;
    }
    setActiveStep((step) => step + 1);
    setMode("paused");
  };

  const inspectStep = (step: number) => {
    setAutoCycle(false);
    setActiveStep(step);
    setMode("paused");
  };

  const modeLabel = autoCycle && mode === "playing" ? "Auto running" : mode === "idle" ? "Ready" : mode === "playing" ? "Running" : mode === "paused" ? "Paused" : "Complete";
  const primaryLabel = reducedMotion && !autoCycle
    ? mode === "complete" ? "Run again" : activeStep === 0 ? "Show first step" : activeStep === totalSteps ? "Finish demo" : "Next step"
    : mode === "playing" ? "Pause" : mode === "complete" ? "Run again" : activeStep === 0 ? "Run demo" : "Continue";
  const statusText = mode === "idle"
    ? `${scenario.label} is ready.`
    : mode === "complete"
      ? `${scenario.label} complete. ${scenario.outcome}`
      : `${modeLabel}. Step ${activeStep} of ${totalSteps}: ${node.label}. ${event.artifactLabel}.`;

  if (view === "chooser") {
    return <div className={styles.mobileOnly}>
      <section aria-labelledby="mobile-demo-heading" className={styles.chooser}>
        <p className={styles.eyebrow}>Interactive demo</p>
        <h2 id="mobile-demo-heading">Choose a workflow to watch.</h2>
        <p className={styles.chooserIntro}>Pick a workflow and watch the signal move through every connected system—live.</p>
        <div aria-label="Automation scenarios" className={styles.scenarioList}>
          {scenarios.map((item, index) => <button className={styles.scenarioChoice} key={item.id} onClick={() => chooseScenario(index)} ref={(element) => { chooserButtons.current[index] = element; }} type="button">
            <span className={styles.choiceNumber}>0{index + 1}</span>
            <span className={styles.choiceCopy}><strong>{item.label}</strong><small>{item.subtitle}</small></span>
            <span className={styles.choiceMetric}><b>{item.metric}</b><small>{item.metricLabel}</small></span>
            <ControlIcon name="arrow" />
          </button>)}
        </div>
        <button className={styles.autoShowcase} onClick={runFullShowcase} type="button">
          <span><ControlIcon name="play" /><strong>Run the full showcase</strong></span>
          <small>Hands-free · all three workflows</small>
          <ControlIcon name="arrow" />
        </button>
      </section>
    </div>;
  }

  return <div className={styles.mobileOnly}>
    <section aria-labelledby="mobile-player-heading" className={styles.player} data-auto={autoCycle ? "true" : undefined} data-mode={environmentPaused && mode === "playing" ? "paused" : mode} ref={playerRef}>
      <header className={styles.playerHeader}>
        <button className={styles.changeButton} onClick={changeScenario} type="button"><ControlIcon name="back" /> Change</button>
        <div>
          <span className={styles.state}><i /> {modeLabel}</span>
          <h2 id="mobile-player-heading" ref={playerHeading} tabIndex={-1}>{scenario.label}</h2>
        </div>
        <button aria-label="Restart automation demo" className={styles.restartButton} disabled={mode === "idle"} onClick={reset} type="button"><ControlIcon name="restart" /><span>Restart</span></button>
      </header>

      <div className={styles.systemShowcase}>
        <section aria-label={`${scenario.label} connected systems`} className={styles.workflowMap}>
          <div className={styles.mapHeader}>
            <div><span className={styles.networkDot} /> {profile.channel}</div>
            <span>{mode === "complete" ? "Route delivered" : mode === "idle" ? "Standing by" : `${activeStep}/${totalSteps}`}</span>
          </div>

          <div aria-hidden="true" className={styles.routeTrack}>
            <i className={styles.routeFill} style={{ width: `${mode === "complete" ? 100 : routePosition}%` }} />
            {activeStep > 0 && activeStep < totalSteps && mode !== "complete" && <span className={styles.packetLane} key={`${scenario.id}-${activeStep}`} style={{ left: `${packetPosition}%` }}><i className={styles.signalPacket} data-testid="signal-packet"><b /><b /><b /></i></span>}
          </div>

          <ol className={styles.systemNodes}>
            {scenario.nodes.map((stepNode, index) => {
              const step = index + 1;
              const state = mode === "complete" || activeStep > step ? "complete" : activeStep === step ? "active" : "pending";
              return <li data-state={state} key={stepNode.label}>
                <button aria-current={activeStep === step && mode !== "complete" ? "step" : undefined} aria-label={`Step ${step} of ${totalSteps}: ${stepNode.label} in ${profile.systems[index]}`} onClick={() => inspectStep(step)} type="button">
                  <span className={styles.systemIcon}><SystemIcon kind={stepNode.kind} /><i /></span>
                  <small>{profile.systems[index]}</small>
                  <strong>{stepNode.label}</strong>
                </button>
              </li>;
            })}
          </ol>

          <div aria-label={`${activeStep} of ${totalSteps} systems processed`} aria-valuemax={totalSteps} aria-valuemin={0} aria-valuenow={activeStep} className={styles.stepTimer} key={`${scenario.id}-${activeStep}`} role="progressbar"><i /></div>
        </section>

        <section aria-label="Live workflow exchange" className={styles.liveExchange}>
          {mode === "idle" && <div className={styles.standbyPanel}>
            <span>Network ready</span>
            <strong>Run the route to send a live signal through all four systems.</strong>
            <p>{scenario.summary}</p>
          </div>}

          {mode !== "idle" && mode !== "complete" && <div className={styles.exchangePayload} key={`${scenario.id}-payload-${activeStep}`}>
            <div className={styles.exchangeMeta}>
              <span>{phaseLabels[node.kind]}</span>
              <span>{profile.systems[stepIndex]} <i aria-hidden="true">→</i> {profile.systems[Math.min(stepIndex + 1, totalSteps - 1)]}</span>
              <time>{event.timestamp}</time>
            </div>
            <div className={styles.exchangeBody}>
              <span>{event.label}</span>
              <strong>{event.artifactValue}</strong>
              <p>{event.detail}</p>
              <small>{event.artifactLabel} · {event.artifactMeta}</small>
            </div>
          </div>}

          {mode === "complete" && <div className={styles.resultPanel}>
            <div><span aria-hidden="true">✓</span><p><small>Route complete</small><strong>{scenario.metric}</strong></p></div>
            <h3>{scenario.outcome}</h3>
            <RecordNoteAction className={styles.completionCta}>Use this route for my work <span aria-hidden="true">→</span></RecordNoteAction>
            {autoCycle && <p className={styles.autoAdvance}><i /> Next workflow starts automatically</p>}
          </div>}

          <ol aria-label="Live automation activity" className={styles.activityFeed}>
            {scenario.events.map((item, index) => {
              const step = index + 1;
              const state = mode === "complete" || activeStep > step ? "complete" : activeStep === step ? "active" : "pending";
              return <li data-state={state} key={item.label}><i /><time>{item.timestamp}</time><span>{item.label}</span><b>{state === "complete" ? "✓" : state === "active" ? mode === "playing" ? "LIVE" : "PAUSED" : "WAIT"}</b></li>;
            })}
          </ol>
        </section>
      </div>

      <footer className={styles.controls}>
        <button aria-label="Previous automation step" disabled={activeStep === 0} onClick={previous} type="button"><ControlIcon name="back" /><span>Previous</span></button>
        <button aria-label={primaryLabel} className={styles.primaryControl} onClick={runOrPause} type="button"><ControlIcon name={mode === "playing" ? "pause" : "play"} /><span>{primaryLabel}</span></button>
        <button aria-label="Next automation step" disabled={mode === "complete"} onClick={next} type="button"><span>Next</span><ControlIcon name="next" /></button>
      </footer>
      <p aria-live="polite" className={styles.srOnly} role="status">{statusText}{reducedMotion && !autoCycle ? " Reduced motion is on; playback is manual." : ""}{autoCycle ? " Full showcase mode is on." : ""}</p>
    </section>
  </div>;
}
