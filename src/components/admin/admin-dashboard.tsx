"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createExperimentAction,
  createOutreachBatchAction,
  logExperimentMetricsAction,
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
type MetricKey = "connectionRequests" | "connectionsAccepted" | "initialDms" | "f1Sent" | "f2Sent" | "customSent" | "replies" | "attributedReplies" | "positiveReplies" | "callsBooked";
type MetricRow = Record<MetricKey, number> & { variantId: string | null; variantLabel: string };
type ExperimentMetricRow = {
  variantId: string;
  variantLabel: string;
  sent: number;
  replies: number;
  positiveReplies: number;
  callsBooked: number;
  connectionRequests: number;
  connectionsAccepted: number;
};

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
  { key: "customSent", short: "CUSTOM", label: "Custom-step sends" },
  { key: "replies", short: "REPLIES", label: "Unique replies" },
  { key: "attributedReplies", short: "ATTR.", label: "Replies attributed to the tested step" },
  { key: "positiveReplies", short: "POSITIVE", label: "Positive replies" },
  { key: "callsBooked", short: "CALLS", label: "Calls booked" },
];

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [isRefreshing, startRefresh] = useTransition();
  const lastAutomaticRefreshAt = useRef(0);

  const refreshDashboard = () => startRefresh(() => router.refresh());
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastAutomaticRefreshAt.current < 15_000) return;
      lastAutomaticRefreshAt.current = now;
      startRefresh(() => router.refresh());
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
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
      {data.dataNotice ? <p className="admin-data-notice" role={data.dataStatus === "unavailable" ? "status" : undefined}>{data.dataNotice}</p> : null}
      {data.dataStatus !== "unavailable" ? <>
      {activeSection === "overview" ? <Overview data={data} onNavigate={setActiveSection} /> : null}
      {activeSection === "outreach" ? <Outreach data={data} key={data.pagination.experimentPage} /> : null}
      {activeSection === "experiments" ? <Experiments data={data} key={data.pagination.experimentPage} /> : null}
      {activeSection === "website" ? <WebsiteFunnel data={data} /> : null}
      {activeSection === "operations" ? <Operations data={data} /> : null}
      </> : null}
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
    <div><span>{connected ? "ANALYTICS INCOMPLETE" : "ANALYTICS UNAVAILABLE"}</span><b>Statistics cannot be loaded. Check the database connection and apply the engineering analytics migration.</b></div>
    <p>NO ZERO TOTALS ARE IMPLIED</p>
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
    {data.recentBatches.length ? <div className="admin-recent-list">{data.recentBatches.map((batch) => <div key={batch.id}><time>{shortDate(batch.date)}</time><p><b>{batch.teamMember}</b><span>{batch.context}</span></p><strong>{batch.sent}<small> TOUCHES</small></strong><em>{batch.replies} replies / {batch.calls} calls</em></div>)}</div> : <EmptyState title="No outreach batches yet" copy="The first submitted batch will appear here with its owner, context, volume, and results." />}
    <AdminPagination data={data} kind="batches" />
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
    <AdminPagination data={data} kind="experiments" />
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
    <AdminPagination data={data} kind="experiments" />
    <section className="admin-two-column admin-experiment-layout"><ExperimentForm enabled={data.outreachSchemaReady} /><ExperimentComparison experiment={experiment} experiments={data.experiments} performance={performance} selectedId={selectedId} setSelectedId={setSelectedId} /></section>
    <ExperimentMetricEntry enabled={data.outreachSchemaReady} experiment={experiment} key={experiment?.id ?? "no-experiment"} />
    <article className="admin-panel admin-rules-panel"><header className="admin-panel-head"><div><p>MEASUREMENT RULES</p><h2>Signals without false certainty.</h2></div></header><div>{[["01","Matched denominator","Each experiment uses exposure at its selected message step."],["02","Absolute + relative","A 5% to 8% move is +3 points and +60% relative lift."],["03","Cohort aware","Attributed replies stay attached to the tested step and variant."],["04","No forced winner","Expected-cell and multiple-variant safeguards prevent premature winners."]].map(([number,title,copy]) => <section key={number}><b>{number}</b><h3>{title}</h3><p>{copy}</p></section>)}</div></article>
  </div>;
}

function AdminPagination({ data, kind }: { data: AdminDashboardData; kind: "experiments" | "batches" }) {
  const { experimentPage, batchPage, experimentCount, batchCount } = data.pagination;
  const page = kind === "experiments" ? experimentPage : batchPage;
  const size = kind === "experiments" ? 25 : 20;
  const count = kind === "experiments" ? experimentCount : batchCount;
  const href = (next: number) => `/admin?experiments=${kind === "experiments" ? next : experimentPage}&batches=${kind === "batches" ? next : batchPage}`;
  return <nav aria-label={`${kind} pages`} className="admin-pagination">
    <span>{count ? `${Math.min(page * size + 1, count)}–${Math.min((page + 1) * size, count)} of ${count}` : "No"} {kind}. Totals include all pages.</span>
    {page > 0 ? <Link href={href(page - 1)} prefetch={false} scroll={false}>Previous {kind}</Link> : null}
    {(page + 1) * size < count ? <Link href={href(page + 1)} prefetch={false} scroll={false}>Next {kind}</Link> : null}
  </nav>;
}

function ExperimentForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createExperimentAction, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <article className="admin-panel admin-experiment-form"><header className="admin-panel-head"><div><p>NEW EXPERIMENT</p><h2>Create a flexible comparison.</h2></div><span>A / B / CUSTOM</span></header><form action={action} key={state.entityId ?? "new-experiment"}>
    <Field label="Experiment title"><input maxLength={120} name="title" placeholder="TCPA angle vs speed-to-lead" required /></Field>
    <Field label="Audience"><input maxLength={120} name="audience" placeholder="Insurance agency owners" required /></Field>
    <Field label="Campaign, optional"><input maxLength={120} name="campaign" placeholder="August manual outreach" /></Field>
    <div className="admin-form-pair"><Field label="Channel"><select defaultValue="linkedin" name="channel"><option value="linkedin">LinkedIn</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></Field><Field label="Method"><select defaultValue="manual" name="method"><option value="manual">Manual</option><option value="dripify">Dripify</option><option value="organic">Organic</option></select></Field></div>
    <div className="admin-form-pair"><Field label="Message step"><select defaultValue="initial_dm" name="messageStep"><option value="connection_request">Connection request</option><option value="initial_dm">Initial DM</option><option value="follow_up_1">Follow-up 1</option><option value="follow_up_2">Follow-up 2</option><option value="custom">Custom step</option></select></Field><Field label="Primary metric"><select defaultValue="reply_rate" name="primaryMetric"><option value="reply_rate">Reply rate</option><option value="positive_reply_rate">Positive reply rate</option><option value="booking_rate">Booking rate</option><option value="acceptance_rate">Connection acceptance</option></select></Field></div>
    <Field hint="Comma-separated. Labels A, B, C are assigned automatically." label="Variant titles"><input maxLength={500} name="variants" placeholder="TCPA hook, Speed-to-lead hook" required /></Field>
    {state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : null}
    <button disabled={!enabled || pending} type="submit">{pending ? "CREATING" : enabled ? "CREATE EXPERIMENT" : "STORAGE NOT READY"}<b>→</b></button>
  </form></article>;
}

function ExperimentComparison({ experiment, experiments, performance, selectedId, setSelectedId }: { experiment: OutreachExperiment | null; experiments: OutreachExperiment[]; performance: VariantPerformance[]; selectedId: string; setSelectedId: (id: string) => void }) {
  const maxRate = Math.max(1, ...performance.map((item) => item.primaryRate ?? 0));
  return <article className="admin-panel admin-comparison-panel"><header className="admin-panel-head"><div><p>VARIANT COMPARISON</p><h2>{experiment?.title ?? "No experiment yet"}</h2></div>{experiments.length ? <select aria-label="Select experiment" onChange={(event) => setSelectedId(event.target.value)} value={selectedId || experiment?.id}>{experiments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : null}</header>
    {experiment ? <><div className="admin-experiment-meta"><span>{experiment.audience}</span><span>{titleCase(experiment.channel)}</span><span>{titleCase(experiment.method)}</span><span>{titleCase(experiment.messageStep)}</span><span>{titleCase(experiment.primaryMetric)}</span></div><div className="admin-variant-list">{performance.map((variant) => <section key={variant.id}><header><b>{variant.label}</b><p><strong>{variant.title}</strong><span>{variant.status.toUpperCase()}</span></p><em>{variant.primaryRate === null ? "N/A" : `${variant.primaryRate.toFixed(1)}%`}</em></header><div className="admin-variant-track"><span style={{ width: `${((variant.primaryRate ?? 0) / maxRate) * 100}%` }} /></div><footer><span>{variant.primaryMetricLabel}</span><span>{variant.sent} sent</span><span>{variant.replies} replies</span><span>{variant.positiveReplies} positive</span><span>{variant.callsBooked} booked</span><span>{variant.connectionsAccepted}/{variant.connectionRequests} connections</span></footer></section>)}</div></> : <EmptyState title="Create the first experiment" copy="Variants remain optional and receive their labels automatically. Your team controls every title and audience." />}
  </article>;
}

function ExperimentMetricEntry({ experiment, enabled }: { experiment: OutreachExperiment | null; enabled: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(logExperimentMetricsAction, initialAdminActionState);
  const [rows, setRows] = useState<ExperimentMetricRow[]>(() => experimentRows(experiment));
  const isConnectionTest = experiment?.messageStep === "connection_request";
  const sentLabel = isConnectionTest ? "Requests sent" : `${messageStepLabel(experiment?.messageStep)} sent`;

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
  }, [router, state.entityId, state.status]);

  const updateMetric = (index: number, key: keyof Omit<ExperimentMetricRow, "variantId" | "variantLabel">, rawValue: string) => {
    const nextValue = Math.max(0, Number.parseInt(rawValue || "0", 10) || 0);
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: nextValue } : row));
  };

  return <article className="admin-panel admin-experiment-metrics">
    <header className="admin-panel-head"><div><p>ENTER PERFORMANCE</p><h2>Update every variant in one pass.</h2></div><span>{experiment ? titleCase(experiment.primaryMetric) : "SELECT A TEST"}</span></header>
    {experiment ? <form action={action}>
      <input name="experimentId" type="hidden" value={experiment.id} />
      <input name="messageStep" type="hidden" value={experiment.messageStep} />
      <input name="metrics" type="hidden" value={JSON.stringify(rows)} />
      <div className="admin-experiment-entry-context">
        <Field label="Activity date"><input defaultValue={new Date().toISOString().slice(0, 10)} name="activityDate" required type="date" /></Field>
        <Field label="Team member"><input defaultValue="Ajani team" maxLength={100} name="teamMember" required /></Field>
        <Field hint="Optional context for this update." label="Notes"><input maxLength={1000} name="notes" placeholder="Campaign or reporting period" /></Field>
      </div>
      <div className="admin-experiment-entry-grid">{rows.map((row, index) => <section key={row.variantId}>
        <header><b>{row.variantLabel}</b><div><strong>{experiment.variants[index]?.title}</strong><span>{titleCase(experiment.messageStep)} exposure</span></div></header>
        <div className="admin-experiment-input-grid">
          <ExperimentCountInput label={sentLabel} onChange={(value) => updateMetric(index, "sent", value)} value={row.sent} />
          <ExperimentCountInput label="Replies" onChange={(value) => updateMetric(index, "replies", value)} value={row.replies} />
          <ExperimentCountInput label="Positive replies" onChange={(value) => updateMetric(index, "positiveReplies", value)} value={row.positiveReplies} />
          <ExperimentCountInput label="Calls booked" onChange={(value) => updateMetric(index, "callsBooked", value)} value={row.callsBooked} />
          {!isConnectionTest ? <ExperimentCountInput label="Connection requests" onChange={(value) => updateMetric(index, "connectionRequests", value)} value={row.connectionRequests} /> : null}
          <ExperimentCountInput label="Connections accepted" onChange={(value) => updateMetric(index, "connectionsAccepted", value)} value={row.connectionsAccepted} />
        </div>
      </section>)}</div>
      <div className="admin-form-footer"><div>{state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : <p>All counts are stored. The primary metric only decides how variants are ranked.</p>}</div><button disabled={!enabled || pending} type="submit">{pending ? "SAVING COUNTS" : enabled ? "SAVE PERFORMANCE" : "STORAGE NOT READY"}<b>→</b></button></div>
    </form> : <EmptyState title="Select or create an experiment" copy="Once a comparison exists, its variants and performance fields will appear here automatically." />}
  </article>;
}

function ExperimentCountInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input inputMode="numeric" min="0" onChange={(event) => onChange(event.target.value)} type="number" value={value} /></label>;
}

function WebsiteFunnel({ data }: { data: AdminDashboardData }) {
  return <div className="admin-section-stack"><section className="admin-two-column admin-website-layout"><FunnelCard data={data} /><article className="admin-panel admin-demand-panel"><header className="admin-panel-head"><div><p>REQUEST DEMAND</p><h2>What businesses are asking for.</h2></div><span>AI EXTRACTED</span></header>{data.contentDemand.length ? <div>{data.contentDemand.map((item, index) => <p key={item.label}><b>{String(index + 1).padStart(2,"0")}</b><span>{item.label}</span><strong>{item.value}</strong></p>)}</div> : <EmptyState title="No AI-classified demand yet" copy="Automation needs appear here after saved briefs complete the private AI demand extraction." />}</article></section><WebsiteMetricExplanation /></div>;
}

function WebsiteMetricExplanation() {
  const rows = [["Saved briefs","The first durable website intent signal. Anonymous page views are not counted."],["AI processed","The brief produced an auditable AI classification for business vertical and requested automation outcome."],["Scope approved","The visitor approved a specific system definition."],["Account claimed","The anonymous draft was attached to a signed-in business workspace."],["Build submitted","The approved request entered the private build pipeline."]];
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
  return variants.map((variant) => ({ variantId: variant.id || null, variantLabel: variant.label === "NONE" ? "No variant" : variant.label, connectionRequests: 0, connectionsAccepted: 0, initialDms: 0, f1Sent: 0, f2Sent: 0, customSent: 0, replies: 0, attributedReplies: 0, positiveReplies: 0, callsBooked: 0 }));
}

function experimentRows(experiment: OutreachExperiment | null): ExperimentMetricRow[] {
  return experiment?.variants.map((variant) => ({
    variantId: variant.id,
    variantLabel: variant.label,
    sent: 0,
    replies: 0,
    positiveReplies: 0,
    callsBooked: 0,
    connectionRequests: 0,
    connectionsAccepted: 0,
  })) ?? [];
}

function messageStepLabel(step: OutreachExperiment["messageStep"] | undefined) {
  if (!step) return "Messages";
  return ({
    connection_request: "Requests",
    initial_dm: "Initial DMs",
    follow_up_1: "Follow-up 1",
    follow_up_2: "Follow-up 2",
    custom: "Custom messages",
  } as const)[step];
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
