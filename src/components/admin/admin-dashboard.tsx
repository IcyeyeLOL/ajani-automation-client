"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createExperimentAction,
  createOutreachBatchAction,
  logoutAdminAction,
} from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import type {
  AdminDashboardData,
  AdminMetric,
  OutreachExperiment,
  OutreachVariant,
  TrendPoint,
  VariantPerformance,
} from "@/lib/admin/types";

type Section = "overview" | "outreach" | "experiments" | "website" | "operations";
type MetricKey = "connectionRequests" | "connectionsAccepted" | "initialDms" | "f1Sent" | "f2Sent" | "replies" | "positiveReplies" | "callsBooked";
type MetricRow = Record<MetricKey, number> & { variantId: string | null; variantLabel: string };

const sections: Array<{ id: Section; label: string; number: string }> = [
  { id: "overview", label: "Overview", number: "01" },
  { id: "outreach", label: "Outreach", number: "02" },
  { id: "experiments", label: "Experiments", number: "03" },
  { id: "website", label: "Website funnel", number: "04" },
  { id: "operations", label: "Operations", number: "05" },
];

const metricColumns: Array<{ key: MetricKey; short: string; label: string }> = [
  { key: "connectionRequests", short: "CONNECT", label: "Connection requests" },
  { key: "connectionsAccepted", short: "ACCEPTED", label: "Connections accepted" },
  { key: "initialDms", short: "INITIAL", label: "Initial DMs" },
  { key: "f1Sent", short: "F1", label: "First follow-ups" },
  { key: "f2Sent", short: "F2", label: "Second follow-ups" },
  { key: "replies", short: "REPLIES", label: "Unique replies" },
  { key: "positiveReplies", short: "POSITIVE", label: "Positive replies" },
  { key: "callsBooked", short: "CALLS", label: "Calls booked" },
];

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [isRefreshing, startRefresh] = useTransition();

  const refreshDashboard = () => startRefresh(() => router.refresh());
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") startRefresh(() => router.refresh());
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [router]);

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <div>
        <span className="admin-wordmark">AJANI<i>.</i></span>
        <small>CONTROL DESK</small>
      </div>
      <nav aria-label="Admin sections">
        {sections.map((section) => <button aria-current={activeSection === section.id ? "page" : undefined} key={section.id} onClick={() => setActiveSection(section.id)} type="button"><span>{section.number}</span>{section.label}</button>)}
      </nav>
      <div className="admin-sidebar-foot">
        <p><i className={data.dataConnected ? "online" : "offline"} />{data.dataConnected ? "LIVE DATA CONNECTED" : "DATA CONNECTION NEEDED"}</p>
        <form action={logoutAdminAction}><button type="submit">LOCK DESK</button></form>
      </div>
    </aside>

    <section className="admin-main">
      <AdminHeader section={activeSection} generatedAt={data.generatedAt} isRefreshing={isRefreshing} onRefresh={refreshDashboard} />
      {!data.outreachSchemaReady ? <SetupBanner connected={data.dataConnected} /> : null}
      {activeSection === "overview" ? <Overview data={data} onNavigate={setActiveSection} /> : null}
      {activeSection === "outreach" ? <Outreach data={data} /> : null}
      {activeSection === "experiments" ? <Experiments data={data} /> : null}
      {activeSection === "website" ? <WebsiteFunnel data={data} /> : null}
      {activeSection === "operations" ? <Operations data={data} /> : null}
    </section>
  </main>;
}

function AdminHeader({ section, generatedAt, isRefreshing, onRefresh }: { section: Section; generatedAt: string; isRefreshing: boolean; onRefresh: () => void }) {
  const current = sections.find((item) => item.id === section) ?? sections[0];
  return <header className="admin-header">
    <div><p>{current.number} / INTERNAL OPERATIONS</p><h1>{current.label}</h1></div>
    <button aria-label="Refresh live dashboard data" className="admin-header-meta" disabled={isRefreshing} onClick={onRefresh} type="button"><span>{isRefreshing ? "REFRESHING" : "LAST REFRESH"}</span><b>{formatTime(generatedAt)}</b><i /></button>
  </header>;
}

