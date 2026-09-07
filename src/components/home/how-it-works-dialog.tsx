"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type KeyboardEvent } from "react";
import { RecordNoteAction } from "@/components/record-note-action";
import styles from "./how-it-works-dialog.module.css";

const steps = [
  {
    marker: "Start with the messy part",
    title: "Tell Ajani what keeps wasting time.",
    body: "Record a quick voice note or type it out. Talk the way you would to a teammate. You do not need to diagnose the automation first.",
    takeaway: "Two minutes is enough to get started.",
    kind: "record",
  },
  {
    marker: "AI review",
    title: "Your note becomes a clear working brief.",
    body: "Ajani transcribes the note and pulls out the real problem, the tools involved, and what a better outcome should look like.",
    takeaway: "The messy explanation becomes something buildable.",
    kind: "review",
  },
  {
    marker: "Only what matters",
    title: "We ask the questions that change the system.",
    body: "If something important is missing, Ajani asks a focused follow-up. No long discovery form and no making you repeat what you already said.",
    takeaway: "You answer the gap, not another questionnaire.",
    kind: "question",
  },
  {
    marker: "See the route",
    title: "You see how the work will move before we build it.",
    body: "Ajani reflects the automation back in plain language, from the first signal to the final handoff, so you can confirm it fits the way your business actually works.",
    takeaway: "Nothing important gets lost in translation.",
    kind: "route",
  },
  {
    marker: "One workspace",
    title: "Your request lands with the full context attached.",
    body: "Your account keeps the note, answers, and approved route together while the Ajani team takes it forward.",
    takeaway: "One clear request replaces the scattered back-and-forth.",
    kind: "handoff",
  },
  {
    marker: "Built and visible",
    title: "We build the system and keep you in the loop.",
    body: "The team is notified, progress stays visible in your portal, and the automation is tested in your real workflow before it goes live.",
    takeaway: "Your team spends less time on repetitive steps and more time on client work.",
    kind: "build",
  },
] as const;

type StepKind = (typeof steps)[number]["kind"];

const clarificationAnswers = [
  { key: "A", label: "When they ask about price or availability", result: "Handoff starts when buying intent is clear." },
  { key: "B", label: "After every first reply", result: "Every replied-to lead is routed to the team." },
  { key: "C", label: "Only when they are ready to book", result: "The system keeps nurturing until booking intent appears." },
] as const;

function MiniPreview({ kind }: { kind: StepKind }) {
  const [selectedAnswer, setSelectedAnswer] = useState(1);

  if (kind === "record") {
    return (
      <div className={styles.recordPreview} aria-hidden="true">
        <div className={styles.listeningStatus}><i /> Listening to your note</div>
        <div className={styles.voiceSignal}>
          <span className={styles.signalLine} />
          <div className={styles.waveform}>
          {[18, 32, 48, 72, 42, 88, 56, 38, 76, 98, 58, 34, 82, 64, 42, 90, 52, 72, 38, 58, 28, 46, 22].map((height, index) => (
            <i key={`${height}-${index}`} style={{ height }} />
          ))}
          </div>
        </div>
        <p><b>Voice note active</b><span>00:18 / demo</span></p>
      </div>
    );
  }

  if (kind === "review") {
    return (
      <div className={styles.reviewPreview} aria-hidden="true">
        <div className={styles.transcriptCard}>
          <div><small>Voice transcript</small><span>00:18</span></div>
          <p>“Website enquiries arrive <mark>after hours</mark>. By the time we reply, the best leads have <mark>gone cold</mark>.”</p>
          <footer><i /> Transcript complete</footer>
        </div>
        <span className={styles.previewArrow}>→</span>
        <div className={styles.extractedBrief}>
          <header><small>AI pattern</small><span><i /> Found</span></header>
          <div className={styles.patternSummary}>
            <strong>Core problem</strong>
            <b>After-hours leads go cold before the team can reply.</b>
          </div>
          <dl>
            <div><dt>Trigger</dt><dd>Website enquiry</dd></div>
            <div><dt>Goal</dt><dd>Reply immediately</dd></div>
          </dl>
        </div>
      </div>
    );
  }

  if (kind === "question") {
    return (
      <div className={styles.questionPreview} aria-label="Interactive clarification example">
        <small>Try it · choose A, B, or C</small>
        <b>When should the system hand a lead to your team?</b>
        <div className={styles.answerOptions}>
          {clarificationAnswers.map((answer, index) => (
            <button
              aria-pressed={selectedAnswer === index}
              className={selectedAnswer === index ? styles.answerSelected : undefined}
              key={answer.key}
              onClick={() => setSelectedAnswer(index)}
              type="button"
            >
              <strong>{answer.key}</strong>
              <span>{answer.label}</span>
              <i aria-hidden="true">{selectedAnswer === index ? "✓" : ""}</i>
            </button>
          ))}
        </div>
        <p className={styles.answerResult} aria-live="polite">
          {clarificationAnswers[selectedAnswer].result}
        </p>
      </div>
    );
  }

  if (kind === "route") {
    return (
      <div className={styles.routePreview} aria-hidden="true">
        <header><small>Proposed lead-response route</small><span><i /> Ready to review</span></header>
        <div className={styles.routeMap}>
          {[
            ["01", "Signal", "Lead arrives", "↗"],
            ["02", "Read", "Intent mapped", "◎"],
            ["03", "Reply", "Draft answer", "↵"],
            ["04", "Handoff", "Team has context", "✓"],
          ].map(([number, label, detail, icon], index) => (
            <div className={styles.routeNode} key={number}>
              <div><span>{number}</span><i>{icon}</i></div>
              <b>{label}</b>
              <small>{detail}</small>
              {index < 3 ? <em /> : null}
            </div>
          ))}
        </div>
        <footer><span>Voice note</span><i>→</i><span>Approved system route</span></footer>
      </div>
    );
  }

  if (kind === "handoff") {
    return (
      <div className={styles.handoffPreview} aria-hidden="true">
        <div className={styles.requestCard}>
          <small>Request AJ-1048</small>
          <b>After-hours lead response</b>
          <span><i /> Ready for the Ajani team</span>
        </div>
        <span className={styles.previewArrow}>→</span>
        <div className={styles.portalCard}>
          <header><small>Workspace</small><span><i /> Synced</span></header>
          <b>Context attached</b>
          <ul>
            <li><i>✓</i><span><strong>Voice note</strong><small>Audio + transcript</small></span></li>
            <li><i>✓</i><span><strong>Answers</strong><small>Decisions captured</small></span></li>
            <li><i>✓</i><span><strong>Approved route</strong><small>Ready to build</small></span></li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.buildPreview} aria-hidden="true">
      <div className={styles.buildTimeline}>
        <div className={styles.complete}><i>✓</i><p><b>Request received</b><span>Team notified</span></p></div>
        <div className={styles.active}><i /><p><b>System build</b><span>In progress</span></p></div>
        <div><i /><p><b>Test in your workflow</b><span>Up next</span></p></div>
        <div><i /><p><b>Go live</b><span>Then keep improving</span></p></div>
      </div>
    </div>
  );
}

