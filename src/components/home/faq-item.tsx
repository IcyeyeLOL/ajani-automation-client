"use client";

import { useState } from "react";
import styles from "./delivery-trust.module.css";

export function FaqItem({ answer, id, question }: { answer: string; id: string; question: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.faqItem} data-open={open}>
      <button
        aria-controls={id}
        aria-expanded={open}
        className={styles.faqQuestion}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{question}</span>
        <i aria-hidden="true">+</i>
      </button>
      <div aria-hidden={!open} className={styles.faqAnswer} id={id}>
        <div className={styles.faqAnswerInner}>
          <p>{answer}</p>
        </div>
      </div>
    </div>
  );
}