function SetupBanner({ connected }: { connected: boolean }) {
  return <aside className="admin-setup-banner">
    <div><span>{connected ? "OUTREACH STORAGE PENDING" : "DATA CONNECTION PENDING"}</span><b>{connected ? "Apply the latest outreach migration to activate batch entry and A/B tracking." : "Connect the private data layer to replace empty states with live statistics."}</b></div>
    <p>WEBSITE DASHBOARD REMAINS SAFE</p>
  </aside>;
}

function Overview({ data, onNavigate }: { data: AdminDashboardData; onNavigate: (section: Section) => void }) {
  return <div className="admin-section-stack">
    <section className="admin-metric-grid">{data.metrics.map((item) => <MetricCard item={item} key={item.label} />)}</section>
    <section className="admin-two-column admin-chart-row">
      <GrowthChart trend={data.trend} />
      <FunnelCard data={data} />
    </section>
    <section className="admin-two-column admin-bottom-row">
      <RecentActivity data={data} />
      <article className="admin-action-panel">
        <p>QUICK ACTION</p><h2>Log today&apos;s outreach without slowing the work.</h2>
        <span>One aggregate batch captures manual or Dripify volume, outcomes, audience, team member, and every active variant.</span>
        <button onClick={() => onNavigate("outreach")} type="button">OPEN BATCH LOGGER <b>→</b></button>
      </article>
    </section>
  </div>;
}

function MetricCard({ item }: { item: AdminMetric }) {
  return <article className={`admin-metric-card tone-${item.tone}`}>
    <div><span>{item.label}</span>{item.delta === null ? <small>30D</small> : <small className={item.delta >= 0 ? "up" : "down"}>{item.delta >= 0 ? "↑" : "↓"} {Math.abs(item.delta).toFixed(1)}%</small>}</div>
    <strong>{item.value}</strong><p>{item.detail}</p>
  </article>;
}

function GrowthChart({ trend }: { trend: TrendPoint[] }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [series, setSeries] = useState<"outreach" | "website">("outreach");
  const points = useMemo(() => chartPoints(trend.slice(-range), range), [range, trend]);
  const primaryKey = series === "outreach" ? "outreach" : "drafts";
  const secondaryKey = series === "outreach" ? "replies" : "submissions";
  const maximum = Math.max(1, ...points.flatMap((point) => [point[primaryKey], point[secondaryKey]]));
  const primaryTotal = points.reduce((sum, point) => sum + point[primaryKey], 0);
  const secondaryTotal = points.reduce((sum, point) => sum + point[secondaryKey], 0);

  return <article className="admin-panel admin-growth-panel">
    <header className="admin-panel-head"><div><p>GROWTH OVER TIME</p><h2>{series === "outreach" ? "Outreach activity" : "Website demand"}</h2></div><div className="admin-segmented"><button aria-pressed={series === "outreach"} onClick={() => setSeries("outreach")} type="button">OUTREACH</button><button aria-pressed={series === "website"} onClick={() => setSeries("website")} type="button">WEBSITE</button></div></header>
    <div className="admin-chart-summary"><p><span>{series === "outreach" ? "TOUCHES" : "SAVED DRAFTS"}</span><b>{formatNumber(primaryTotal)}</b></p><p><span>{series === "outreach" ? "REPLIES" : "SUBMISSIONS"}</span><b>{formatNumber(secondaryTotal)}</b></p></div>
    <div className="admin-bar-chart" role="img" aria-label={`${series} statistics over ${range} days`}>
      {points.map((point, index) => <div className="admin-bar-group" key={point.date} title={`${formatDate(point.date)}: ${point[primaryKey]} / ${point[secondaryKey]}`}><div className="admin-bar-pair"><i style={{ height: `${Math.max(point[primaryKey] ? 5 : 0, (point[primaryKey] / maximum) * 100)}%` }} /><i style={{ height: `${Math.max(point[secondaryKey] ? 5 : 0, (point[secondaryKey] / maximum) * 100)}%` }} /></div>{showAxisLabel(index, points.length) ? <span>{axisDate(point.date, range)}</span> : null}</div>)}
    </div>
    <footer className="admin-chart-foot"><div><span><i />{series === "outreach" ? "TOUCHES" : "DRAFTS"}</span><span><i />{series === "outreach" ? "REPLIES" : "SUBMISSIONS"}</span></div><div className="admin-segmented small">{([7, 30, 90] as const).map((value) => <button aria-pressed={range === value} key={value} onClick={() => setRange(value)} type="button">{value}D</button>)}</div></footer>
  </article>;
}

