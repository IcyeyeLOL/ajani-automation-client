"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveReportValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { bucketLabel, formatMetricValue } from "@/lib/admin/metric-query";

type Row = { metricKey: string; label: string; date: string; value: number; evidence: string };
type Note = { item: string; reason: string };
type ReadResult = { platform: string; reportDate: string | null; rows: Row[]; notUsed: Note[]; dropped: Note[] };

const SAMPLE_NOTE = "Sample data is on, so reports can't be imported. Switch to real data first.";

/** What to ask Muse so the report has day-by-day numbers the charts can use. */
export const MUSE_PROMPT = `Pull my Instagram numbers for @ajani_automation as a day-by-day table I can download as a CSV spreadsheet. Cover the last 30 days, ending yesterday.

1. One row per day, oldest first, with exactly these columns:
date (YYYY-MM-DD), followers (total at the end of that day), reach (accounts reached that day), views, interactions (total content interactions), likes, comments, shares, saves, profile_visits, link_taps (taps on links in my profile), contact_taps (taps on call, email, text and address buttons), posts_published (posts and reels published that day)

2. Exact numbers from Instagram only. Where Instagram only gives a total for a period, ask it for each day as its own one-day period. If a number isn't available for a day, leave that cell blank. Don't estimate, don't read numbers off a chart, and don't split a weekly or monthly total into days.

3. Tell me which time zone the days use.

4. Below the table, give today's follower count and the date and time you read it.

5. Put any 7-day, 30-day or 90-day totals in a separate small table labelled "Totals", not in the daily table.`;

export function ReportImport({ platform, platformLabel, sampleMode }: { platform: string; platformLabel: string; sampleMode: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [result, setResult] = useState<ReadResult | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [state, action, saving] = useActionState(saveReportValuesAction, initialAdminActionState);
  const [savedToken, setSavedToken] = useState(state.entityId);

  if (state.status === "success" && state.entityId !== savedToken) {
    setSavedToken(state.entityId);
    setResult(null);
    setFile(null);
  }
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);

  const keyOf = (row: Row) => `${row.metricKey}|${row.date}`;
  const chosen = result?.rows.filter((row) => !skipped.has(keyOf(row))) ?? [];
  const days = new Set(chosen.map((row) => row.date)).size;

  async function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || sampleMode) return;
    setReading(true);
    setReadError("");
    setResult(null);
    setSkipped(new Set());
    try {
      const body = new FormData();
      body.set("platform", platform);
      body.set("file", file);
      const response = await fetch("/admin/reports/read", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) setReadError(payload?.error ?? "The report could not be read. Try again.");
      else setResult(payload as ReadResult);
    } catch {
      setReadError("The report could not be sent. Check your connection and try again.");
    } finally {
      setReading(false);
    }
  }

  function toggle(row: Row) {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(keyOf(row))) next.delete(keyOf(row));
      else next.add(keyOf(row));
      return next;
    });
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(MUSE_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return <section aria-labelledby="report-import-title" className="admin-report-import">
    <header>
      <h3 id="report-import-title">Import a report</h3>
      <p>Upload a report from Muse, an export from {platformLabel} or a screenshot. An agent reads the day-by-day numbers, you check them, then save.</p>
    </header>

    <form className="admin-report-pick" onSubmit={read}>
      <label className="admin-field">
        <span>Report file</span>
        <input accept=".pdf,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,text/csv,text/plain,image/png,image/jpeg,image/webp" disabled={sampleMode || reading} name="file" onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setReadError(""); }} type="file" />
        <small>PDF, CSV, text or a screenshot, up to 4 MB. The file itself is not kept.</small>
      </label>
      <button disabled={sampleMode || reading || !file} type="submit">{reading ? "Reading the report…" : "Read the report"}<b aria-hidden="true">→</b></button>
    </form>
    {sampleMode ? <p className="admin-trend-sample-note">{SAMPLE_NOTE}</p> : null}
    {reading ? <p className="admin-form-message" role="status">This takes up to a minute.</p> : null}
    {readError ? <p className="admin-form-message error" role="alert">{readError}</p> : null}

    {result ? <div className="admin-report-review">
      {result.rows.length ? <>
        <p className="admin-report-summary"><b>Found {result.rows.length} daily {result.rows.length === 1 ? "number" : "numbers"}</b>{result.reportDate ? <span> in a report dated {bucketLabel(result.reportDate, "day")}</span> : null}. Untick anything that looks wrong before saving.</p>
        <div className="admin-metric-table-wrap">
          <table className="admin-trend-table admin-report-table">
            <thead><tr><th scope="col">Keep</th><th scope="col">Metric</th><th scope="col">Day</th><th scope="col">Number</th><th scope="col">Where it came from</th></tr></thead>
            <tbody>{result.rows.map((row) => <tr className={skipped.has(keyOf(row)) ? "skipped" : undefined} key={keyOf(row)}>
              <td><input aria-label={`Keep ${row.label} on ${bucketLabel(row.date, "day")}`} checked={!skipped.has(keyOf(row))} onChange={() => toggle(row)} type="checkbox" /></td>
              <th scope="row">{row.label}</th>
              <td><time dateTime={row.date}>{bucketLabel(row.date, "day")}</time></td>
              <td>{formatMetricValue(row.value, "count")}</td>
              <td className="evidence">{row.evidence}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </> : <p className="admin-report-summary"><b>No daily numbers found.</b> This report only has totals for whole periods, which can&apos;t go on a day-by-day chart. Ask Muse for a daily table (below) and upload that.</p>}

      {result.notUsed.length || result.dropped.length ? <details className="admin-trend-recent">
        <summary>Not imported ({result.notUsed.length + result.dropped.length})</summary>
        <ul className="admin-report-notes">{[...result.dropped, ...result.notUsed].map((note, index) => <li key={`${index}:${note.item}`}><b>{note.item}</b><span>{note.reason}</span></li>)}</ul>
      </details> : null}

      {result.rows.length ? <form action={action} className="admin-form-footer admin-trend-log-foot">
        <input name="platform" type="hidden" value={result.platform} />
        <input name="rows" type="hidden" value={JSON.stringify(chosen.map(({ metricKey, date, value }) => ({ metricKey, date, value })))} />
        {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
        <div>
          <p>Saving a day that already has a number replaces it.</p>
          {state.status === "error" ? <p className="admin-form-message error" role="alert">{state.message}</p> : null}
        </div>
        <button disabled={sampleMode || saving || !chosen.length} type="submit">{saving ? "Saving…" : `Save ${chosen.length} ${chosen.length === 1 ? "number" : "numbers"} (${days} ${days === 1 ? "day" : "days"})`}<b aria-hidden="true">→</b></button>
      </form> : null}
    </div> : null}
    {state.status === "success" ? <p className="admin-form-message success" role="status">{state.message}</p> : null}

    <details className="admin-trend-recent admin-report-prompt">
      <summary>What to ask Muse</summary>
      <p>Paste this into Muse, then upload the table it sends back. Day-by-day numbers are what the charts need.</p>
      <pre>{MUSE_PROMPT}</pre>
      <button onClick={copyPrompt} type="button">{copied ? "Copied" : "Copy the prompt"}</button>
    </details>
  </section>;
}
