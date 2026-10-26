"use client";

import { startTransition, useActionState, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "@/components/builds/conversation.module.css";
import { sendBuildMessageAction } from "@/app/portal/actions";
import { initialPortalMessageState } from "@/app/portal/message-state";
import { BUILD_MESSAGE_MAX_LENGTH } from "@/lib/builds/conversation";
import { withRenewedSignIn } from "@/lib/admin/fresh-session";

// A tab left open can hold an expired sign-in; renew it before sending.
const sendMessage = withRenewedSignIn(sendBuildMessageAction);

/** The client's reply box. A refused send keeps what was typed; a sent one clears. */
export function BuildMessageForm({ answering, buildId }: { answering: boolean; buildId: string }) {
  const [state, action, pending] = useActionState(sendMessage, initialPortalMessageState);
  // Only a sent message clears the box; a refused one keeps what was typed.
  const [sentId, setSentId] = useState("compose");
  if (state.status === "success" && state.sentId && state.sentId !== sentId) setSentId(state.sentId);
  const fieldId = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
  const sendOnShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return <form className={styles.composer} key={sentId} onSubmit={submit}>
    <input name="buildId" type="hidden" value={buildId} />
    <label htmlFor={fieldId}>{answering ? "Your answer" : "Ask Ajani a question"}</label>
    <textarea
      id={fieldId}
      maxLength={BUILD_MESSAGE_MAX_LENGTH}
      name="body"
      onKeyDown={sendOnShortcut}
      placeholder={answering ? "Type your answer here" : "Ask about this build, share a detail, or flag a change"}
      required
    />
    <footer>
      <p aria-live="polite" data-status={state.status} role="status">{state.message || "Your message stays on this build, where Ajani reads and answers it."}</p>
      <button disabled={pending} type="submit">{pending ? "Sending…" : answering ? "Send answer" : "Send"}</button>
    </footer>
  </form>;
}
