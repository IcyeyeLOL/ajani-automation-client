"use client";

import { startTransition, useActionState, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "@/components/builds/conversation.module.css";
import { sendBuildMessageAction } from "@/app/portal/actions";
import { initialPortalMessageState, type PortalMessageState } from "@/app/portal/message-state";
import { BUILD_MESSAGE_MAX_LENGTH } from "@/lib/builds/conversation";
import { withRenewedSignIn } from "@/lib/admin/fresh-session";

// A tab left open can hold an expired sign-in; renew it before sending.
const renewedSend = withRenewedSignIn(sendBuildMessageAction);

// A dropped connection or a stale page throws instead of answering; without this
// React hands the error to the page's error screen and the typed text is lost.
async function sendMessage(state: PortalMessageState, formData: FormData): Promise<PortalMessageState> {
  try {
    return await renewedSend(state, formData);
  } catch {
    return { status: "error", message: "Your message could not be sent. It is still in the box, so check your connection and send again." };
  }
}

/** Shown once a message gets this close to the limit. */
const COUNTER_FROM = BUILD_MESSAGE_MAX_LENGTH - 500;

/** The client's reply box. A refused send keeps what was typed; a sent one clears. */
export function BuildMessageForm({ answering, buildId }: { answering: boolean; buildId: string }) {
  const [state, action, pending] = useActionState(sendMessage, initialPortalMessageState);
  const [text, setText] = useState("");
  // Clear only after a send succeeds. The form stays mounted, so focus stays in
  // the box and the status line below is announced.
  const [clearedId, setClearedId] = useState<string | null>(null);
  if (state.status === "success" && state.sentId && state.sentId !== clearedId) {
    setClearedId(state.sentId);
    setText("");
  }
  const fieldId = useId();
  const blank = !text.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // A held or repeated Ctrl+Enter must not send the same message twice.
    if (pending || blank) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
  const sendOnShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!event.repeat) event.currentTarget.form?.requestSubmit();
    }
  };
  const left = BUILD_MESSAGE_MAX_LENGTH - text.length;

  return <form className={styles.composer} id="reply" onSubmit={submit}>
    <input name="buildId" type="hidden" value={buildId} />
    <label htmlFor={fieldId}>{answering ? "Your answer" : "Ask Ajani a question"}</label>
    <textarea
      id={fieldId}
      maxLength={BUILD_MESSAGE_MAX_LENGTH}
      name="body"
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={sendOnShortcut}
      placeholder={answering ? "Type your answer here" : "Ask about this build, share a detail, or flag a change"}
      // While sending, the box holds exactly what is being sent, so a success clears nothing unsent.
      readOnly={pending}
      required
      value={text}
    />
    <footer>
      <p aria-live="polite" data-status={state.status} role="status">
        {state.message || "Your message stays on this build, where Ajani reads and answers it."}
        {text.length >= COUNTER_FROM ? <small> {left === 1 ? "1 character left." : `${left} characters left.`}</small> : null}
      </p>
      <button disabled={pending || blank} type="submit">{pending ? "Sending…" : answering ? "Send answer" : "Send"}</button>
    </footer>
  </form>;
}
