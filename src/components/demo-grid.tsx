"use client";

import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MobileDemoTheatre } from "@/components/mobile-demo-theatre";
import { RecordNoteAction } from "@/components/record-note-action";
import styles from "./demo-theatre.module.css";

const DEMO_STEP_DURATION = 3_000;

type NodeKind = "trigger" | "intelligence" | "action" | "handoff";
type NodeIconName = "sun" | "intent" | "reply" | "handoff" | "inbox" | "magnify" | "brief" | "alignment" | "spark" | "relationship" | "nudge" | "owner";

type AutomationNode = {
  label: string;
  detail: string;
  kind: NodeKind;
  icon: NodeIconName;
};

type AutomationEvent = {
  timestamp: string;
  label: string;
  detail: string;
  artifactLabel: string;
  artifactValue: string;
  artifactMeta: string;
};

type AutomationScenario = {
  id: string;
  label: string;
  subtitle: string;
  metric: string;
  metricLabel: string;
  summary: string;
  outcome: string;
  nodes: AutomationNode[];
  events: AutomationEvent[];
};

const scenarios: AutomationScenario[] = [
  {
    id: "after-hours-leads",
    label: "After-hours leads",
    subtitle: "Reply while the office is closed",
    metric: "4 min",
    metricLabel: "to a routed lead",
    summary: "A client message becomes a qualified, team-ready opportunity before the next business hour.",
    outcome: "Qualified lead routed to Mia with a same-day follow-up.",
    nodes: [
      { label: "Lead signal", detail: "A new message reaches the intake channel.", kind: "trigger", icon: "sun" },
      { label: "Intent scan", detail: "Ajani identifies urgency, service, and timing.", kind: "intelligence", icon: "intent" },
      { label: "Personal reply", detail: "A useful response goes out with the right next step.", kind: "action", icon: "reply" },
      { label: "Team handoff", detail: "The owner receives a concise opportunity brief.", kind: "handoff", icon: "handoff" },
    ],
    events: [
      { timestamp: "00:00", label: "Inquiry captured", detail: "New lead from the website inbox.", artifactLabel: "INBOUND MESSAGE", artifactValue: "“Hi, I need help with an appointment tonight.”", artifactMeta: "Website inbox · New lead" },
      { timestamp: "00:04", label: "Intent mapped", detail: "Urgent timing and appointment intent detected.", artifactLabel: "INTENT SIGNAL", artifactValue: "High intent · Same-day availability", artifactMeta: "Confidence 94% · Service request" },
      { timestamp: "00:07", label: "Reply composed", detail: "A tailored answer is prepared and sent.", artifactLabel: "REPLY SENT", artifactValue: "“We can help. Here are tonight’s next open times.”", artifactMeta: "Personalized response · Delivered" },
      { timestamp: "00:11", label: "Opportunity routed", detail: "The team receives the context and next action.", artifactLabel: "OWNER ALERT", artifactValue: "Mia notified · Follow up within 4 minutes", artifactMeta: "Priority lead · Handoff complete" },
    ],
  },
  {
    id: "client-intake",
    label: "Client intake",
    subtitle: "Turn context into a working brief",
    metric: "1 brief",
    metricLabel: "ready for the team",
    summary: "Scattered client context is distilled into the information a team needs to act without another round of questions.",
    outcome: "Structured intake brief delivered to the project team.",
    nodes: [
      { label: "Context arrives", detail: "A client shares a mix of notes, goals, and constraints.", kind: "trigger", icon: "inbox" },
      { label: "Gap finder", detail: "Ajani separates clear requirements from open questions.", kind: "intelligence", icon: "magnify" },
      { label: "Brief builder", detail: "The information becomes a consistent working brief.", kind: "action", icon: "brief" },
      { label: "Team aligned", detail: "The right people receive context and a clear next action.", kind: "handoff", icon: "alignment" },
    ],
    events: [
      { timestamp: "00:00", label: "Context received", detail: "Notes, goals, and source files enter intake.", artifactLabel: "CLIENT CONTEXT", artifactValue: "6 notes · 2 source links · 1 stated deadline", artifactMeta: "Intake workspace · Captured" },
      { timestamp: "00:05", label: "Gap identified", detail: "One decision needs a direct answer before build starts.", artifactLabel: "GAP FLAG", artifactValue: "Missing: approval owner for launch copy", artifactMeta: "One clear follow-up · Ready to ask" },
      { timestamp: "00:09", label: "Brief assembled", detail: "Known details are structured around the client’s goal.", artifactLabel: "WORKING BRIEF", artifactValue: "Goal, scope, constraints, and open question organized", artifactMeta: "Team-ready summary · Version 1" },
      { timestamp: "00:13", label: "Team aligned", detail: "The project team receives the brief and next step.", artifactLabel: "TEAM UPDATE", artifactValue: "Build team notified · Clarification assigned", artifactMeta: "Project workspace · Delivered" },
    ],
  },
  {
    id: "returning-clients",
    label: "Returning clients",
    subtitle: "Notice the right moment to reconnect",
    metric: "1 signal",
    metricLabel: "turned into a conversation",
    summary: "A relevant client moment is recognized, acknowledged personally, and turned into an opportunity for the owner.",
    outcome: "A warm returning client is surfaced with a useful next conversation.",
    nodes: [
      { label: "Moment appears", detail: "A meaningful client signal arrives from an existing system.", kind: "trigger", icon: "spark" },
      { label: "Relationship read", detail: "Ajani understands the context behind the signal.", kind: "intelligence", icon: "relationship" },
      { label: "Personal nudge", detail: "The client gets a thoughtful, relevant message.", kind: "action", icon: "nudge" },
      { label: "Owner prompt", detail: "The opportunity is surfaced with the useful history attached.", kind: "handoff", icon: "owner" },
    ],
    events: [
      { timestamp: "00:00", label: "Client moment detected", detail: "A past client visits the service page again.", artifactLabel: "RETURN SIGNAL", artifactValue: "Jordan revisited the consultation page twice", artifactMeta: "Existing client · Relevant activity" },
      { timestamp: "00:03", label: "Relationship understood", detail: "Their history points to a timely, specific reason to reach out.", artifactLabel: "CONTEXT READ", artifactValue: "Last visit: 7 months ago · Previous service: consultation", artifactMeta: "Relationship history · Matched" },
      { timestamp: "00:06", label: "Nudge delivered", detail: "A human-sounding check-in reaches the client.", artifactLabel: "PERSONAL NUDGE", artifactValue: "“Jordan, would a quick refresh conversation be useful?”", artifactMeta: "Relevant message · Delivered" },
      { timestamp: "00:10", label: "Owner prompted", detail: "The owner sees the signal, history, and suggested next step.", artifactLabel: "OPPORTUNITY NOTE", artifactValue: "Warm return · Suggested next step: personal follow-up", artifactMeta: "Owner queue · Ready" },
    ],
  },
];

