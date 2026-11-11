"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import styles from "./processing-overlay.module.css";

export type ProcessingPhase = "transcribing" | "clarifying" | "shaping";

const phaseCopy: Record<ProcessingPhase, { label: string; title: string; detail: string }> = {
  transcribing: {
    label: "Voice note / Transcribing",
    title: "Putting your note into writing.",
    detail: "Your recording is saved in this tab. You can review and edit the written version before Ajani uses it.",
  },
  clarifying: {
    label: "Tell us / Preparing questions",
    title: "Finding the questions that matter.",
    detail: "Ajani is reading your note for decisions that change the route. You will confirm every answer.",
  },
  shaping: {
    label: "Clarify / Building route",
    title: "Building your first route.",
    detail: "Ajani is combining the full note with your confirmed answers. You can edit every step before sending it.",
  },
};

export function ProcessingOverlay({ phase, onCancel }: { phase: ProcessingPhase | null; onCancel: () => void }) {
  return phase ? <PendingOverlay key={phase} onCancel={onCancel} phase={phase} /> : null;
}

function PendingOverlay({ phase, onCancel }: { phase: ProcessingPhase; onCancel: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Brief requests finish without flashing a full-screen transition.
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, []);

  const copy = phaseCopy[phase];

  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) onCancel(); }} open={visible}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.screen}>
          <header className={styles.header}>
            <span className={styles.brand}>ajani<i>.</i></span>
            <span className={styles.headerLabel}>Preparing your request</span>
            <button className={styles.cancel} onClick={onCancel} type="button">Cancel <span aria-hidden="true">×</span></button>
          </header>
          <div className={styles.center}>
            <div aria-hidden="true" className={styles.spinner} />
            <p className={styles.eyebrow} aria-live="polite">{copy?.label}</p>
            <Dialog.Title>{copy?.title}</Dialog.Title>
            <Dialog.Description className={styles.detail}>{copy?.detail}</Dialog.Description>
            <p className={styles.status} role="status">Working on your request…</p>
          </div>
          <p className={styles.footer}>Your note stays editable. Nothing is sent as a build request at this step.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
