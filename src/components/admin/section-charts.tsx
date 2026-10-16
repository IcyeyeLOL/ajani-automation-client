"use client";

import { barWidth, healthSummary, outreachSteps } from "@/lib/admin/chart-math";
import { plural } from "@/lib/admin/display-labels";
import type { OperationsStatus, OutreachExperiment, OutreachTotals, VariantPerformance } from "@/lib/admin/types";

type Measure = { key: "acceptanceRate" | "replyRate" | "positiveRate" | "bookingRate"; count: "connectionsAccepted" | "replies" | "positiveReplies" | "callsBooked"; label: string; one: string; many: string; tone: string };
const acceptedMeasure: Measure = { key: "acceptanceRate", count: "connectionsAccepted", label: "Accepted", one: "accepted", many: "accepted", tone: "accepted" };
const outcomeMeasures: Measure[] = [
  { key: "replyRate", count: "replies", label: "Replied", one: "reply", many: "replies", tone: "k0" },
  { key: "positiveRate", count: "positiveReplies", label: "Positive reply", one: "positive reply", many: "positive replies", tone: "k1" },
  { key: "bookingRate", count: "callsBooked", label: "Booked a call", one: "call booked", many: "calls booked", tone: "k2" },
];

export function OutreachFunnel({ totals }: { totals: OutreachTotals }) {
  const steps = outreachSteps(totals);
  const max = Math.max(0, ...steps.map((step) => step.value));
  return <article className="admin-panel admin-outreach-funnel">
    <header className="admin-panel-head"><div><p>OUTREACH FUNNEL</p><h2>Request to booked call.</h2></div><span>ALL TIME</span></header>
    {max ? <ol aria-label="Outreach funnel, all time" className="admin-hbar-list">{steps.map((step, index) => <li key={step.key}>
      <p><b>{pad(index + 1)}</b><span>{step.label}</span><strong>{formatNumber(step.value)}</strong></p>
      <i aria-hidden="true"><span style={{ width: `${barWidth(step.value, max)}%` }} /></i>
      <small>{step.note}</small>
    </li>)}</ol> : <ChartEmpty copy="No outreach logged yet. Each step fills in once you submit a batch below." />}
  </article>;
}

/** Tests judged on connection acceptance lead with an Accepted bar, measured against connection requests. */
export function VariantChart({ experiment, performance }: { experiment: Pick<OutreachExperiment, "messageStep" | "primaryMetric">; performance: VariantPerformance[] }) {
  const connectionTest = experiment.messageStep === "connection_request";
  const withAccepted = connectionTest || experiment.primaryMetric === "acceptance_rate";
  const measures = withAccepted ? [acceptedMeasure, ...outcomeMeasures] : outcomeMeasures;
  // Draw as soon as anything was sent: a real 0% is a result, not missing data.
  const hasSends = performance.some((variant) => variant.sent > 0 || (withAccepted && variant.connectionRequests > 0));
  const max = Math.max(0, ...performance.flatMap((variant) => measures.map((measure) => variant[measure.key] ?? 0))) || 1;
  const summary = performance.map((variant) => `${variant.label} ${variant.title}: ${measures.map((measure) => `${measure.label.toLowerCase()} ${rateText(variant[measure.key])}`).join(", ")}`).join(". ");
  const caption = connectionTest ? "Out of every 100 connection requests, how many were accepted, replied, replied positively and booked a call."
    : withAccepted ? "Accepted is out of every 100 connection requests. The other bars are out of every 100 sent."
    : "Out of every 100 sent, how many replied, replied positively and booked a call.";
  return <figure className="admin-variant-chart">
    <figcaption><div><p>RESULTS PER 100 SENT</p><span>{caption}</span></div>{hasSends ? <ChartLegend items={measures.map((measure) => [measure.label, measure.tone])} /> : null}</figcaption>
    {hasSends ? <div aria-label={`Variant results. ${summary}.`} className="admin-vchart" role="img">{performance.map((variant) => <div key={variant.id} style={{ minWidth: measures.length * 34 - 4 }}>
      <div className="admin-vchart-bars">{measures.map((measure) => {
        const rate = variant[measure.key];
        const base = measure === acceptedMeasure ? `${formatNumber(variant.connectionRequests)} connection requests` : `${formatNumber(variant.sent)} sent`;
        return <span className={measure.tone} key={measure.key} title={`${variant.label} ${variant.title}: ${plural(variant[measure.count], measure.one, measure.many)} from ${base} (${rateText(rate)})`}><small>{rate === null ? "–" : `${rate.toFixed(1)}%`}</small><i style={{ height: `${rate ? Math.max(1.5, (rate / max) * 84) : 0}%` }} /></span>;
      })}</div>
      <p><b>{variant.label}</b><span>{variant.title}</span><small>{formatNumber(variant.sent)} sent</small></p>
    </div>)}</div> : <ChartEmpty copy="No results logged for these variants yet. Add them under Enter performance below." />}
  </figure>;
}