function FunnelCard({ data }: { data: AdminDashboardData }) {
  const max = Math.max(1, data.funnel[0]?.value ?? 0);
  return <article className="admin-panel admin-funnel-panel">
    <header className="admin-panel-head"><div><p>WEBSITE FUNNEL</p><h2>From saved brief to build.</h2></div><span>180D</span></header>
    <div className="admin-funnel-list">{data.funnel.map((stage, index) => <div key={stage.label}><p><b>0{index + 1}</b><span>{stage.label}</span><strong>{stage.value}</strong><small>{stage.rate === null ? "N/A" : `${stage.rate.toFixed(1)}%`}</small></p><i><span style={{ width: `${(stage.value / max) * 100}%` }} /></i></div>)}</div>
  </article>;
}

function RecentActivity({ data }: { data: AdminDashboardData }) {
  return <article className="admin-panel admin-recent-panel"><header className="admin-panel-head"><div><p>RECENT OUTREACH</p><h2>Latest team batches.</h2></div><span>{String(data.recentBatches.length).padStart(2, "0")} LOGS</span></header>
    {data.recentBatches.length ? <div className="admin-recent-list">{data.recentBatches.slice(0, 5).map((batch) => <div key={batch.id}><time>{shortDate(batch.date)}</time><p><b>{batch.teamMember}</b><span>{batch.context}</span></p><strong>{batch.sent}<small> TOUCHES</small></strong><em>{batch.replies} replies / {batch.calls} calls</em></div>)}</div> : <EmptyState title="No outreach batches yet" copy="The first submitted batch will appear here with its owner, context, volume, and results." />}
  </article>;
}

function Outreach({ data }: { data: AdminDashboardData }) {
  const totals = data.outreach;
  const cards = [
    ["Connection requests", totals.connectionRequests, formatRate(totals.acceptanceRate, "accepted")],
    ["Initial DMs", totals.initialDms, formatRate(totals.replyRate, "reply rate")],
    ["Follow-ups", totals.f1Sent + totals.f2Sent, `${totals.f1Sent} F1 / ${totals.f2Sent} F2`],
    ["Replies", totals.replies, `${totals.positiveReplies} positive`],
    ["Calls booked", totals.callsBooked, "Qualified outcomes"],
  ] as const;
  return <div className="admin-section-stack">
    <section className="admin-outreach-strip">{cards.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{formatNumber(value)}</strong><small>{detail}</small></article>)}</section>
    <BatchLogger experiments={data.experiments} enabled={data.outreachSchemaReady} />
    <RecentActivity data={data} />
  </div>;
}

