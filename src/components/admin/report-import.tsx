"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveReportValuesAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { bucketLabel, formatMetricValue, rangeLabel } from "@/lib/admin/metric-query";
import { flagRows, planImport, removalKeys, type PlanMetric, type PlannedRow, type RemovalProposal, type SavedValue } from "@/lib/admin/report-diff";
import {
  answeredRows, mergeReports, REPORT_FILE_MAX_BYTES, REPORT_MAX_FILES,
  type MergedQuestion, type MergedReportRow, type MergedReports, type ReportReadResult,
} from "@/lib/admin/report-merge";
import { conclusionFacts, digestRows, type SourceDigest } from "@/lib/admin/report-summary";
import { adminFetch, withRenewedSignIn } from "@/lib/admin/fresh-session";

// The save renews the sign-in first (see fresh-session.ts).
const saveReportValues = withRenewedSignIn(saveReportValuesAction);

type FileProblem = { file: string; message: string };
type ReadOutcome = { result: ReportReadResult; today: string; error?: undefined } | { result?: undefined; today?: undefined; error: string };
type Comparison = { status: "ready" | "failed"; saved: SavedValue[]; metrics: Map<string, PlanMetric> };
type Conclusion = { status: "idle" | "loading" | "ready" | "failed"; note: string | null; cautions: string[] };

const SAMPLE_NOTE = "Sample data is on, so files can't be imported. Switch to real data first.";
/** Files read in parallel; each read is one request (and, for anything but a plain spreadsheet, one model call). */
const READS_AT_ONCE = 3;
/** Above this many rows the full table starts folded away; the breakdown and flagged rows stay in view. */
const OPEN_TABLE_ROWS = 40;
const NO_COMPARISON: Comparison = { status: "failed", saved: [], metrics: new Map() };
const NO_CONCLUSION: Conclusion = { status: "idle", note: null, cautions: [] };
const DECIDED_BY: Record<string, string> = {
  "platform column": "Platform from the file's platform column",
  heading: "Platform from the heading above the table",
  "file name": "Platform from the file name",
  columns: "Platform worked out from columns only it has",
  you: "Platform you picked",
};

/** What to ask Muse so its answer is a daily spreadsheet the importer reads exactly, without AI. */
export const MUSE_PROMPT = `Pull my Instagram numbers for @ajani_automation as a day-by-day table I can download as a CSV file named instagram-daily.csv. Cover the last 30 days, ending yesterday.

1. One row per day, oldest first, with exactly these columns:
date (YYYY-MM-DD), followers (total at the end of that day), reach (accounts reached that day), views, interactions (total content interactions), likes, comments, shares, saves, profile_visits, link_taps (taps on links in my profile), contact_taps (taps on call, email, text and address buttons), posts_published (posts and reels published that day)

2. Exact numbers from Instagram only. Where Instagram only gives a total for a period, ask it for each day as its own one-day period. If a number isn't available for a day, leave that cell blank. Don't estimate, don't read numbers off a chart, and don't split a weekly or monthly total into days.

3. Tell me which time zone the days use.

4. Below the table, give today's follower count and the date and time you read it.

5. Put any 7-day, 30-day or 90-day totals in a separate file, not in the daily table.

If you also have LinkedIn numbers, put them in the same file with a "platform" column saying instagram or linkedin on every row, so each row's numbers stay with their own platform.`;

async function readReport(file: File): Promise<ReadOutcome> {
  try {
    const body = new FormData();
    body.set("file", file);
    const response = await adminFetch("/admin/reports/read", { method: "POST", body });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) return { error: payload?.error ?? "This file could not be read. Try again." };
    return { result: payload as ReportReadResult, today: String(payload.today) };
  } catch {
    return { error: "This file could not be sent. Check your connection and try again." };
  }
}

