"use client";

import { startTransition, useActionState, useEffect, useState, useSyncExternalStore, type FormEvent, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { deleteMetricValueAction, recordMetricValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { bucketLabel, coldCallAnswersProblem, entryDayLabel, formatMetricValue, localDay, shortMetricLabel } from "@/lib/admin/metric-query";
import type { TrendViewId } from "@/lib/admin/metric-query";
import type { MetricCatalog, MetricDefinition } from "@/lib/admin/metric-types";
import { withRenewedSignIn } from "@/lib/admin/fresh-session";

// Each save renews the sign-in first (see fresh-session.ts).
const recordValues = withRenewedSignIn(recordMetricValuesAction);
const deleteValue = withRenewedSignIn(deleteMetricValueAction);

const NEW_ACCOUNT = "__new_account__";
const SAMPLE_NOTE = "Sample data is on, so nothing can be saved. Switch to real data to log numbers.";
const UNSAVED_NOTE = "Your last save wasn't made, because that day already had some of those numbers. Type them again, then choose to add to them or replace them.";

// Goal numbers first, then platforms in the order the owner uses them. A tab
// shows only while the catalog has active manual metrics for it.
export const entryGroups: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "revenue", label: "Sales & revenue", sources: ["sales", "revenue"] },
  { id: "cold_calls", label: "Cold calls", sources: ["cold_calls"] },
  // Only Dripify's manual numbers: what it syncs never appears as a field.
  { id: "dripify", label: "Dripify", sources: ["dripify"] },
  { id: "linkedin", label: "LinkedIn", sources: ["linkedin"] },
  { id: "instagram", label: "Instagram", sources: ["instagram"] },
  { id: "youtube", label: "YouTube", sources: ["youtube"] },
  { id: "reddit", label: "Reddit", sources: ["reddit"] },
  { id: "x", label: "X", sources: ["x"] },
];

/** The tabs whose numbers Outreach adds up. */
const outreachGroups = ["cold_calls", "reddit", "dripify"];

/** Groups logged for the whole business, with no account picker. */
const businessGroups = new Set(["revenue", "cold_calls", "dripify"]);

/** What to know before typing a group's numbers. */
const groupNotes: Record<string, string> = {
  youtube: "YouTube syncs these every night once it's connected. Type numbers only for days before the sync started: a typed day from the last week is replaced by the next sync.",
  reddit: "Log every Reddit DM here; Outreach adds them up with Dripify and cold calls.",
  dripify: "Dripify syncs its sends, acceptances and replies every night. Log the positive replies and calls booked from Dripify conversations here.",
};

/**
 * The browser's calendar day, or null on the server and while hydrating, so
 * both render the same HTML. Read again when the tab comes back into view, so
 * a desk left open overnight moves on to the new day.
 */
export function useLocalDay() {
  return useSyncExternalStore(subscribeToDayChanges, localDay, noDay);
}
function subscribeToDayChanges(onChange: () => void) {
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}
const noDay = () => null;

/** A request to open the panel (and scroll to it) on the tab for these sources; null means the current view's. */
export type LogRequest = { token: number; sources: string[] | null };