function NodeIcon({ name }: { name: NodeIconName }) {
  if (name === "sun") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>;
  if (name === "intent") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 2 8 5v10l-8 5-8-5V7l8-5Z" /><path d="M8.5 12h7M12 8.5V15.5" /></svg>;
  if (name === "reply") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h13" /><path d="m12 6 6 6-6 6" /><path d="M4 5v14" /></svg>;
  if (name === "handoff") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.7-3.6 2.5-5.4 5.5-5.4s4.8 1.8 5.5 5.4" /><path d="M16 10.5c2.6.2 4 1.7 4.5 4.5M16.5 15.5c2 .4 3.2 1.9 3.6 4.5" /></svg>;
  if (name === "inbox") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 5.5h18v13H3z" /><path d="m3 8 9 6 9-6" /><path d="M7 4v-2M12 4v-2M17 4v-2" /></svg>;
  if (name === "magnify") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5M8 10.5h5M10.5 8v5" /><path d="M3 3v4M3 3h4" /></svg>;
  if (name === "brief") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 11h6M9 15h6M9 19h3" /></svg>;
  if (name === "alignment") return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="5" rx="1" /><rect x="16" y="4" width="5" height="5" rx="1" /><rect x="9.5" y="15" width="5" height="5" rx="1" /><path d="M5.5 9v2.5h13V9M12 11.5V15" /></svg>;
  if (name === "spark") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="M19 16v5M16.5 18.5h5M4 16v3M2.5 17.5h3" /></svg>;
  if (name === "relationship") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9.5 14.5-1.7 1.7a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" /><path d="m14.5 9.5 1.7-1.7a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /><path d="m8.5 15.5 7-7" /></svg>;
  if (name === "nudge") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 17h12l-1.5-2.5v-4a4.5 4.5 0 0 0-9 0v4L6 17Z" /><path d="M10 20h4M19 5v4M17 7h4" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /><path d="M17 17h4M19 15v4" /></svg>;
}