async function loadComparison(merged: MergedReports): Promise<Comparison> {
  const keys = [...new Set([...merged.rows.map((row) => row.metricKey), ...merged.questions.flatMap((question) => question.choices.map((choice) => choice.metricKey))])];
  const dates = [...merged.rows.map((row) => row.date), ...merged.questions.flatMap((question) => question.cells.map((cell) => cell.date))].sort();
  if (!keys.length || !dates.length) return { status: "ready", saved: [], metrics: new Map() };
  try {
    const response = await adminFetch("/admin/reports/saved", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: keys.slice(0, 200), from: dates[0], to: dates[dates.length - 1] }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) return NO_COMPARISON;
    return { status: "ready", saved: payload.saved as SavedValue[], metrics: new Map(Object.entries(payload.metrics as Record<string, PlanMetric>)) };
  } catch {
    return NO_COMPARISON;
  }
}

/** The review as it first appears: certain suggestions picked, every removal kept, flagged rows unticked. */
function firstReview(merged: MergedReports, comparison: Comparison, today: string) {
  const answers = new Map(merged.questions.flatMap((question) => question.suggestion?.certain ? [[question.key, question.suggestion.metricKey] as const] : []));
  const rows = [...merged.rows, ...answeredRows(merged, answers, today).rows];
  const { removals, rows: planned } = planImport(rows, comparison.saved, comparison.metrics);
  return { answers, removals, planned, kept: planned.filter((row) => row.change === "same" || !row.flags.length) };
}

function warningsFor(merged: MergedReports, removals: RemovalProposal[], planned: PlannedRow[]) {
  return [
    ...removals.map((proposal) => `Saved ${proposal.label} match ${proposal.copies.label} in this import, so they are probably ${proposal.copies.label} saved on the wrong platform. The review offers to remove them.`),
    ...(planned.some((row) => row.flags.length) ? ["Some numbers look wrong next to the saved ones and wait for the owner's check."] : []),
    ...(merged.questions.length ? ["Some columns wait for the owner to say what they are, so they aren't in these facts."] : []),
    ...merged.groups.flatMap((group) => group.source && group.blank.length ? [`${group.label}'s rows leave ${group.blank.join(", ")} blank, so those charts get nothing from this import.`] : []),
  ].slice(0, 8);
}

async function loadConclusion(digests: SourceDigest[], warnings: string[]): Promise<Conclusion> {
  const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
  const facts = conclusionFacts(digests).map((fact) => ({ ...fact, text: clip(fact.text, 160), value: clip(fact.value, 60) }));
  if (facts.length < 3) return NO_CONCLUSION;
  try {
    const response = await adminFetch("/admin/reports/conclude", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts, warnings: warnings.map((warning) => clip(warning, 240)) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) return { status: "failed", note: null, cautions: [] };
    return { status: "ready", note: typeof payload.note === "string" ? payload.note : null, cautions: Array.isArray(payload.cautions) ? payload.cautions.map(String) : [] };
  } catch {
    return { status: "failed", note: null, cautions: [] };
  }
}

const rowKey = (row: { metricKey: string; date: string }) => `${row.metricKey}|${row.date}`;
const day = (date: string) => bucketLabel(date, "day");
const span = (dates: string[]) => dates.length === 1 ? day(dates[0]) : rangeLabel(dates[0], dates[dates.length - 1]);

