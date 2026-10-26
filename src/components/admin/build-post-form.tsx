"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { postBuildUpdateAction } from "@/app/admin/actions";
import { initialAdminActionState, type AdminActionState } from "@/app/admin/action-state";
import { withRenewedSignIn } from "@/lib/admin/fresh-session";
import { BUILD_LINK_LABEL_MAX_LENGTH, BUILD_MESSAGE_MAX_LENGTH, DELIVERY_STAGES, buildStatusLabel } from "@/lib/builds/conversation";

// Every desk save renews the sign-in first (see fresh-session.ts).
const postBuildUpdate = withRenewedSignIn(postBuildUpdateAction);

/** clientReachable: the requester is still in the client's workspace, so they may be emailed. */
type Props = { buildId: string; clientEmail: string; clientReachable: boolean; sampleMode: boolean; status: string };

/** Ajani's composer on a client build: an update or a question, an optional link, and an optional stage move. */
export function BuildPostForm(props: Props) {
  const [state, action, pending] = useActionState(postBuildUpdate, initialAdminActionState);
  // A saved post remounts the fields empty; a refused one keeps everything typed.
  const [savedId, setSavedId] = useState("draft");
  if (state.status === "success" && state.entityId && state.entityId !== savedId) setSavedId(state.entityId);
  return <PostFields {...props} action={action} key={savedId} pending={pending} state={state} />;
}

function PostFields({ action, buildId, clientEmail, clientReachable, pending, sampleMode, state, status }: Props & { action: (formData: FormData) => void; pending: boolean; state: AdminActionState }) {
  const [kind, setKind] = useState<"update" | "question">("update");
  // Only a written post is emailed; a stage move alone is not.
  const [hasBody, setHasBody] = useState(false);
  const canEmail = Boolean(clientEmail) && clientReachable;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sampleMode) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
  const question = kind === "question";

  return <form className="admin-post-form" onSubmit={submit}>
    <input name="buildId" type="hidden" value={buildId} />
    {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
    <fieldset className="admin-post-kind">
      <legend className="sr-only">What are you posting?</legend>
      <label><input checked={!question} name="kind" onChange={() => setKind("update")} type="radio" value="update" /><span><b>Progress update</b><small>What changed and what comes next</small></span></label>
      <label><input checked={question} name="kind" onChange={() => setKind("question")} type="radio" value="question" /><span><b>Question</b><small>Flags it for the client to answer</small></span></label>
    </fieldset>
    <label className="admin-field">
      <span>{question ? "Your question for the client" : "The update"}</span>
      <textarea maxLength={BUILD_MESSAGE_MAX_LENGTH} name="body" onChange={(event) => setHasBody(Boolean(event.currentTarget.value.trim()))} placeholder={question ? "Ask one clear thing, e.g. which calendar should new bookings go to?" : "Plain words: what's done, what's next, anything they should know."} rows={5} />
    </label>
    <div className="admin-form-pair">
      <label className="admin-field">
        <span>Link (optional)</span>
        <input inputMode="url" name="linkUrl" placeholder="https://www.loom.com/share/…" type="url" />
        <small>A Loom walkthrough, a doc, or a preview. Must start with https://</small>
      </label>
      <label className="admin-field">
        <span>Link name</span>
        <input maxLength={BUILD_LINK_LABEL_MAX_LENGTH} name="linkLabel" placeholder="Watch the walkthrough" />
      </label>
    </div>
    <div className="admin-form-pair">
      <label className="admin-field">
        <span>Stage</span>
        <select defaultValue="" name="status">
          <option value="">Keep at {buildStatusLabel(status)}</option>
          {DELIVERY_STAGES.filter((stage) => stage.status !== status).map((stage) => <option key={stage.status} value={stage.status}>Move to {stage.label}: {stage.hint}</option>)}
        </select>
        <small>You can move the stage without writing anything.</small>
      </label>
      <label className="admin-post-notify">
        {/* A disabled box is left out of the form, so nothing promises an email that will not go. */}
        <input defaultChecked={canEmail} disabled={!canEmail || !hasBody} name="notifyClient" type="checkbox" />
        <span><b>Email the client</b><small>{!clientEmail ? "No email on file for this client, so the post stays in their portal only."
          : !clientReachable ? "The person who requested this build is no longer in the client's workspace, so nothing is emailed."
            : !hasBody ? "Write an update or question to email it. A stage move alone is not emailed."
              : `Sends a heads-up to ${clientEmail} with a link to their portal.`}</small></span>
      </label>
    </div>
    <footer className="admin-form-footer">
      <p aria-live="polite" className={`admin-form-message ${state.status}`} role="status">{sampleMode ? "Sample data is on, so posting is switched off." : state.message || "Posts show in the client's portal right away."}</p>
      <button disabled={pending || sampleMode} type="submit">{pending ? "POSTING…" : "POST TO CLIENT PORTAL"}<span aria-hidden="true">→</span></button>
    </footer>
  </form>;
}
