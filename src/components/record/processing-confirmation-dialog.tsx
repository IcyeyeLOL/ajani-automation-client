"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRef, useState } from "react";
import styles from "./processing-confirmation-dialog.module.css";

export type ProcessingConfirmationIntent = "voice" | "continue";

type ProcessingConfirmationDialogProps = {
  intent: ProcessingConfirmationIntent | null;
  onConfirm: (intent: ProcessingConfirmationIntent) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ProcessingConfirmationDialog({
  intent,
  onConfirm,
  onOpenChange,
  open,
}: ProcessingConfirmationDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setConfirmed(false);
    onOpenChange(nextOpen);
  };

  const submit = () => {
    if (!confirmed || !intent) return;
    setConfirmed(false);
    onConfirm(intent);
  };

  return (
    <Dialog.Root onOpenChange={changeOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          aria-describedby="processing-confirmation-description"
          aria-modal="true"
          className={styles.dialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const returnTarget = returnFocusRef.current;
            if (returnTarget?.isConnected) returnTarget.focus();
            returnFocusRef.current = null;
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current = document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
            checkboxRef.current?.focus();
          }}
        >
          <Dialog.Close aria-label="Close processing confirmation" className={styles.close}>×</Dialog.Close>

          <div className={styles.brand} aria-hidden="true">
            <span>a<span>.</span></span>
            <i />
            <small>Private note</small>
          </div>

          <div className={styles.heading}>
            <p className={styles.eyebrow}>One quick confirmation</p>
            <Dialog.Title>{intent === "continue" ? "Before Ajani continues." : "Before you record."}</Dialog.Title>
            <Dialog.Description id="processing-confirmation-description">
              {intent === "continue"
                ? "Confirm that this note is yours to share, then Ajani will prepare the questions that shape your route."
                : "Confirm that this note is yours to share, then Ajani will open the microphone."}
            </Dialog.Description>
          </div>

          <div className={styles.notice}>
            <span aria-hidden="true">◇</span>
            <div>
              <strong>{intent === "continue" ? "Your draft stays editable." : "Your recording stays under your control."}</strong>
              <p>{intent === "continue"
                ? "Ajani may send the written note to an AI provider to create editable questions and a proposed route. Nothing is built or sent to your team at this step."
                : "Ajani keeps the recorded copy in this tab while you record. Your browser or operating system may process speech for live text. After you finish, Ajani may send the recording to Deepgram unless you already provided enough written text. The original is uploaded only if you send the handoff."}</p>
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className={styles.confirmation} data-checked={confirmed ? "true" : "false"}>
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                ref={checkboxRef}
                type="checkbox"
              />
              <span aria-hidden="true">{confirmed ? "✓" : ""}</span>
              <strong>I confirm I am 18 or older, am authorized to share this note, and have permission from anyone recorded.</strong>
            </label>

            <p className={styles.legal}>
              Your note may be sent to Ajani&apos;s transcription or AI providers to create editable text, questions, and a proposed route. Do not include sensitive or regulated personal information. By continuing, you acknowledge the <Link href="/privacy#notice-at-collection">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>.
            </p>

            <div className={styles.actions}>
              <Dialog.Close className={styles.cancel} type="button">Not now</Dialog.Close>
              <button className={styles.confirm} disabled={!confirmed} type="submit">
                {intent === "continue" ? "Confirm & continue" : "Confirm & start recording"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
