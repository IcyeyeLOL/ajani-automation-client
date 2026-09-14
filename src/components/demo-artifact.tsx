"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import styles from "./demo-artifact.module.css";

type Props = {
  scenarioId: string;
  step: number;
  mode: "idle" | "playing" | "paused" | "complete";
  compact?: boolean;
  motionAllowed?: boolean;
  settled?: boolean;
};
type IconName = "message" | "spark" | "document" | "person" | "check" | "arrow" | "link";
function Icon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
    {name === "message" ? <><path d="M4 4h16v12H9l-5 4V4Z" /><path d="M8 8h8M8 12h5" /></> : null}
    {name === "spark" ? <path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z" /> : null}
    {name === "document" ? <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 12h7M9 16h5" /></> : null}
    {name === "person" ? <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : null}
    {name === "check" ? <path pathLength="1" d="m5 12 4 4L19 6" /> : null}
    {name === "arrow" ? <path d="M4 12h16m-6-6 6 6-6 6" /> : null}
    {name === "link" ? <><path d="m10 14-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 10l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0M8 16l8-8" /></> : null}
  </svg>;
}
function TypedText({ children }: { children: string }) {
  const characters = Array.from(children);
  return <p className={styles.typedText}>
    <span className={styles.srOnly}>{children}</span>
    <span aria-hidden="true">{characters.map((char, index) => <span
      className={styles.typedCharacter}
      data-typing-character={index}
      style={{ "--character": index } as CSSProperties}
      key={index}
    >{char}<i className={styles.cursor} data-typing-cursor={index} data-last={index === characters.length - 1} /></span>)}</span>
  </p>;
}
function Visible({ when, children, className }: { when: boolean; children: ReactNode; className: string }) {
  return <div className={className} data-visible={when} aria-hidden={!when}>{children}</div>;
}
function Processor({ step, label }: { step: number; label: string }) {
  return <div className={styles.processor} data-ready={step >= 2}>
    <div className={styles.processorCore}><span className={styles.coreMark}>a<span>.</span></span><div className={styles.corePixels} aria-hidden="true"><i /><i /><i /></div></div>
    <span>AJANI</span><small>{step === 0 ? "Ready" : step === 1 ? "Receiving" : step === 2 ? label : step === 3 ? "Composing" : "Routed"}</small>
  </div>;
}
function Connections() {
  return <svg aria-hidden="true" className={styles.connections} viewBox="0 0 1000 300" preserveAspectRatio="none">
    <path className={styles.connectionTrack} d="M245 140C355 140 350 140 480 140" />
    <path className={styles.connectionTrack} d="M520 140C650 140 655 140 755 140" />
    <path className={styles.incomingPacket} pathLength="100" d="M245 140C355 140 350 140 480 140" />
    <path className={styles.outgoingPacket} pathLength="100" d="M520 140C650 140 655 140 755 140" />
  </svg>;
}
function Handoff({ step, avatar, title, detail }: { step: number; avatar: string; title: string; detail: string }) {
  return <div className={styles.handoffSlot}>
    <div className={styles.handoffWaiting} aria-hidden={step >= 4}><span className={styles.waitingAvatar}><Icon name="person" /></span><span>A person takes it from here.</span><small>Human handoff</small></div>
    <Visible when={step >= 4} className={styles.handoff}>
      <div className={styles.handoffCard} data-motion-object="handoff"><span className={styles.ownerAvatar}>{avatar}</span><div><strong>{title}</strong><span>{detail}</span></div><span className={styles.deliverySeal}><Icon name="check" /></span></div>
      <span aria-hidden="true" className={styles.handoffPacket}><Icon name="document" /><i /><i /></span>
    </Visible>
  </div>;
}
function LeadScene({ step }: { step: number }) {
  return <>
    <div className={styles.flowBoard}>
      <Connections />
      <div className={styles.sourceStation}>
        <div className={styles.stationLabel}><span>01 / INCOMING</span><Icon name="message" /></div>
        <div className={styles.messageCard} data-motion-object="source">
          <div className={styles.messageMeta}><span className={styles.senderAvatar}><Icon name="person" /></span><div><strong>Website inbox</strong><span>New conversation · After hours</span></div><i /></div>
          <p>Hi, I need help with an appointment <strong>tonight.</strong></p>
          <div className={styles.messageTime}><span>Prospective client</span><time>00:00</time></div>
          <span className={styles.scanBeam} data-motion-object="scan" aria-hidden="true" />
        </div>
        <Visible when={step >= 2} className={styles.extractedTags}><span><Icon name="spark" /> High intent</span><span>Tonight</span><small>94% confidence</small></Visible>
      </div>
      <Processor step={step} label="Reading intent" />
      <div className={styles.outputStation}>
        <div className={styles.stationLabel}><span>02 / PERSONAL REPLY</span><Icon name="arrow" /></div>
        <div className={styles.outputPlaceholder} aria-hidden={step >= 3}><span className={styles.placeholderMark}><Icon name="message" /></span><strong>A useful answer.<br />While the office is closed.</strong><span className={styles.placeholderLines}><i /><i /></span></div>
        <Visible when={step >= 3} className={styles.outputLayer}>
          <article className={styles.replyCard} data-motion-object="output">
            <div className={styles.replyMeta}><span><Icon name="spark" /> AJANI REPLY</span><span>To your new lead</span></div>
            <TypedText>We can help. Here are tonight’s next open times.</TypedText>
            <div className={styles.sentIndicator}><Icon name="check" /> Personalized reply sent</div>
            <span aria-hidden="true" className={styles.sendToken}><Icon name="arrow" /></span>
          </article>
        </Visible>
      </div>
    </div>
    <Handoff step={step} avatar="M" title="Mia has the full picture." detail="Priority lead · Follow up within 4 minutes" />
  </>;
}
function IntakeScene({ step }: { step: number }) {
  return <>
    <div className={styles.flowBoard}>
      <Connections />
      <div className={styles.sourceStation}>
        <div className={styles.stationLabel}><span>01 / SOURCE MATERIAL</span><Icon name="document" /></div>
        <div className={styles.paperStack}>
          <div className={styles.sourceSheet}><Icon name="link" /><strong>2 source links</strong><i /><i /></div>
          <div className={styles.sourceSheet}><Icon name="document" /><strong>1 deadline</strong><i /><i /></div>
          <div className={styles.sourceSheet} data-motion-object="source"><div><Icon name="document" /><small>CLIENT CONTEXT</small></div><strong>6 notes.<br /> One place to start.</strong><i /><i /><span className={styles.scanBeam} data-motion-object="scan" aria-hidden="true" /></div>
        </div>
        <p className={styles.sourceInventory}>6 notes <span>·</span> 2 source links <span>·</span> 1 deadline</p>
        <Visible when={step >= 2} className={styles.extractedTags}><span><Icon name="check" /> Context organized</span></Visible>
      </div>
      <Processor step={step} label="Finding the gaps" />
      <div className={styles.outputStation}>
        <div className={styles.stationLabel}><span>02 / WORKING BRIEF</span><Icon name="document" /></div>
        <article className={styles.briefCard} data-ready={step >= 3} data-motion-object="output">
          <div className={styles.briefMasthead}><span>BUILD BRIEF</span><small>{step >= 3 ? "VERSION 01" : "ASSEMBLING"}</small></div>
          <h4><span className={styles.desktopBriefTitle}>Everyone starts<br />on the same page.</span><span className={styles.compactBriefTitle}>Working brief</span></h4>
          <div className={styles.briefRows} data-visible={step >= 3} aria-hidden={step < 3}>{["Goal & scope", "Constraints & timing"].map((row, index) => <div key={row} style={{ "--row": index } as CSSProperties}><span>0{index + 1}</span><strong>{row}</strong><Icon name="check" /></div>)}</div>
          <Visible when={step >= 2} className={styles.question}><span>ONE OPEN QUESTION</span><strong>Who approves the launch copy?</strong><small>{step >= 4 ? "Clarification assigned to the team" : "Approval owner needed before build"}</small></Visible>
        </article>
      </div>
    </div>
    <Handoff step={step} avatar="T" title="The team starts aligned." detail="Working brief delivered · Clarification assigned" />
  </>;
}
function ReturningScene({ step }: { step: number }) {
  return <>
    <div className={styles.flowBoard}>
      <Connections />
      <div className={styles.sourceStation}>
        <div className={styles.stationLabel}><span>01 / A FAMILIAR SIGNAL</span><Icon name="person" /></div>
        <div className={styles.profileCard} data-motion-object="source">
          <div className={styles.profileHead}><span className={styles.profileAvatar}>J<i /></span><div><span>EXISTING CLIENT</span><h4>Jordan</h4></div></div>
          <div className={styles.visitTimeline}><span className={styles.visitLine} /><span className={styles.visitDot} /><span className={styles.visitDot} /><span>Consultation page</span><strong>2 return visits</strong></div>
          <div className={styles.profileHistory}><span>{step >= 2 ? "Last consultation" : "A moment worth noticing"}</span><strong>{step >= 2 ? "7 months ago" : "Back on your page"}</strong></div>
          <span className={styles.scanBeam} data-motion-object="scan" aria-hidden="true" />
        </div>
        <Visible when={step >= 2} className={styles.extractedTags}><span><Icon name="link" /> Client history matched</span></Visible>
      </div>
      <Processor step={step} label="Joining the dots" />
      <div className={styles.outputStation}>
        <div className={styles.stationLabel}><span>02 / RECONNECT</span><Icon name="message" /></div>
        <div className={styles.outputPlaceholder} aria-hidden={step >= 3}><span className={styles.placeholderMark}><Icon name="link" /></span><strong>Pick up the conversation.<br />With the context intact.</strong><span className={styles.placeholderLines}><i /><i /></span></div>
        <Visible when={step >= 3} className={styles.outputLayer}>
          <article className={styles.replyCard} data-motion-object="output">
            <div className={styles.replyMeta}><span><Icon name="spark" /> PERSONAL CHECK-IN</span><span>To Jordan</span></div>
            <TypedText>Jordan, would a quick refresh conversation be useful?</TypedText>
            <div className={styles.sentIndicator}><Icon name="check" /> Relevant message sent</div>
            <span aria-hidden="true" className={styles.sendToken}><Icon name="arrow" /></span>
          </article>
        </Visible>
      </div>
    </div>
    <Handoff step={step} avatar="O" title="A warm return, ready to follow up." detail="Owner queue · Client history attached" />
  </>;
}
const scenarioTitles: Record<string, string> = {
  "after-hours-leads": "The reply that keeps a lead moving.",
  "client-intake": "From scattered notes to a shared plan.",
  "returning-clients": "A timely reason to reconnect.",
};
function MotionScene({ scenarioId, step, mode, compact = false, motionAllowed = false, settled = false }: Props) {
  // A newly inspected paused step is settled. Pausing an already running scene
  // keeps this entry flag and freezes its CSS timeline at its current position.
  const [enteredPlaying] = useState(() => mode === "playing" && motionAllowed && !settled);
  const animated = enteredPlaying && motionAllowed && mode !== "idle" && mode !== "complete";
  return <div className={styles.artifactStage} data-compact={compact} data-mode={mode} data-motion-allowed={motionAllowed} data-animated={animated} data-scenario={scenarioId} data-artifact-step={step}>
    <div className={styles.stageChrome}><span className={styles.railMark}>a<span>.</span></span><span>{scenarioTitles[scenarioId] ?? scenarioTitles["after-hours-leads"]}</span><small>ILLUSTRATIVE DEMO</small></div>
    {scenarioId === "client-intake" ? <IntakeScene step={step} /> : scenarioId === "returning-clients" ? <ReturningScene step={step} /> : <LeadScene step={step} />}
  </div>;
}
/** Parent clocks own the 3s steps; each inner scene performs one CSS sequence. */
export function DemoArtifact(props: Props) {
  const shownStep = props.mode === "complete" ? 4 : Math.max(0, Math.min(props.step, 4));
  return <MotionScene {...props} step={shownStep} key={props.scenarioId + ":" + shownStep + ":" + Boolean(props.settled) + ":" + Boolean(props.motionAllowed)} />;
}
