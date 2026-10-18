"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveReportValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { bucketLabel, formatMetricValue } from "@/lib/admin/metric-query";
import { mergeReports, REPORT_FILE_MAX_BYTES, REPORT_MAX_FILES, type MergedReportRow, type MergedReports, type ReportReadResult } from "@/lib/admin/report-merge";

type Row = MergedReportRow;
type FileProblem = { file: string; message: string };
type ReadOutcome = { result: ReportReadResult; error?: undefined } | { result?: undefined; error: string };

const SAMPLE_NOTE = "Sample data is on, so files can't be imported. Switch to real data first.";
/** Files read in parallel; each read is one request (and, for anything but a daily spreadsheet, one model call). */
const READS_AT_ONCE = 3;

/** What to ask Muse so its answer is a daily spreadsheet the importer reads exactly, without AI. */
export const MUSE_PROMPT = `Pull my Instagram numbers for @ajani_automation as a day-by-day table I can download as a CSV file named instagram-daily.csv. Cover the last 30 days, ending yesterday.

1. One row per day, oldest first, with exactly these columns:
date (YYYY-MM-DD), followers (total at the end of that day), reach (accounts reached that day), views, interactions (total content interactions), likes, comments, shares, saves, profile_visits, link_taps (taps on links in my profile), contact_taps (taps on call, email, text and address buttons), posts_published (posts and reels published that day)

2. Exact numbers from Instagram only. Where Instagram only gives a total for a period, ask it for each day as its own one-day period. If a number isn't available for a day, leave that cell blank. Don't estimate, don't read numbers off a chart, and don't split a weekly or monthly total into days.

3. Tell me which time zone the days use.

4. Below the table, give today's follower count and the date and time you read it.

5. Put any 7-day, 30-day or 90-day totals in a separate file, not in the daily table.`;

async function readReport(file: File): Promise<ReadOutcome> {
  try {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/admin/reports/read", { method: "POST", body });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) return { error: payload?.error ?? "This file could not be read. Try again." };
    return { result: payload as ReportReadResult };
  } catch {
    return { error: "This file could not be sent. Check your connection and try again." };
  }
}