/** Upload analytics files about any platform, cold calls, sales or revenue; review the breakdown and every change; save. */
export function ReportImport({ sampleMode }: { sampleMode: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState("");
  const [problems, setProblems] = useState<FileProblem[]>([]);
  const [merged, setMerged] = useState<MergedReports | null>(null);
  const [today, setToday] = useState("");
  const [comparison, setComparison] = useState<Comparison>(NO_COMPARISON);
  const [conclusion, setConclusion] = useState<Conclusion>(NO_CONCLUSION);
  const [answers, setAnswers] = useState<Map<string, string>>(new Map());
  const [skippedRemovals, setSkippedRemovals] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Map<string, boolean>>(new Map());
  const [copied, setCopied] = useState(false);
  const [state, action, saving] = useActionState(saveReportValues, initialAdminActionState);
  const [savedToken, setSavedToken] = useState(state.entityId);
  const readCount = useRef(0);
  const reading = progress !== null;

  if (state.status === "success" && state.entityId !== savedToken) {
    setSavedToken(state.entityId);
    setMerged(null);
    setFiles([]);
    setProblems([]);
    setInputKey((key) => key + 1);
  }
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);

  const review = useMemo(() => {
    if (!merged) return null;
    const answered = answeredRows(merged, answers, today);
    const rows: MergedReportRow[] = [...merged.rows, ...answered.rows];
    const { removals } = planImport(rows, comparison.saved, comparison.metrics);
    const kept = removals.filter((proposal) => !skippedRemovals.has(proposal.id));
    const planned = flagRows(rows, comparison.saved, removalKeys(kept));
    const keep = (row: PlannedRow) => row.change !== "same" && (choices.get(rowKey(row)) ?? !row.flags.length);
    const toSave = planned.filter(keep);
    return {
      answered, removals, kept, planned, keep, toSave,
      changing: planned.filter((row) => row.change !== "same"),
      flagged: planned.filter((row) => row.change !== "same" && row.flags.length),
      same: planned.filter((row) => row.change === "same").length,
      digests: digestRows(planned.filter((row) => row.change === "same" || keep(row))),
      removing: kept.flatMap((proposal) => proposal.rows.map((row) => ({ metricKey: proposal.metricKey, date: row.date, value: row.value }))),
    };
  }, [merged, answers, today, comparison, skippedRemovals, choices]);

  const multi = (merged?.files.length ?? 0) > 1;

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
    readCount.current += 1;
    const thisRead = readCount.current;
    setReadError("");
    setProblems([]);
    setMerged(null);
    setConclusion(NO_CONCLUSION);
    setAnswers(new Map());
    setSkippedRemovals(new Set());
    setChoices(new Map());
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
    if (files.length === 1 && failed.length) setReadError(failed[0].message);
    else setProblems(failed);
    if (!reads.length) { setProgress(null); return; }

    // Compared with the saved numbers before the review shows, so nothing appears unchecked.
    const combined = mergeReports(reads);
    const readOn = outcomes.find((outcome) => outcome.today)?.today ?? new Date().toISOString().slice(0, 10);
    const compared = await loadComparison(combined);
    const first = firstReview(combined, compared, readOn);
    setToday(readOn);
    setComparison(compared);
    setAnswers(first.answers);
    setMerged(combined);
    setProgress(null);
    // The AI agent's take arrives a few seconds after the review; the breakdown never waits for it,
    // and a take that arrives after another read has started is dropped.
    setConclusion({ ...NO_CONCLUSION, status: "loading" });
    const conclusion = await loadConclusion(digestRows(first.kept), warningsFor(combined, first.removals, first.planned));
    if (readCount.current === thisRead) setConclusion(conclusion);
  }

  function toggleRow(row: PlannedRow) {
    if (!review) return;
    setChoices((current) => new Map(current).set(rowKey(row), !review.keep(row)));
  }

  function setRows(rows: PlannedRow[], keep: boolean) {
    setChoices((current) => {
      const next = new Map(current);
      for (const row of rows) next.set(rowKey(row), keep);
      return next;
    });
  }

  function toggleRemoval(proposal: RemovalProposal) {
    setSkippedRemovals((current) => {
      const next = new Set(current);
      if (next.has(proposal.id)) next.delete(proposal.id);
      else next.add(proposal.id);
      return next;
    });
  }

  function answer(question: MergedQuestion, metricKey: string) {
    setAnswers((current) => {
      const next = new Map(current);
      if (metricKey) next.set(question.key, metricKey);
      else next.delete(question.key);
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

  const toSave = review?.toSave ?? [];
  const removing = review?.removing ?? [];
  const added = toSave.filter((row) => row.change === "new").length;
  const replaced = toSave.filter((row) => row.change === "replaces").length;
  const days = new Set(toSave.map((row) => row.date)).size;
  const notes = merged ? [...(review?.answered.dropped ?? []), ...merged.dropped, ...merged.notUsed] : [];

  return <section aria-label="Import numbers from files" className="admin-report-import">
    <p className="admin-report-intro">Muse reports, exports from Instagram, YouTube, LinkedIn or Reddit, cold-call logs, screenshots, and sales or revenue sheets. A file can mix platforms: each row&apos;s numbers stay on that row&apos;s platform. Spreadsheets are read cell by cell; the AI agent only helps with what code can&apos;t place. You check every number before it&apos;s saved.</p>

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

    {merged && review ? <div className="admin-report-review">
      {merged.notes.length ? <ul aria-label="What the reader found" className="admin-report-voice">{merged.notes.map((note, index) => <li key={`${index}:${note.file}`}>
        <b>{multi ? note.file : note.method === "table" ? "Read from the spreadsheet" : "The AI agent read this file"}</b>
        <span>{note.note}{note.agent === "unavailable" ? " The AI agent couldn't be reached, so anything that needed it is listed under Not imported." : ""}</span>
      </li>)}</ul> : null}

      <Findings conclusion={conclusion} digests={review.digests} groups={merged.groups} multi={multi} />

      {review.removals.length ? <section aria-label="Saved numbers that look wrong" className="admin-report-fixes">
        <h3>Saved numbers {multi ? "these files show" : "this file shows"} are wrong</h3>
        {review.removals.map((proposal) => {
          const values = proposal.rows.map((row) => row.value);
          const low = formatMetricValue(Math.min(...values), proposal.unit);
          const high = formatMetricValue(Math.max(...values), proposal.unit);
          return <label key={proposal.id}>
            <input checked={!skippedRemovals.has(proposal.id)} onChange={() => toggleRemoval(proposal)} type="checkbox" />
            <span>
              <b>Remove {proposal.rows.length} saved {proposal.label} ({span(proposal.rows.map((row) => row.date))})</b>
              They are saved as {low === high ? low : `${low}–${high}`}, which are exactly {multi ? "these files'" : "this file's"} {proposal.copies.label} for the same days, while {multi ? "they give" : "it gives"} no {proposal.label}. They were most likely saved on the wrong platform. Once removed, {proposal.label} show as not logged for those days until you log the real numbers. Each removal is recorded with its number.
            </span>
          </label>;
        })}
      </section> : null}

      {merged.questions.length ? <section aria-label="Columns that need your decision" className="admin-report-questions">
        <h3>{merged.questions.length === 1 ? "1 column needs" : `${merged.questions.length} columns need`} your decision</h3>
        {merged.questions.map((question) => {
          const total = question.cells.reduce((sum, cell) => sum + cell.value, 0);
          const suggested = question.suggestion && question.choices.find((choice) => choice.metricKey === question.suggestion!.metricKey);
          return <div className="admin-report-question" key={question.key}>
            <p><b>{question.platform ? `${question.platform} ` : ""}&ldquo;{question.header}&rdquo;</b> <span>{question.cells.length} {question.cells.length === 1 ? "day" : "days"}, {total.toLocaleString("en-US")} in total{multi ? ` · ${question.file}` : ""}</span></p>
            <p className="admin-report-why">{question.reason}{suggested ? ` The AI agent ${question.suggestion!.certain ? "says" : "thinks"} it's ${suggested.label}: ${question.suggestion!.reason}` : ""}</p>
            <label className="admin-field">
              <span>Use these numbers as</span>
              <select onChange={(event) => answer(question, event.currentTarget.value)} value={answers.get(question.key) ?? ""}>
                <option value="">Don&apos;t use them</option>
                {question.choices.map((choice) => <option key={choice.metricKey} value={choice.metricKey}>{choice.label}</option>)}
              </select>
            </label>
          </div>;
        })}
      </section> : null}

      {review.planned.length ? <>
        <p className="admin-report-summary">
          <b>{comparison.status === "ready"
            ? `Saving adds ${added} new ${added === 1 ? "number" : "numbers"}, changes ${replaced}${removing.length ? ` and removes ${removing.length}` : ""}.`
            : `Found ${review.planned.length} daily ${review.planned.length === 1 ? "number" : "numbers"}.`}</b>
          {comparison.status === "ready" && review.same ? ` ${review.same} ${review.same === 1 ? "is" : "are"} already saved and stay as they are.` : ""}
          {comparison.status === "failed" ? " The saved numbers couldn't be loaded, so this can't show what changes; saving still checks every number." : ""}
        </p>
        {review.flagged.length ? <div className="admin-report-flagged">
          <header>
            <h3>Check {review.flagged.length === 1 ? "this number" : `these ${review.flagged.length} numbers`} before saving</h3>
            {review.flagged.length > 1 ? <button onClick={() => setRows(review.flagged, !review.flagged.every(review.keep))} type="button">
              {review.flagged.every(review.keep) ? "Untick all" : `Tick all ${review.flagged.length}`}
            </button> : null}
          </header>
          <p>{review.flagged.length === 1 ? "It starts" : "They start"} unticked. Tick a number only if you know it&apos;s right.</p>
          <RowTable keep={review.keep} multi={multi} onToggle={toggleRow} rows={review.flagged} />
        </div> : null}
        {review.changing.length ? <details className="admin-trend-recent admin-report-all" open={review.changing.length <= OPEN_TABLE_ROWS}>
          <summary>New and changed numbers ({review.changing.length})</summary>
          <RowTable keep={review.keep} multi={multi} onToggle={toggleRow} rows={review.changing} />
        </details> : null}
        {review.same ? <details className="admin-trend-recent admin-report-all">
          <summary>Already saved ({review.same})</summary>
          <RowTable keep={review.keep} multi={multi} onToggle={toggleRow} rows={review.planned.filter((row) => row.change === "same")} />
        </details> : null}
      </> : <p className="admin-report-summary"><b>No daily numbers {merged.questions.length ? "yet" : "found"}.</b> {merged.questions.length
        ? "Answer the questions above to use those columns."
        : `${multi ? "These files only have" : "This file only has"} totals for whole periods, or numbers the charts don't track. Charts need one number per day.`}</p>}

      {notes.length ? <details className="admin-trend-recent">
        <summary>Not imported ({notes.length})</summary>
        <ul className="admin-report-notes">{notes.map((note, index) => <li key={`${index}:${note.item}`}><b>{note.item}</b><span>{multi && note.file ? `${note.file}: ` : ""}{note.reason}</span></li>)}</ul>
      </details> : null}

      {toSave.length || removing.length ? <form action={action} className="admin-form-footer admin-trend-log-foot">
        <input name="rows" type="hidden" value={JSON.stringify(toSave.map(({ metricKey, date, value }) => ({ metricKey, date, value })))} />
        <input name="confirmed" type="hidden" value={JSON.stringify(toSave.filter((row) => row.flags.length).map(rowKey))} />
        <input name="removals" type="hidden" value={JSON.stringify(removing)} />
        {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
        <div>
          <p>Saving a day that already has a number replaces it.{removing.length ? " Removed numbers are recorded, so they can be typed back in." : ""}</p>
          {state.status === "error" ? <p className="admin-form-message error" role="alert">{state.message}</p> : null}
        </div>
        <button disabled={sampleMode || saving} type="submit">{saving ? "Saving…" : saveLabel(toSave.length, days, removing.length)}<b aria-hidden="true">→</b></button>
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

function saveLabel(rows: number, days: number, removals: number) {
  if (rows && removals) return `Save ${rows} and remove ${removals}`;
  if (removals) return `Remove ${removals} wrong ${removals === 1 ? "number" : "numbers"}`;
  return `Save ${rows} ${rows === 1 ? "number" : "numbers"} (${days} ${days === 1 ? "day" : "days"})`;
}

/** Per platform: what the numbers add up to, how the reader knew the platform, and what it checked. */
function Findings({ conclusion, digests, groups, multi }: { conclusion: Conclusion; digests: SourceDigest[]; groups: MergedReports["groups"]; multi: boolean }) {
  const named = groups.filter((group) => group.source);
  const sources = [...new Set([...digests.map((digest) => digest.source), ...named.map((group) => group.source!)])];
  if (!sources.length) return null;
  return <section aria-label="What the files show" className="admin-report-findings">
    <h3>What {multi ? "these files show" : "this file shows"}</h3>
    {conclusion.status === "loading" ? <p className="admin-report-take pending" role="status">The AI agent is writing its take on these numbers…</p> : null}
    {conclusion.status === "ready" && conclusion.note ? <p className="admin-report-take"><b>The AI agent&apos;s take</b>{conclusion.note}</p> : null}
    {conclusion.status === "failed" ? <p className="admin-report-take pending">The AI agent couldn&apos;t be reached for its take. Everything below is worked out by code and is complete without it.</p> : null}
    {conclusion.cautions.length ? <ul className="admin-report-cautions">{conclusion.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul> : null}
    <div className="admin-report-sources">{sources.map((source) => {
      const digest = digests.find((item) => item.source === source);
      const about = named.filter((group) => group.source === source);
      const label = digest?.label ?? about[0]?.label ?? source;
      const zones = [...new Set(about.flatMap((group) => group.timeZone ? [group.timeZone] : []))];
      const blank = [...new Set(about.flatMap((group) => group.blank))];
      return <article key={source}>
        <h4>{label}{digest ? <small>{span([digest.from, digest.to].filter((date, index, all) => all.indexOf(date) === index))}</small> : null}</h4>
        {digest ? <ul>{digest.sentences.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul> : <p>Nothing to save for {label} yet.</p>}
        {about.length ? <p className="source-meta">{[
          ...new Set(about.flatMap((group) => group.decidedBy && DECIDED_BY[group.decidedBy] ? [DECIDED_BY[group.decidedBy]] : [])),
          ...(zones.length ? [`days in ${zones.join(", ")}`] : []),
          ...(blank.length ? [`left blank: ${blank.join(", ")}`] : []),
        ].join(" · ")}</p> : null}
        {about.flatMap((group) => group.checks).map((check) => <p className={check.ok ? "check ok" : "check"} key={check.text}><b aria-hidden="true">{check.ok ? "✓" : "!"}</b>{check.text}</p>)}
      </article>;
    })}</div>
  </section>;
}

function RowTable({ rows, keep, onToggle, multi }: { rows: PlannedRow[]; keep: (row: PlannedRow) => boolean; onToggle: (row: PlannedRow) => void; multi: boolean }) {
  return <div className="admin-metric-table-wrap">
    <table className="admin-trend-table admin-report-table">
      <thead><tr><th scope="col">Keep</th><th scope="col">Metric</th><th scope="col">Day</th><th scope="col">Number</th><th scope="col">Saved now</th><th scope="col">Where it came from</th></tr></thead>
      <tbody>{rows.map((row) => {
        const kept = row.change === "same" || keep(row);
        // A flagged row waiting for the owner isn't crossed out: it hasn't been turned down.
        const state = kept ? "" : row.flags.length ? "waiting" : "skipped";
        return <tr className={[state, row.change === "same" ? "same" : ""].filter(Boolean).join(" ") || undefined} key={rowKey(row)}>
          <td><input aria-label={`Keep ${row.label} on ${day(row.date)}`} checked={kept} disabled={row.change === "same"} onChange={() => onToggle(row)} type="checkbox" /></td>
          <th scope="row">{row.label}</th>
          <td><time dateTime={row.date}>{day(row.date)}</time></td>
          <td>{formatMetricValue(row.value, row.unit)}</td>
          <td className="change">{row.change === "new" ? "New" : row.change === "same" ? "Same" : `Replaces ${formatMetricValue(row.previous!.value, row.unit)}${row.previous!.synced ? " (synced nightly; the next sync may put its number back)" : ""}`}</td>
          <td className="evidence">{multi ? <small>{row.file}</small> : null}{row.evidence}{row.flags.map((flag) => <em key={flag}>{flag}</em>)}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