export function MetricLog({ catalog, definitions, request, viewId, viewSources, sampleMode, onNavigate }: {
  catalog: MetricCatalog;
  definitions: Map<string, MetricDefinition>;
  request: LogRequest;
  viewId: TrendViewId;
  viewSources: string[] | null;
  sampleMode: boolean;
  onNavigate?: (section: "outreach") => void;
}) {
  const router = useRouter();
  const groups = entryGroups.filter((item) => catalog.metrics.some((metric) => metric.entryMode === "manual" && item.sources.includes(metric.source)));
  const groupFor = (sources: string[] | null) => groups.find((item) => sources?.some((source) => item.sources.includes(source)))
    // The Outreach view starts on the first tab that feeds it.
    ?? (sources?.includes("outreach") ? groups.find((item) => outreachGroups.includes(item.id)) : undefined)
    ?? groups[0];
  const [open, setOpen] = useState(request.token > 0);
  const [groupId, setGroupId] = useState(() => groupFor(request.sources ?? viewSources)?.id ?? "");
  const [handled, setHandled] = useState(request.token);
  if (request.token !== handled) {
    setHandled(request.token);
    setOpen(true);
    setGroupId(groupFor(request.sources ?? viewSources)?.id ?? "");
  }
  const [state, action, pending] = useActionState(recordValues, initialAdminActionState);
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  // A save's answer belongs to the tab that sent it. Switching tabs while it
  // is on its way must not put its question, or its clearing, on another tab.
  const [sentFrom, setSentFrom] = useState<string | null>(null);
  const reply = group && sentFrom === group.id ? state : initialAdminActionState;
  const fields = group ? catalog.metrics.filter((metric) => metric.entryMode === "manual" && group.sources.includes(metric.source)) : [];
  // Sales, revenue, cold calls and Dripify's logged outcomes belong to the business, not to a platform account.
  const accounts = !group || businessGroups.has(group.id) ? null : [...new Set(fields.flatMap((field) => field.dimensions))].sort();

  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  useEffect(() => {
    if (request.token) document.getElementById("log-numbers")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [request.token]);

  // Opening by hand picks the tab for the view on screen (Key numbers: Sales & revenue).
  const toggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (next === open) return;
    setOpen(next);
    if (next) setGroupId(groupFor(viewSources)?.id ?? "");
  };

  return <details className="admin-panel admin-trend-log" id="log-numbers" onToggle={toggle} open={open}>
    <summary><b>Log numbers</b><span>Type in what LinkedIn, Instagram and the others show you.</span></summary>
    <div className="admin-trend-log-body">
      {viewId === "outreach" ? <p className="admin-trend-log-pointer">Outreach adds up Dripify, Reddit DMs and cold calls.{onNavigate ? <> Each channel&apos;s last 30 days is under <button className="admin-trend-link" onClick={() => onNavigate("outreach")} type="button">Outreach →</button></> : null}</p> : null}
      <div aria-label="Platform" className="admin-trend-chips small" role="group">
        {groups.map((item) => <button aria-pressed={item.id === group?.id} key={item.id} onClick={() => setGroupId(item.id)} type="button">{item.label}</button>)}
      </div>
      {group && groupNotes[group.id] ? <p className="admin-trend-log-pointer">{groupNotes[group.id]}</p> : null}
      {group ? <EntryForm accounts={accounts} action={(formData) => { setSentFrom(group.id); action(formData); }} code={reply.code} entityId={reply.entityId} fields={fields} key={group.id} message={reply.message} pending={pending} sampleMode={sampleMode} status={reply.status} today={catalog.today} /> : null}
      <RecentEntries definitions={definitions} entries={catalog.recentEntries} sampleMode={sampleMode} today={catalog.today} />
    </div>
  </details>;
}