export function DemandBars({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(0, ...items.map((item) => item.value));
  return <>
    <ol aria-label="Most requested automations" className="admin-hbar-list">{items.map((item, index) => <li key={item.label}>
      <p><b>{pad(index + 1)}</b><span>{item.label}</span><strong>{formatNumber(item.value)}</strong></p>
      <i aria-hidden="true"><span style={{ width: `${barWidth(item.value, max)}%` }} /></i>
    </li>)}</ol>
    <p className="admin-chart-note">Briefs from the last 180 days, read by AI. Each bar is compared with the most requested automation.</p>
  </>;
}

export function SystemHealth({ systems }: { systems: OperationsStatus[] }) {
  const summary = healthSummary(systems);
  const headline = !summary.checked ? "Nothing has been checked yet." : summary.flagged ? `${summary.flagged} of ${systems.length} systems need a look.` : "Every system is running cleanly.";
  return <article className="admin-panel admin-health-panel">
    <header className="admin-panel-head"><div><p>SYSTEM HEALTH</p><h2>{headline}</h2></div>{summary.checked ? <ChartLegend items={[["Healthy", "healthy"], ["Needs review", "attention"]]} /> : null}</header>
    {summary.checked ? <div className="admin-health-body">
      <section className="admin-health-overall">
        <p>ALL SYSTEMS TOGETHER</p>
        <strong>{summary.share === null ? "–" : `${summary.share.toFixed(1)}%`}<small>healthy</small></strong>
        <HealthBar attention={summary.attention} healthy={summary.healthy} label="All systems together" />
        <span>{formatNumber(summary.healthy)} healthy, {reviewText(summary.attention)}.</span>
      </section>
      <ul className="admin-health-list">{systems.map((item) => <li key={item.label}>
        <p><b>{item.label}</b><span>{item.healthy + item.attention ? `${formatNumber(item.healthy)} healthy, ${reviewText(item.attention)}` : "Nothing checked yet"}</span></p>
        <HealthBar attention={item.attention} healthy={item.healthy} label={item.label} />
      </li>)}</ul>
    </div> : <ChartEmpty copy="Checks appear here once the first AI run, transcription, notification or live system is recorded." />}
    <footer className="admin-chart-note">Jobs from the last 180 days, and live systems as they are now. Jobs still running are left out.</footer>
  </article>;
}

function HealthBar({ healthy, attention, label }: { healthy: number; attention: number; label: string }) {
  return <div aria-label={`${label}: ${healthy} healthy, ${reviewText(attention)}`} className="admin-health-bar" role="img">
    {healthy ? <i className="healthy" style={{ flexGrow: healthy }} /> : null}
    {attention ? <i className="attention" style={{ flexGrow: attention }} /> : null}
  </div>;
}

function ChartLegend({ items }: { items: Array<readonly [string, string]> }) {
  return <ul className="admin-chart-legend">{items.map(([label, tone]) => <li key={label}><i className={tone} />{label}</li>)}</ul>;
}

function ChartEmpty({ copy }: { copy: string }) {
  return <p className="admin-chart-empty">{copy}</p>;
}

function pad(value: number) { return String(value).padStart(2, "0"); }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function rateText(value: number | null) { return value === null ? "nothing sent yet" : `${value.toFixed(1)}%`; }
function reviewText(count: number) { return `${formatNumber(count)} ${count === 1 ? "needs" : "need"} review`; }