function PlaybackIcon({ name }: { name: "back" | "play" | "pause" | "next" | "restart" }) {
  if (name === "play") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6.5 4 9 6-9 6V4Z" /></svg>;
  if (name === "pause") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 4v12M14 4v12" /></svg>;
  if (name === "back") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15.5 5.5 9 10l6.5 4.5M4.5 4.5v11" /></svg>;
  if (name === "next") return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4.5 5.5 6.5 4.5-6.5 4.5M15.5 4.5v11" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15.5 9A6 6 0 1 1 13.8 5" /><path d="M14 2.8v3.8h-3.8" /></svg>;
}

export function DemoGrid() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [mode, setMode] = useState<"idle" | "playing" | "paused" | "complete">("idle");
  const [reducedMotion, setReducedMotion] = useState(false);
  const scenarioTabs = useRef<Array<HTMLButtonElement | null>>([]);
  const scenario = scenarios[scenarioIndex];
  const totalSteps = scenario.nodes.length;
  const activeEvent = scenario.events[Math.max(activeStep - 1, 0)];

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      setReducedMotion(mediaQuery.matches);
      if (mediaQuery.matches) setMode((currentMode) => currentMode === "playing" ? "paused" : currentMode);
    };
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (mode !== "playing" || reducedMotion) return;

    const timer = window.setTimeout(() => {
      setActiveStep((step) => {
        if (step >= totalSteps) {
          setMode("complete");
          return step;
        }
        return step + 1;
      });
    }, DEMO_STEP_DURATION);

    return () => window.clearTimeout(timer);
  }, [mode, reducedMotion, totalSteps]);

  const resetRun = () => {
    setActiveStep(0);
    setMode("idle");
  };

  const chooseScenario = (index: number) => {
    setScenarioIndex(index);
    resetRun();
  };

  const moveScenarioFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keyTargets: Partial<Record<KeyboardEvent<HTMLButtonElement>["key"], number>> = {
      ArrowLeft: (index - 1 + scenarios.length) % scenarios.length,
      ArrowRight: (index + 1) % scenarios.length,
      End: scenarios.length - 1,
      Home: 0,
    };
    const nextIndex = keyTargets[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    chooseScenario(nextIndex);
    scenarioTabs.current[nextIndex]?.focus();
  };

  const runOrPause = () => {
    const shouldReduceMotion = reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shouldReduceMotion) {
      const nextStep = mode === "complete" || activeStep === 0
        ? 1
        : Math.min(activeStep + 1, totalSteps);
      setActiveStep(nextStep);
      setMode(nextStep === totalSteps ? "complete" : "paused");
      return;
    }

    if (mode === "playing") {
      setMode("paused");
      return;
    }

    if (mode === "complete") {
      setActiveStep(1);
    } else if (activeStep === 0) {
      setActiveStep(1);
    }

    setMode("playing");
  };

  const goBack = () => {
    const nextStep = Math.max(activeStep - 1, 0);
    setActiveStep(nextStep);
    setMode(nextStep === 0 ? "idle" : "paused");
  };

  const goForward = () => {
    if (activeStep >= totalSteps) {
      setMode("complete");
      return;
    }

    const nextStep = activeStep + 1;
    setActiveStep(nextStep);
    setMode(nextStep === totalSteps ? "complete" : "paused");
  };

  const toggleStepPlayback = (step: number) => {
    setActiveStep(step);
    if (reducedMotion) {
      setMode(step === totalSteps ? "complete" : "paused");
      return;
    }
    setMode((currentMode) => currentMode === "playing" ? "paused" : "playing");
  };

  const modeLabel = mode === "idle" ? "Ready" : mode === "playing" ? "Running" : mode === "paused" ? "Paused" : "Complete";
  const routeProgress = activeStep === 0 ? 0 : Math.min((activeStep / totalSteps) * 100, 100);
  return <section aria-label="Automation theatre" className={styles.theatre} data-mode={mode}>
    <div className={styles.scenarioBar}>
      <div>
        <p className="eyebrow">LIVE AUTOMATION THEATRE</p>
        <h2>Watch the work<br />move <em>play by play.</em></h2>
      </div>
      <p>Choose a common gap, then run the exact route that turns a signal into a useful next action.</p>
    </div>

    <div className={styles.mobileDemo}><MobileDemoTheatre scenarios={scenarios} /></div>

    <div className={styles.desktopDemo}>

    <div aria-label="Choose an automation scenario" className={styles.scenarioTabs} role="tablist">
      {scenarios.map((item, index) => <button aria-controls="automation-stage" aria-selected={index === scenarioIndex} className={styles.scenarioTab} id={`scenario-tab-${item.id}`} key={item.id} onClick={() => chooseScenario(index)} onKeyDown={(event) => moveScenarioFocus(event, index)} ref={(node) => { scenarioTabs.current[index] = node; }} role="tab" tabIndex={index === scenarioIndex ? 0 : -1} type="button">
        <span>0{index + 1}</span>
        <strong>{item.label}</strong>
        <small>{item.subtitle}</small>
        <b>{item.metric}<i>{item.metricLabel}</i></b>
      </button>)}
    </div>

    <div aria-labelledby={`scenario-tab-${scenario.id}`} className={styles.controlRoom} id="automation-stage" role="tabpanel">
      <header className={styles.roomHeader} key={`header-${scenario.id}`}>
        <div>
          <span className={styles.liveMark}><i /> {modeLabel} route</span>
          <h3>{scenario.label}</h3>
          <p>{scenario.summary}</p>
        </div>
        <div className={styles.routeReadout}>
          <span>ROUTE PROGRESS</span>
          <strong>{String(activeStep).padStart(2, "0")}<i> / 04</i></strong>
        </div>
      </header>

      <div className={styles.theatreGrid} key={`grid-${scenario.id}`}>
        <div className={styles.graphPanel}>
          <div className={styles.graphHeader}>
            <span>SYSTEM MAP</span>
            <span>{activeStep === 0 ? "Awaiting signal" : activeStep === totalSteps ? "Outcome ready" : `Processing node ${activeStep}`}</span>
          </div>
          <div className={styles.graph} style={{ "--route-progress": `${routeProgress}%` } as CSSProperties}>
            <svg aria-hidden="true" className={styles.graphLines} preserveAspectRatio="none" viewBox="0 0 1000 230">
              {[0, 1, 2].map((connection) => <path className={activeStep > connection + 1 ? styles.completedPath : activeStep === connection + 1 && mode === "playing" ? styles.activePath : styles.pendingPath} d={`M ${174 + (connection * 250)} 115 C ${224 + (connection * 250)} 115, ${276 + (connection * 250)} 115, ${326 + (connection * 250)} 115`} key={connection} pathLength="1" />)}
            </svg>
            <div className={styles.graphNodes}>
              {scenario.nodes.map((node, index) => {
                const nodeStep = index + 1;
                const state = activeStep > nodeStep ? "complete" : activeStep === nodeStep ? "active" : "pending";
                const stepAction = mode === "playing" ? "Pause at" : "Run from";
                return <button aria-label={`${stepAction} step ${nodeStep}: ${node.label}`} className={styles.graphNode} data-icon={node.icon} data-state={state} key={node.label} onClick={() => toggleStepPlayback(nodeStep)} type="button">
                  <span className={styles.nodeNumber}>0{nodeStep}</span>
                  <span className={styles.nodeIcon} data-icon={node.icon}><NodeIcon name={node.icon} /></span>
                  <b>{node.label}</b>
                  <small>{node.detail}</small>
                  <i>{state === "complete" ? "COMPLETE" : state === "active" ? "IN FOCUS" : "WAITING"}</i>
                </button>;
              })}
            </div>
          </div>
          <div className={styles.timeline}>
            {scenario.nodes.map((node, index) => <button aria-current={activeStep === index + 1 ? "step" : undefined} aria-label={`${mode === "playing" ? "Pause at" : "Run from"} ${node.label}`} className={styles.timelineStop} data-state={activeStep > index + 1 ? "complete" : activeStep === index + 1 ? "active" : "pending"} key={node.label} onClick={() => toggleStepPlayback(index + 1)} type="button"><i /><span>{String(index + 1).padStart(2, "0")}</span></button>)}
          </div>
        </div>

        <aside className={styles.observatory}>
          <div className={styles.observatoryHead}>
            <span>LIVE OUTPUT</span>
            <span>{activeStep === 0 ? "STANDBY" : activeStep === totalSteps ? "DELIVERED" : "UPDATING"}</span>
          </div>
          <article className={styles.artifact} data-active={activeStep > 0}>
            <span>{activeStep === 0 ? "ON DECK" : activeEvent.artifactLabel}</span>
            <strong>{activeStep === 0 ? "A live signal will enter this route." : activeEvent.artifactValue}</strong>
            <small>{activeStep === 0 ? "Press Run demo or advance one node at a time." : activeEvent.artifactMeta}</small>
          </article>
          <ol aria-label="Automation event ledger" className={styles.eventLedger}>
            {scenario.events.map((event, index) => <li data-state={activeStep > index + 1 ? "complete" : activeStep === index + 1 ? "active" : "pending"} key={event.label}>
              <time>{event.timestamp}</time>
              <div><b>{event.label}</b><span>{event.detail}</span></div>
              <i>{activeStep > index + 1 ? "✓" : activeStep === index + 1 ? "●" : "·"}</i>
            </li>)}
          </ol>
          <div className={styles.outcome} data-visible={activeStep === totalSteps}>
            <span>CLIENT BENEFIT</span>
            <strong>{scenario.outcome}</strong>
          </div>
        </aside>
      </div>

      <footer className={styles.playback}>
        <div className={styles.playbackControls}>
          <button aria-label="Go back one automation step" className={styles.iconControl} disabled={activeStep === 0} onClick={goBack} type="button"><PlaybackIcon name="back" /></button>
          <button aria-label={mode === "playing" ? `Pause ${scenario.label} automation` : `Run ${scenario.label} automation`} className={styles.playControl} onClick={runOrPause} type="button"><PlaybackIcon name={mode === "playing" ? "pause" : "play"} /> <span>{mode === "playing" ? "PAUSE" : mode === "complete" ? "RUN AGAIN" : activeStep === 0 ? "RUN DEMO" : "CONTINUE"}</span></button>
          <button aria-label="Advance one automation step" className={styles.iconControl} disabled={activeStep === totalSteps} onClick={goForward} type="button"><PlaybackIcon name="next" /></button>
          <button aria-label="Restart automation demo" className={styles.restartControl} onClick={resetRun} type="button"><PlaybackIcon name="restart" /> RESTART</button>
        </div>
        <p aria-live="polite" className={styles.runStatus} role="status">{mode === "idle" ? "Ready to trace the system." : mode === "playing" ? `Playing automation: ${scenario.nodes[activeStep - 1]?.label}.` : mode === "paused" ? `Paused at ${scenario.nodes[activeStep - 1]?.label}.` : "Automation route complete."}{reducedMotion && " Motion is simplified for this device."}</p>
        <RecordNoteAction>RECORD A NOTE ABOUT THIS <span>→</span></RecordNoteAction>
      </footer>
    </div>
    </div>
  </section>;
}