function EntryForm({ accounts, action, code, entityId, fields, today, pending, status, message, sampleMode }: { accounts: string[] | null; action: (formData: FormData) => void; code?: string; entityId?: string; fields: MetricDefinition[]; today: string; pending: boolean; status: string; message: string; sampleMode: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  // A pick-list, not free text: the same account typed two ways would be two
  // accounts, and their followers would be added together forever.
  const [account, setAccount] = useState("");
  const [clearedFor, setClearedFor] = useState(entityId);
  // After a successful save, clear the numbers but keep the date and account
  // so the next platform for the same day is quick to log.
  if (status === "success" && entityId !== clearedFor) {
    setClearedFor(entityId);
    setValues({});
  }
  // The owner's own day until they pick one; the server's is UTC, already tomorrow on a US evening.
  const localToday = useLocalDay();
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? localToday ?? today;
  // "Add to them, or replace them?" only for numbers this form sent and still
  // holds: a question about numbers since changed is dropped, and one for a
  // save sent before the tab was reopened (its boxes are empty now) becomes a note.
  const [dismissed, setDismissed] = useState(entityId);
  const [sentHere, setSentHere] = useState(false);
  const asking = code === "existing" && sentHere && entityId !== dismissed;
  const [answer, setAnswer] = useState<"add" | "replace" | null>(null);
  // Submitting through onSubmit (not the form action prop) stops React from
  // resetting the date and account after a rejected save; a corrected retry
  // must never land on today's date or the main account by accident.
  const send = (form: HTMLFormElement | null, choice: "add" | "replace" | null) => {
    if (!form || sampleMode || !form.reportValidity()) return;
    const formData = new FormData(form);
    if (choice) formData.set("onExisting", choice);
    setAnswer(choice);
    setSentHere(true);
    startTransition(() => action(formData));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(event.currentTarget, null);
  };
  const payload = fields.flatMap((field) => {
    const raw = values[field.key]?.trim().replaceAll(",", "");
    if (!raw) return [];
    const number = Number(raw);
    if (!Number.isFinite(number)) return [];
    return [{ metricKey: field.key, value: field.unit === "currency_cents" ? Math.round(number * 100) : number }];
  });
  const input = (field: MetricDefinition) => <label className="admin-field" key={field.key}>
    <span>{shortMetricLabel(field.label)}{field.unit === "currency_cents" ? " ($)" : ""}</span>
    <input inputMode="decimal" min="0" onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} step={field.unit === "hours" || field.unit === "currency_cents" ? "0.01" : "1"} title={field.description} type="number" value={values[field.key] ?? ""} />
  </label>;
  const totals = fields.filter((field) => field.aggregation === "last");
  const activity = fields.filter((field) => field.aggregation !== "last");
  // The server checks the day's totals; this catches a slip in what was just typed.
  const callsWarning = coldCallAnswersProblem(new Map(payload.map((item) => [item.metricKey, item.value])), date || today, localToday ?? today);
  const shown = code !== "existing" || asking ? message : sentHere ? "" : UNSAVED_NOTE;
  return <form onChange={() => { if (asking) setDismissed(entityId); }} onSubmit={submit}>
    <input name="values" type="hidden" value={JSON.stringify(payload)} />
    {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
    <div className="admin-trend-log-context">
      <label className="admin-field"><span>Date</span><input max={localToday && localToday > today ? localToday : today} name="date" onChange={(event) => setPicked(event.target.value)} required type="date" value={date} /></label>
      {accounts ? <label className="admin-field"><span>Account</span>
        <select name={account === NEW_ACCOUNT ? undefined : "dimension"} onChange={(event) => setAccount(event.target.value)} value={account}>
          <option value="">Main account</option>
          {accounts.map((key) => <option key={key} value={key}>{key}</option>)}
          <option value={NEW_ACCOUNT}>Add another account…</option>
        </select>
        {/* A blank handle would quietly save to the main account. */}
        {account === NEW_ACCOUNT ? <input aria-label="New account handle" autoFocus maxLength={80} name="dimension" pattern=".*\S.*" placeholder="@handle" required title="Enter a handle, like @ajaniflow" /> : null}
        <small>{account === NEW_ACCOUNT ? "Only for a second profile or page. Your main account is already tracked." : "Pick the same account every time so totals are never counted twice."}</small>
      </label> : <input name="dimension" type="hidden" value="" />}
    </div>
    {totals.length ? <fieldset className="admin-trend-log-group"><legend>Totals shown today</legend><p>We keep the latest until you log a newer one.</p><div>{totals.map(input)}</div></fieldset> : null}
    {activity.length ? <fieldset className="admin-trend-log-group"><legend>Activity</legend><p>For this day, or the days since you last logged it.</p><div>{activity.map(input)}</div></fieldset> : null}
    <div className="admin-form-footer admin-trend-log-foot">
      <div>
        {shown ? <p className={`admin-form-message ${asking ? "question" : status}`} role="status">{shown}</p> : null}
        {callsWarning && !sampleMode ? <p className="admin-form-message warning" role="status">{callsWarning}</p> : null}
        {sampleMode ? <p className="admin-trend-sample-note">{SAMPLE_NOTE}</p> : asking ? <p>Or change the numbers and save again.</p> : <p>Leave a box blank to skip it. If the day already has numbers, you choose to add to them or replace them.</p>}
        {!sampleMode && !payload.length ? <p id="log-save-hint">Type at least one number to save.</p> : null}
      </div>
      {/* Plain buttons, not submit buttons: pressing Enter in a box must never pick add or replace. */}
      {asking ? <div className="admin-trend-log-choice">
        <button className="primary" disabled={sampleMode || pending} onClick={(event) => send(event.currentTarget.form, "add")} type="button">{pending && answer === "add" ? "Adding…" : "Add to them"}</button>
        <button disabled={sampleMode || pending} onClick={(event) => send(event.currentTarget.form, "replace")} type="button">{pending && answer === "replace" ? "Replacing…" : "Replace them"}</button>
      </div> : <button aria-describedby={!sampleMode && !payload.length ? "log-save-hint" : undefined} disabled={sampleMode || pending || !payload.length} type="submit">{pending ? "Saving…" : "Save numbers"}<b aria-hidden="true">→</b></button>}
    </div>
  </form>;
}

function RecentEntries({ entries, definitions, sampleMode, today }: { entries: MetricCatalog["recentEntries"]; definitions: Map<string, MetricDefinition>; sampleMode: boolean; today: string }) {
  if (!entries.length) return null;
  const shown = entries.slice(0, 12);
  return <details className="admin-trend-recent">
    <summary>Recently logged ({shown.length})</summary>
    <ul>{shown.map((entry) => {
      const definition = definitions.get(entry.metricKey);
      const label = definition?.label ?? entry.metricKey;
      const account = entry.dimension || "Main account";
      return <li key={`${entry.metricKey}:${entry.date}:${entry.dimension}`}>
        <time dateTime={entry.date}>{entryDayLabel(entry.date, today)}</time>
        <p><b>{label}</b><span>{account}</span></p>
        <strong>{formatMetricValue(entry.value, definition?.unit ?? "count")}</strong>
        <RemoveEntry date={entry.date} description={`${label}, ${account}, ${bucketLabel(entry.date, "day")}`} dimension={entry.dimension} metricKey={entry.metricKey} sampleMode={sampleMode} />
      </li>;
    })}</ul>
  </details>;
}

/** Two steps, like voiding a batch: Remove, then confirm or keep. */
function RemoveEntry({ metricKey, date, dimension, description, sampleMode }: { metricKey: string; date: string; dimension: string; description: string; sampleMode: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteValue, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  return <form action={action} className="admin-trend-confirm">
    <input name="metricKey" type="hidden" value={metricKey} />
    <input name="date" type="hidden" value={date} />
    <input name="dimension" type="hidden" value={dimension} />
    {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
    {confirming && !sampleMode ? <>
      <span>Remove this number?</span>
      <button aria-label={`Yes, remove ${description}`} className="danger" disabled={pending} type="submit">{pending ? "Removing…" : "Remove"}</button>
      <button autoFocus disabled={pending} onClick={() => setConfirming(false)} type="button">Keep</button>
    </> : <button aria-label={`Remove ${description}`} disabled={sampleMode} onClick={() => setConfirming(true)} title={sampleMode ? "Sample data is on, so nothing can be removed." : undefined} type="button">Remove</button>}
    {state.status === "error" ? <p className="admin-form-message error" role="status">{state.message}</p> : null}
  </form>;
}