function BatchLogger({ experiments, enabled }: { experiments: OutreachExperiment[]; enabled: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createOutreachBatchAction, initialAdminActionState);
  const [experimentId, setExperimentId] = useState("");
  const experiment = experiments.find((item) => item.id === experimentId) ?? null;
  const rowVariants = useMemo(() => experiment ? [...experiment.variants, { id: "", label: "NONE", title: "No variant" }] : [{ id: "", label: "NONE", title: "No variant" }], [experiment]);

  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <article className="admin-panel admin-logger-panel">
    <header className="admin-panel-head"><div><p>FAST BATCH ENTRY</p><h2>Log the day once. Keep moving.</h2></div><span>AGGREGATE FIRST</span></header>
    <form action={action} key={state.entityId ?? "new-batch"}>
      <div className="admin-context-grid">
        <Field label="Date"><input defaultValue={new Date().toISOString().slice(0, 10)} name="activityDate" required type="date" /></Field>
        <Field label="Team member"><input maxLength={100} name="teamMember" placeholder="Kunle" required /></Field>
        <Field label="Channel"><select defaultValue="linkedin" name="channel"><option value="linkedin">LinkedIn</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></Field>
        <Field label="Method"><select defaultValue="manual" name="method"><option value="manual">Manual</option><option value="dripify">Dripify</option><option value="organic">Organic content</option></select></Field>
        <Field label="Audience"><input maxLength={120} name="audience" placeholder="Insurance agency owners" required /></Field>
        <Field label="Campaign"><input maxLength={120} name="campaign" placeholder="August founder outreach" /></Field>
        <Field label="A/B test"><select name="experimentId" onChange={(event) => setExperimentId(event.target.value)} value={experimentId}><option value="">No experiment</option>{experiments.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
        <Field label="Notes"><input maxLength={1000} name="notes" placeholder="Optional context" /></Field>
      </div>
      <BatchMetricGrid key={`${experimentId}:${state.entityId ?? "draft"}`} variants={rowVariants} />
      <div className="admin-form-footer"><div>{state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : <p>Rates are calculated from summed counts, never by averaging daily percentages.</p>}</div><button disabled={!enabled || pending} type="submit">{pending ? "SAVING BATCH" : enabled ? "SUBMIT BATCH" : "STORAGE NOT READY"}<b>→</b></button></div>
    </form>
  </article>;
}

function BatchMetricGrid({ variants }: { variants: Array<Pick<OutreachVariant, "id" | "label" | "title">> }) {
  const [rows, setRows] = useState<MetricRow[]>(() => rowsForVariants(variants));
  const updateMetric = (index: number, key: MetricKey, rawValue: string) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: Math.max(0, Number.parseInt(rawValue || "0", 10) || 0) } : row));
  return <>
    <input name="metrics" type="hidden" value={JSON.stringify(rows)} />
    <div className="admin-metric-table-wrap"><table className="admin-metric-table"><thead><tr><th>VARIANT</th>{metricColumns.map((column) => <th key={column.key} title={column.label}>{column.short}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.variantId}-${row.variantLabel}`}><th><b>{row.variantLabel}</b><span>{variants[index]?.title}</span></th>{metricColumns.map((column) => <td key={column.key}><label><span className="sr-only">{row.variantLabel} {column.label}</span><input inputMode="numeric" min="0" onChange={(event) => updateMetric(index, column.key, event.target.value)} type="number" value={row[column.key]} /></label></td>)}</tr>)}</tbody></table></div>
  </>;
}

function Experiments({ data }: { data: AdminDashboardData }) {
  const [selectedId, setSelectedId] = useState(data.experiments[0]?.id ?? "");
  const experiment = data.experiments.find((item) => item.id === selectedId) ?? data.experiments[0] ?? null;
  const performance = experiment ? data.experimentPerformance[experiment.id] ?? [] : [];
  return <div className="admin-section-stack">
    <section className="admin-two-column admin-experiment-layout"><ExperimentForm enabled={data.outreachSchemaReady} /><ExperimentComparison experiment={experiment} experiments={data.experiments} performance={performance} selectedId={selectedId} setSelectedId={setSelectedId} /></section>
    <article className="admin-panel admin-rules-panel"><header className="admin-panel-head"><div><p>MEASUREMENT RULES</p><h2>Signals without false certainty.</h2></div></header><div>{[["01","Same denominator","Each variant uses unique initial DMs as the reply-rate denominator."],["02","Absolute + relative","A 5% to 8% move is +3 points and +60% relative lift."],["03","Cohort aware","Results stay attached to the experiment instead of dividing today’s replies by today’s sends."],["04","No forced winner","Small samples remain an early signal until enough volume accumulates."]].map(([number,title,copy]) => <section key={number}><b>{number}</b><h3>{title}</h3><p>{copy}</p></section>)}</div></article>
  </div>;
}

function ExperimentForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createExperimentAction, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <article className="admin-panel admin-experiment-form"><header className="admin-panel-head"><div><p>NEW EXPERIMENT</p><h2>Create a flexible comparison.</h2></div><span>A / B / CUSTOM</span></header><form action={action} key={state.entityId ?? "new-experiment"}>
    <Field label="Experiment title"><input maxLength={120} name="title" placeholder="TCPA angle vs speed-to-lead" required /></Field>
    <div className="admin-form-pair"><Field label="Audience"><input maxLength={120} name="audience" placeholder="Insurance agency owners" required /></Field><Field label="Created by"><input maxLength={100} name="createdBy" placeholder="Team member" required /></Field></div>
    <Field label="Campaign, optional"><input maxLength={120} name="campaign" placeholder="August manual outreach" /></Field>
    <div className="admin-form-pair"><Field label="Channel"><select defaultValue="linkedin" name="channel"><option value="linkedin">LinkedIn</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></Field><Field label="Method"><select defaultValue="manual" name="method"><option value="manual">Manual</option><option value="dripify">Dripify</option><option value="organic">Organic</option></select></Field></div>
    <Field label="Primary metric"><select defaultValue="reply_rate" name="primaryMetric"><option value="reply_rate">Reply rate</option><option value="positive_reply_rate">Positive reply rate</option><option value="booking_rate">Booking rate</option><option value="acceptance_rate">Connection acceptance</option></select></Field>
    <Field hint="Comma-separated. Labels A, B, C are assigned automatically." label="Variant titles"><input maxLength={500} name="variants" placeholder="TCPA hook, Speed-to-lead hook" required /></Field>
    {state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : null}
    <button disabled={!enabled || pending} type="submit">{pending ? "CREATING" : enabled ? "CREATE EXPERIMENT" : "STORAGE NOT READY"}<b>→</b></button>
  </form></article>;
}

function ExperimentComparison({ experiment, experiments, performance, selectedId, setSelectedId }: { experiment: OutreachExperiment | null; experiments: OutreachExperiment[]; performance: VariantPerformance[]; selectedId: string; setSelectedId: (id: string) => void }) {
  const maxRate = Math.max(1, ...performance.map((item) => item.primaryRate ?? 0));
  return <article className="admin-panel admin-comparison-panel"><header className="admin-panel-head"><div><p>VARIANT COMPARISON</p><h2>{experiment?.title ?? "No experiment yet"}</h2></div>{experiments.length ? <select aria-label="Select experiment" onChange={(event) => setSelectedId(event.target.value)} value={selectedId || experiment?.id}>{experiments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : null}</header>
    {experiment ? <><div className="admin-experiment-meta"><span>{experiment.audience}</span><span>{titleCase(experiment.channel)}</span><span>{titleCase(experiment.method)}</span><span>{titleCase(experiment.primaryMetric)}</span></div><div className="admin-variant-list">{performance.map((variant) => <section key={variant.id}><header><b>{variant.label}</b><p><strong>{variant.title}</strong><span>{variant.status.toUpperCase()}</span></p><em>{variant.primaryRate === null ? "N/A" : `${variant.primaryRate.toFixed(1)}%`}</em></header><div className="admin-variant-track"><span style={{ width: `${((variant.primaryRate ?? 0) / maxRate) * 100}%` }} /></div><footer><span>{variant.primaryMetricLabel}</span><span>{variant.sent} sent</span><span>{variant.replies} replies</span><span>{variant.callsBooked} calls</span></footer></section>)}</div></> : <EmptyState title="Create the first experiment" copy="Variants remain optional and receive their labels automatically. Your team controls every title and audience." />}
  </article>;
}

function WebsiteFunnel({ data }: { data: AdminDashboardData }) {
  return <div className="admin-section-stack"><section className="admin-two-column admin-website-layout"><FunnelCard data={data} /><article className="admin-panel admin-demand-panel"><header className="admin-panel-head"><div><p>REQUEST DEMAND</p><h2>What businesses are asking for.</h2></div><span>AI EXTRACTED</span></header>{data.contentDemand.length ? <div>{data.contentDemand.map((item, index) => <p key={item.label}><b>{String(index + 1).padStart(2,"0")}</b><span>{item.label}</span><strong>{item.value}</strong></p>)}</div> : <EmptyState title="No structured demand yet" copy="Business verticals appear here as saved briefs complete the private intake analysis." />}</article></section><WebsiteMetricExplanation /></div>;
}

function WebsiteMetricExplanation() {
  const rows = [["Saved briefs","The first durable website intent signal. Anonymous page views are not counted."],["AI processed","The brief produced a structured extraction with goals, tools, constraints, and vertical."],["Scope approved","The visitor approved a specific system definition."],["Account claimed","The anonymous draft was attached to a signed-in business workspace."],["Build submitted","The approved request entered the private build pipeline."]];
  return <article className="admin-panel admin-definition-panel"><header className="admin-panel-head"><div><p>STATISTIC DEFINITIONS</p><h2>Every number has a durable meaning.</h2></div></header><div>{rows.map(([label,copy],index) => <section key={label}><b>0{index+1}</b><h3>{label}</h3><p>{copy}</p></section>)}</div></article>;
}

function Operations({ data }: { data: AdminDashboardData }) {
  return <div className="admin-section-stack"><section className="admin-operations-grid">{data.operations.map((item) => <article className="admin-panel" key={item.label}><header><div><i className={item.attention ? "attention" : "healthy"} /><span>{item.attention ? "ATTENTION" : "HOLDING"}</span></div><b>{item.label}</b></header><div><p><span>HEALTHY</span><strong>{item.healthy}</strong></p><p><span>NEEDS REVIEW</span><strong>{item.attention}</strong></p></div><footer>{item.detail}</footer></article>)}</section><article className="admin-panel admin-ops-note"><p>OPERATING PRINCIPLE</p><h2>Failures surface here. Credentials and private provider errors do not.</h2><span>The control desk reports job state, retries, health, and attention signals while sensitive keys remain server-only.</span></article></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="admin-empty"><i>+</i><b>{title}</b><p>{copy}</p></div>;
}

function rowsForVariants(variants: Array<Pick<OutreachVariant, "id" | "label" | "title">>): MetricRow[] {
  return variants.map((variant) => ({ variantId: variant.id || null, variantLabel: variant.label === "NONE" ? "No variant" : variant.label, connectionRequests: 0, connectionsAccepted: 0, initialDms: 0, f1Sent: 0, f2Sent: 0, replies: 0, positiveReplies: 0, callsBooked: 0 }));
}

function chartPoints(points: TrendPoint[], range: number) {
  if (range !== 90) return points;
  const weeks: TrendPoint[] = [];
  points.forEach((point, index) => {
    const bucket = Math.floor(index / 7);
    weeks[bucket] ??= { date: point.date, drafts: 0, submissions: 0, outreach: 0, replies: 0 };
    weeks[bucket].drafts += point.drafts; weeks[bucket].submissions += point.submissions; weeks[bucket].outreach += point.outreach; weeks[bucket].replies += point.replies;
  });
  return weeks;
}

function showAxisLabel(index: number, length: number) { return index === 0 || index === length - 1 || index === Math.floor(length / 2); }
function axisDate(value: string, range: number) { return new Intl.DateTimeFormat("en-US", { month: "short", day: range === 90 ? undefined : "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function shortDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatTime(value: string) { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function formatRate(value: number | null, label: string) { return value === null ? `No ${label} denominator` : `${value.toFixed(1)}% ${label}`; }
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