export function HowItWorksDialog({ triggerClassName }: { triggerClassName: string }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setDirection("forward");
      setStepIndex(0);
    }
  }

  function goToStep(nextStep: number) {
    setDirection(nextStep < stepIndex ? "backward" : "forward");
    setStepIndex(nextStep);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" && !isLastStep) {
      event.preventDefault();
      goToStep(stepIndex + 1);
    }
    if (event.key === "ArrowLeft" && stepIndex > 0) {
      event.preventDefault();
      goToStep(stepIndex - 1);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <button className={triggerClassName} type="button">See how it works</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          aria-describedby="how-it-works-description"
          onKeyDown={handleKeyDown}
        >
          <header className={styles.dialogHeader}>
            <div>
              <span className={styles.brand}>AJANI<i>.</i></span>
              <span>Ajani tutorial</span>
            </div>
            <Dialog.Close className={styles.closeButton} aria-label="Close Ajani tutorial">
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </header>

          <div className={styles.progressHeader}>
            <span>Step {stepIndex + 1} of {steps.length}</span>
            <div className={styles.progress} aria-label={`Tutorial progress: step ${stepIndex + 1} of ${steps.length}`}>
              {steps.map((item, index) => (
                <button
                  aria-label={`Go to step ${index + 1}: ${item.marker}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                  className={index <= stepIndex ? styles.progressActive : undefined}
                  key={item.kind}
                  onClick={() => goToStep(index)}
                  type="button"
                />
              ))}
            </div>
          </div>

          <div className={styles.stage} data-direction={direction} key={step.kind}>
            <div className={styles.copy}>
              <p className={styles.marker}>{step.marker}</p>
              <Dialog.Title>{step.title}</Dialog.Title>
              <Dialog.Description id="how-it-works-description">{step.body}</Dialog.Description>
              <p className={styles.takeaway}><i aria-hidden="true">✓</i>{step.takeaway}</p>
            </div>
            <div className={styles.preview}>
              <div className={styles.previewHeader}>
                <span>Ajani / tutorial</span>
                <span><i /> Interactive preview</span>
              </div>
              <div className={styles.previewBody}>
                <MiniPreview kind={step.kind} />
              </div>
            </div>
          </div>

          <footer className={styles.footer}>
            <Dialog.Close className={styles.skipButton}>Close tutorial</Dialog.Close>
            <div>
              <button
                className={styles.backButton}
                disabled={stepIndex === 0}
                onClick={() => goToStep(stepIndex - 1)}
                type="button"
              >
                Back
              </button>
              {isLastStep ? (
                <Dialog.Close asChild>
                  <RecordNoteAction className={styles.nextButton}>Record your note <span aria-hidden="true">→</span></RecordNoteAction>
                </Dialog.Close>
              ) : (
                <button className={styles.nextButton} onClick={() => goToStep(stepIndex + 1)} type="button">
                  Next <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