/** Upload analytics files about any platform, sales or revenue; review what was read; save. */
export function ReportImport({ sampleMode }: { sampleMode: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState("");
  const [problems, setProblems] = useState<FileProblem[]>([]);
  const [result, setResult] = useState<MergedReports | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [state, action, saving] = useActionState(saveReportValuesAction, initialAdminActionState);
  const [savedToken, setSavedToken] = useState(state.entityId);
  const reading = progress !== null;

  if (state.status === "success" && state.entityId !== savedToken) {
    setSavedToken(state.entityId);
    setResult(null);
    setFiles([]);
    setProblems([]);
    setInputKey((key) => key + 1);
  }
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);

  const keyOf = (row: Row) => `${row.metricKey}|${row.date}`;
  const chosen = result?.rows.filter((row) => !skipped.has(keyOf(row))) ?? [];
  const days = new Set(chosen.map((row) => row.date)).size;
  const multi = (result?.files.length ?? 0) > 1;

  function pick(list: FileList | null) {
    const picked = Array.from(list ?? []);
    setReadError("");
    setProblems([]);
    if (picked.length > REPORT_MAX_FILES) {
      setFiles([]);
      setReadError(`Pick up to ${REPORT_MAX_FILES} files at a time.`);
      return;
    }
    setFiles(picked);
  }

  async function readFiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || sampleMode || reading) return;
    setReadError("");
    setProblems([]);
    setResult(null);
    setSkipped(new Set());
    const tooBig = files.filter((file) => file.size > REPORT_FILE_MAX_BYTES);
    const queue = files.map((file, index) => ({ file, index })).filter(({ file }) => file.size <= REPORT_FILE_MAX_BYTES);
    const outcomes: Array<ReadOutcome & { index: number; file: string }> = [];
    setProgress({ done: 0, total: queue.length });
    await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        outcomes.push({ index: next.index, file: next.file.name, ...await readReport(next.file) });
        setProgress((current) => current && { ...current, done: current.done + 1 });
      }
    }));
    outcomes.sort((a, b) => a.index - b.index);
    const reads = outcomes.flatMap((outcome) => outcome.result ? [{ file: outcome.file, result: outcome.result }] : []);
    const failed: FileProblem[] = [
      ...tooBig.map((file) => ({ file: file.name, message: "Larger than 4 MB, so it was not read." })),
      ...outcomes.flatMap((outcome) => outcome.error ? [{ file: outcome.file, message: outcome.error }] : []),
    ];
    setProgress(null);
    if (files.length === 1 && failed.length) setReadError(failed[0].message);
    else setProblems(failed);
    if (reads.length) setResult(mergeReports(reads));
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

  return <section aria-label="Import numbers from files" className="admin-report-import">
    <p className="admin-report-intro">Muse reports, exports from Instagram, YouTube, LinkedIn or Reddit, screenshots, and sales or revenue sheets. Day-by-day spreadsheets are read column by column; anything else is read by the AI agent. You check every number before it&apos;s saved.</p>

    <form className="admin-report-pick" onSubmit={readFiles}>
      <label className="admin-field">
        <span>Files</span>
        <input accept=".pdf,.csv,.tsv,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,text/csv,text/tab-separated-values,text/plain,image/png,image/jpeg,image/webp" disabled={sampleMode || reading} key={inputKey} multiple name="file" onChange={(event) => pick(event.currentTarget.files)} type="file" />
        <small>PDF, CSV, text or screenshots: up to {REPORT_MAX_FILES} files at a time, 4 MB each. The files themselves are not kept.</small>
      </label>
      <button disabled={sampleMode || reading || !files.length} type="submit">{progress
        ? progress.total > 1 ? `Reading files (${progress.done} of ${progress.total} done)…` : "Reading the file…"
        : files.length > 1 ? `Read ${files.length} files` : "Read the file"}<b aria-hidden="true">→</b></button>
    </form>
    {sampleMode ? <p className="admin-trend-sample-note">{SAMPLE_NOTE}</p> : null}
    {reading ? <p className="admin-form-message" role="status">{files.length > 1 ? `Spreadsheets take a second; anything the AI agent reads takes up to a minute. ${READS_AT_ONCE} files are read at once.` : "Spreadsheets take a second; anything the AI agent reads takes up to a minute."}</p> : null}
    {readError ? <p className="admin-form-message error" role="alert">{readError}</p> : null}
    {problems.length ? <ul aria-label="Files that were not read" className="admin-report-problems" role="alert">{problems.map((problem, index) => <li key={`${index}:${problem.file}`}><b>{problem.file}</b><span>{problem.message}</span></li>)}</ul> : null}

    {result ? <div className="admin-report-review">
      {result.notes.length ? <ul aria-label="What the reader found" className="admin-report-voice">{result.notes.map((note, index) => <li key={`${index}:${note.file}`}>
        <b>{multi ? note.file : note.method === "table" ? "Read from the spreadsheet" : "The AI agent says"}</b>
        <span>{note.note}</span>
      </li>)}</ul> : null}
      {result.rows.length ? <>
        <p className="admin-report-summary"><b>Found {result.rows.length} daily {result.rows.length === 1 ? "number" : "numbers"}</b>{multi ? <span> in {result.files.length} files</span> : result.reportDate ? <span> in a report dated {bucketLabel(result.reportDate, "day")}</span> : null}. Untick anything that looks wrong before saving.</p>
        <div className="admin-metric-table-wrap">
          <table className="admin-trend-table admin-report-table">
            <thead><tr><th scope="col">Keep</th><th scope="col">Metric</th><th scope="col">Day</th><th scope="col">Number</th><th scope="col">Where it came from</th></tr></thead>
            <tbody>{result.rows.map((row) => <tr className={skipped.has(keyOf(row)) ? "skipped" : undefined} key={keyOf(row)}>
              <td><input aria-label={`Keep ${row.label} on ${bucketLabel(row.date, "day")}`} checked={!skipped.has(keyOf(row))} onChange={() => toggle(row)} type="checkbox" /></td>
              <th scope="row">{row.label}</th>
              <td><time dateTime={row.date}>{bucketLabel(row.date, "day")}</time></td>
              <td>{formatMetricValue(row.value, row.unit)}</td>
              <td className="evidence">{multi ? <small>{row.file}</small> : null}{row.evidence}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </> : <p className="admin-report-summary"><b>No daily numbers found.</b> {multi ? "These files only have" : "This file only has"} totals for whole periods, or numbers the charts don&apos;t track. Charts need one number per day.</p>}

      {result.notUsed.length || result.dropped.length ? <details className="admin-trend-recent">
        <summary>Not imported ({result.notUsed.length + result.dropped.length})</summary>
        <ul className="admin-report-notes">{[...result.dropped, ...result.notUsed].map((note, index) => <li key={`${index}:${note.item}`}><b>{note.item}</b><span>{multi && note.file ? `${note.file}: ` : ""}{note.reason}</span></li>)}</ul>
      </details> : null}

      {result.rows.length ? <form action={action} className="admin-form-footer admin-trend-log-foot">
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
      <p>Paste this into Muse, then upload the daily CSV it gives back. Day-by-day numbers are what the charts need.</p>
      <pre>{MUSE_PROMPT}</pre>
      <button onClick={copyPrompt} type="button">{copied ? "Copied" : "Copy the prompt"}</button>
    </details>
  </section>;
}
