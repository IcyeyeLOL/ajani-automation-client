"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { deleteMetricValueAction, recordMetricValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { bucketLabel, formatMetricValue, shortMetricLabel } from "@/lib/admin/metric-query";
import type { TrendViewId } from "@/lib/admin/metric-query";
import type { MetricCatalog, MetricDefinition } from "@/lib/admin/metric-types";

const NEW_ACCOUNT = "__new_account__";
const SAMPLE_NOTE = "Sample data is on, so nothing can be saved. Switch to real data to log numbers.";

// Goal numbers first, then platforms in the order the owner uses them. A tab
// shows only while the catalog has active manual metrics for it.
export const entryGroups: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "revenue", label: "Sales & revenue", sources: ["sales", "revenue"] },
  { id: "linkedin", label: "LinkedIn", sources: ["linkedin"] },
  { id: "instagram", label: "Instagram", sources: ["instagram"] },
  { id: "youtube", label: "YouTube", sources: ["youtube"] },
  { id: "tiktok", label: "TikTok", sources: ["tiktok"] },
  { id: "reddit", label: "Reddit", sources: ["reddit"] },
  { id: "x", label: "X", sources: ["x"] },
];

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
  const groupFor = (sources: string[] | null) => groups.find((item) => sources?.some((source) => item.sources.includes(source))) ?? groups[0];
  const [open, setOpen] = useState(request.token > 0);
  const [groupId, setGroupId] = useState(() => groupFor(request.sources ?? viewSources)?.id ?? "");
  const [handled, setHandled] = useState(request.token);
  if (request.token !== handled) {
    setHandled(request.token);
    setOpen(true);
    setGroupId(groupFor(request.sources ?? viewSources)?.id ?? "");
  }
  const [state, action, pending] = useActionState(recordMetricValuesAction, initialAdminActionState);
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  const fields = group ? catalog.metrics.filter((metric) => metric.entryMode === "manual" && group.sources.includes(metric.source)) : [];
  // Sales and revenue belong to the business, not to a platform account.
  const accounts = group?.id === "revenue" ? null : [...new Set(fields.flatMap((field) => field.dimensions))].sort();

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
      {viewId === "outreach" && onNavigate ? <p className="admin-trend-log-pointer">Outreach batches are logged under <button className="admin-trend-link" onClick={() => onNavigate("outreach")} type="button">Outreach →</button></p> : null}
      <div aria-label="Platform" className="admin-trend-chips small" role="group">
        {groups.map((item) => <button aria-pressed={item.id === group?.id} key={item.id} onClick={() => setGroupId(item.id)} type="button">{item.label}</button>)}
      </div>
      {group ? <EntryForm accounts={accounts} action={action} entityId={state.entityId} fields={fields} key={group.id} message={state.message} pending={pending} sampleMode={sampleMode} status={state.status} today={catalog.today} /> : null}
      <RecentEntries definitions={definitions} entries={catalog.recentEntries} sampleMode={sampleMode} />
    </div>
  </details>;
}

function EntryForm({ accounts, action, entityId, fields, today, pending, status, message, sampleMode }: { accounts: string[] | null; action: (formData: FormData) => void; entityId?: string; fields: MetricDefinition[]; today: string; pending: boolean; status: string; message: string; sampleMode: boolean }) {
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
  // Submitting through onSubmit (not the form action prop) stops React from
  // resetting the date and account after a rejected save; a corrected retry
  // must never land on today's date or the main account by accident.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sampleMode) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
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
  return <form onSubmit={submit}>
    <input name="values" type="hidden" value={JSON.stringify(payload)} />
    {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
    <div className="admin-trend-log-context">
      <label className="admin-field"><span>Date</span><input defaultValue={today} max={today} name="date" required type="date" /></label>
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
        {message ? <p className={`admin-form-message ${status}`} role="status">{message}</p> : null}
        {sampleMode ? <p className="admin-trend-sample-note">{SAMPLE_NOTE}</p> : <p>Leave a box blank to skip it. Logging the same day again replaces it.</p>}
        {!sampleMode && !payload.length ? <p id="log-save-hint">Type at least one number to save.</p> : null}
      </div>
      <button aria-describedby={!sampleMode && !payload.length ? "log-save-hint" : undefined} disabled={sampleMode || pending || !payload.length} type="submit">{pending ? "Saving…" : "Save numbers"}<b aria-hidden="true">→</b></button>
    </div>
  </form>;
}

function RecentEntries({ entries, definitions, sampleMode }: { entries: MetricCatalog["recentEntries"]; definitions: Map<string, MetricDefinition>; sampleMode: boolean }) {
  if (!entries.length) return null;
  const shown = entries.slice(0, 12);
  return <details className="admin-trend-recent">
    <summary>Recently logged ({shown.length})</summary>
    <ul>{shown.map((entry) => {
      const definition = definitions.get(entry.metricKey);
      const label = definition?.label ?? entry.metricKey;
      const account = entry.dimension || "Main account";
      return <li key={`${entry.metricKey}:${entry.date}:${entry.dimension}`}>
        <time dateTime={entry.date}>{bucketLabel(entry.date, "day", "axis")}</time>
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
  const [state, action, pending] = useActionState(deleteMetricValueAction, initialAdminActionState);
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
