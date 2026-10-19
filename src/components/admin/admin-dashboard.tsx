"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createExperimentAction,
  logExperimentMetricsAction,
  logoutAdminAction,
  setSampleModeAction,
  voidOutreachBatchAction,
} from "@/app/admin/actions";
import { MetricTrends } from "@/components/admin/metric-trends";
import { Connections } from "@/components/admin/connections-panel";
import { LogOutreachPanel, OutreachChannels } from "@/components/admin/outreach-channels-panel";
import { DemandBars, SystemHealth, VariantChart } from "@/components/admin/section-charts";
import { initialAdminActionState } from "@/app/admin/action-state";
import { axisLabels, axisTicks, dayCount, formatMetricValue, goalProgress, goalRateLabel, isEarlyTracking, type GoalProgress, type GoalStatus, type TrendViewId } from "@/lib/admin/metric-query";
import { optionLabel, plural } from "@/lib/admin/display-labels";
import { OUTREACH_CHANNELS } from "@/lib/admin/outreach-channels";
import { renewSignIn, withRenewedSignIn } from "@/lib/admin/fresh-session";
import type { Goal, GoalBoard, MetricCatalog } from "@/lib/admin/metric-types";
import type { ConnectionBoard } from "@/lib/admin/connection-types";
import type {
  AdminDashboardData,
  AdminMetric,
  OutreachChannelBoard,
  OutreachChannelId,
  OutreachExperiment,
  OutreachReplySources,
  TrendPoint,
  VariantPerformance,
} from "@/lib/admin/types";

// Every desk save renews the sign-in first (see fresh-session.ts).
const setSampleMode = withRenewedSignIn(setSampleModeAction);
const voidBatch = withRenewedSignIn(voidOutreachBatchAction);
const createExperiment = withRenewedSignIn(createExperimentAction);
const logExperimentMetrics = withRenewedSignIn(logExperimentMetricsAction);

type Section = "overview" | "trends" | "outreach" | "experiments" | "website" | "operations" | "connections";
/** How Trends opens: on a view, and with Log numbers open on a channel's tab. */
type TrendsRequest = { view: TrendViewId | null; log: boolean; sources: string[] | null };
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
  { id: "trends", label: "Trends", number: "02" },
  { id: "outreach", label: "Outreach", number: "03" },
  { id: "experiments", label: "Experiments", number: "04" },
  { id: "website", label: "Website funnel", number: "05" },
  { id: "operations", label: "Operations", number: "06" },
  { id: "connections", label: "Connections", number: "07" },
];

export function AdminDashboard({ data, catalog, channels, goals, connections, replySources = null, sampleMode = false }: { data: AdminDashboardData; catalog: MetricCatalog; channels: OutreachChannelBoard; goals: GoalBoard; connections: ConnectionBoard; replySources?: OutreachReplySources | null; sampleMode?: boolean }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>("overview");
  // "LOG NUMBERS" opens Trends with its log panel open (on a channel's tab when one is named), and
  // "See every outreach chart" opens its Outreach view; the sidebar opens Trends as it was left.
  const [trendsRequest, setTrendsRequest] = useState<TrendsRequest | null>(null);
  if (trendsRequest && activeSection !== "trends") setTrendsRequest(null);
  const openTrends = (request: TrendsRequest) => { setTrendsRequest(request); setActiveSection("trends"); };
  const logNumbers = () => openTrends({ view: null, log: true, sources: null });
  const logOutreach = (sources: string[] | null) => openTrends({ view: null, log: true, sources });
  const outreachCharts = () => openTrends({ view: "outreach", log: false, sources: null });
  const earlyTracking = !sampleMode && isEarlyTracking(catalog.metrics, data.trend.filter((point) => point.outreach > 0).length, catalog.today);
  const [isRefreshing, startRefresh] = useTransition();
  const lastAutomaticRefreshAt = useRef(0);

  // Each refresh renews the sign-in first: one sent with an expired token reads
  // as signed out, and used to bounce the desk to sign-in and back.
  const refreshDashboard = () => { void renewSignIn().then(() => startRefresh(() => router.refresh())); };
  useEffect(() => {
    const refreshWhenVisible = () => {
      // A hidden or unfocused window can't renew the sign-in reliably.
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;

      const now = Date.now();
      if (now - lastAutomaticRefreshAt.current < 15_000) return;
      lastAutomaticRefreshAt.current = now;
      void renewSignIn().then((renewed) => { if (renewed) startRefresh(() => router.refresh()); });
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
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
        <p><i className={sampleMode ? "sample" : data.dataConnected ? "online" : "offline"} />{sampleMode ? "SAMPLE DATA SHOWN, NOT LIVE" : data.dataConnected ? "LIVE DATA CONNECTED" : "DATA CONNECTION NEEDED"}</p>
        <SampleModeToggle sampleMode={sampleMode} />
        <form action={logoutAdminAction}><button type="submit">LOCK DESK</button></form>
      </div>
    </aside>

    <section className="admin-main">
      {sampleMode ? <SampleBanner section={activeSection} /> : null}
      <AdminHeader section={activeSection} generatedAt={data.generatedAt} isRefreshing={isRefreshing} onRefresh={refreshDashboard} />
      {!data.outreachSchemaReady ? <SetupBanner connected={data.dataConnected} /> : null}
      {data.dataNotice && activeSection !== "trends" && activeSection !== "connections" ? <p className="admin-data-notice" role={data.dataStatus === "unavailable" ? "status" : undefined}>{data.dataNotice}</p> : null}
      {earlyTracking && activeSection !== "connections" ? <EarlyTrackingPrompt /> : null}
      {data.dataStatus !== "unavailable" ? <>
      {activeSection === "overview" ? <Overview channels={channels} data={data} goals={goals} onLogNumbers={logNumbers} onLogOutreach={logOutreach} onNavigate={setActiveSection} onOutreachCharts={outreachCharts} replySources={replySources} /> : null}
      {activeSection === "outreach" ? <Outreach channels={channels} data={data} onLogOutreach={logOutreach} onOutreachCharts={outreachCharts} replySources={replySources} /> : null}
      {activeSection === "experiments" ? <Experiments data={data} key={data.pagination.experimentPage} sampleMode={sampleMode} /> : null}
      {activeSection === "website" ? <WebsiteFunnel data={data} /> : null}
      {activeSection === "operations" ? <Operations data={data} /> : null}
      </> : activeSection === "overview" ? <div className="admin-section-stack"><GrowthGoals board={goals} onLogNumbers={logNumbers} onNavigate={setActiveSection} /></div> : null}
      {/* Trends and connection settings load on their own, so they show even when the dashboard numbers cannot load. */}
      {activeSection === "trends" ? <MetricTrends catalog={catalog} logSources={trendsRequest?.sources ?? null} onNavigate={setActiveSection} openLog={Boolean(trendsRequest?.log)} openView={trendsRequest?.view ?? null} refreshToken={data.generatedAt} sampleMode={sampleMode} /> : null}
      {activeSection === "connections" ? <Connections board={connections} sampleMode={sampleMode} /> : null}
    </section>
  </main>;
}

/** Offered while tracking is new and most charts are empty, so the sample switch is not missed. */
function EarlyTrackingPrompt() {
  const router = useRouter();
  const [state, action, pending] = useActionState(setSampleMode, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  return <aside aria-label="Tracking just started" className="admin-early-prompt">
    <div>
      <span>JUST GETTING STARTED</span>
      <strong>Tracking began recently, so most charts are still empty. Want to see how they will look once numbers come in?</strong>
      <small role={state.status === "error" ? "status" : undefined}>{state.status === "error" ? state.message : "Sample data fills every chart with made-up numbers. Nothing is saved, and you can switch back any time."}</small>
    </div>
    <form action={action}>
      <input name="enabled" type="hidden" value="1" />
      <button disabled={pending} type="submit">{pending ? "SWITCHING" : "SHOW SAMPLE DATA"}<b>→</b></button>
    </form>
  </aside>;
}

/** Shown above every section while sample data is on, so made-up numbers are never mistaken for real ones. */
function SampleBanner({ section }: { section: Section }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setSampleMode, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  return <aside aria-label="Sample data notice" className="admin-sample-banner">
    <div>
      <span>NOT REAL NUMBERS</span>
      <p><strong>SAMPLE DATA</strong><span className="admin-sample-detail"> — made-up numbers so you can see how every chart looks. Nothing here is saved.</span></p>
      {section === "connections" ? <small>Connections below always show your real setup.</small> : null}
      {state.status === "error" ? <small role="status">{state.message}</small> : null}
    </div>
    <form action={action}>
      <input name="enabled" type="hidden" value="0" />
      <button disabled={pending} type="submit">{pending ? "SWITCHING" : "SHOW REAL DATA"}<b>→</b></button>
    </form>
  </aside>;
}

function SampleModeToggle({ sampleMode }: { sampleMode: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setSampleMode, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  return <form action={action} className="admin-sample-toggle">
    <input name="enabled" type="hidden" value={sampleMode ? "0" : "1"} />
    <button
      aria-pressed={sampleMode}
      disabled={pending}
      title={sampleMode ? "Go back to your real numbers" : "Fill every chart with made-up numbers to see how it looks. Nothing is saved."}
      type="submit"
    ><i />SAMPLE DATA: {sampleMode ? "ON" : "OFF"}</button>
    {state.status === "error" ? <small role="status">{state.message}</small> : null}
  </form>;
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

function Overview({ data, channels, goals, replySources, onNavigate, onLogNumbers, onLogOutreach, onOutreachCharts }: { data: AdminDashboardData; channels: OutreachChannelBoard; goals: GoalBoard; replySources: OutreachReplySources | null; onNavigate: (section: Section) => void; onLogNumbers: () => void; onLogOutreach: (sources: string[] | null) => void; onOutreachCharts: () => void }) {
  return <div className="admin-section-stack">
    <GrowthGoals board={goals} onLogNumbers={onLogNumbers} onNavigate={onNavigate} />
    <section className="admin-metric-grid">{data.metrics.map((item) => <MetricCard item={item} key={item.label} />)}</section>
    <section className="admin-two-column admin-chart-row">
      <GrowthChart sources={replySources} trend={data.trend} />
      <FunnelCard data={data} />
    </section>
    <section className="admin-two-column admin-bottom-row">
      <OutreachChannels board={channels} onCharts={onOutreachCharts} />
      <LogOutreachPanel board={channels} onLog={onLogOutreach} />
    </section>
  </div>;
}

const goalStatusLabels: Record<GoalStatus, string> = {
  reached: "REACHED",
  on_pace: "ON PACE",
  behind: "BEHIND PACE",
  missed: "MISSED",
  no_pace: "IN PROGRESS",
  not_logged: "NOT LOGGED",
  not_started: "NOT STARTED",
};

function GrowthGoals({ board, onNavigate, onLogNumbers }: { board: GoalBoard; onNavigate: (section: Section) => void; onLogNumbers?: () => void }) {
  if (board.status === "unavailable") {
    return <aside className="admin-setup-banner">
      <div><span>GOALS UNAVAILABLE</span><b>Apply the growth goals migration (20261016030000) to this database, then refresh.</b></div>
      <p>NO PROGRESS IS IMPLIED</p>
    </aside>;
  }
  if (!board.goals.length) return null;
  const deadline = board.goals.flatMap((goal) => goal.dueDate ? [goal.dueDate] : []).sort()[0] ?? null;
  const daysLeft = deadline ? Math.max(0, dayCount(board.today, deadline) - 1) : null;
  return <article className="admin-panel admin-goals" aria-label="Growth goals">
    <header className="admin-panel-head">
      <div><p>GROWTH GOALS</p><h2>{deadline ? `Progress toward ${formatDate(deadline)}.` : "Progress this week."}</h2></div>
      {daysLeft !== null ? <span>{daysLeft} DAYS LEFT</span> : null}
    </header>
    <div className="admin-goal-grid">{board.goals.map((goal) => <GoalCard goal={goal} key={goal.key} progress={goalProgress(goal, board.today, board.weekStart)} today={board.today} />)}</div>
    <footer className="admin-form-footer admin-goal-foot">
      <div><p>Targets from your Growth Goal Sheet and LinkedIn post system. Each goal updates as soon as its number is logged or synced. The dark marker shows where a steady pace puts you today.</p></div>
      <button onClick={onLogNumbers ?? (() => onNavigate("trends"))} type="button">LOG NUMBERS<b>→</b></button>
    </footer>
  </article>;
}

function GoalCard({ goal, progress, today }: { goal: Goal; progress: GoalProgress; today: string }) {
  const weekly = goal.measure === "weekly";
  const percent = progress.share === null ? null : Math.round(progress.share * 100);
  return <section className={`admin-goal status-${progress.status}`} title={goal.description}>
    <header><h3>{goal.label}</h3><small>{goalStatusLabels[progress.status]}</small></header>
    <p className="admin-goal-value"><strong>{formatMetricValue(goal.current, goal.unit, "compact")}</strong><span>of {formatMetricValue(goal.target, goal.unit, "compact")}{weekly ? " this week" : ""}</span></p>
    <div
      aria-label={`${goal.label} progress`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent === null ? "Nothing logged yet" : `${percent}% of target`}
      className="admin-goal-track"
      role="progressbar"
    >
      <i style={{ width: `${percent ?? 0}%` }} />
      {progress.expectedShare !== null && progress.status !== "reached" ? <b style={{ left: `${progress.expectedShare * 100}%` }} /> : null}
    </div>
    <p className="admin-goal-note">{goalNote(goal, progress)}</p>
    <small className="admin-goal-meta">{goalMeta(goal, today)}</small>
  </section>;
}

function goalNote(goal: Goal, progress: GoalProgress) {
  const weekly = goal.measure === "weekly";
  const amount = (value: number) => formatMetricValue(value, goal.unit, "compact");
  if (progress.status === "not_started") return `Starts ${shortDate(goal.startDate)}.`;
  if (progress.status === "not_logged") return weekly ? "Nothing logged this week yet." : "Nothing logged yet. Log it under Trends.";
  if (progress.status === "reached") return weekly ? "Target hit for this week." : "Target reached.";
  if (progress.status === "missed") return `Deadline passed on ${shortDate(goal.dueDate ?? goal.startDate)}.`;
  const remaining = progress.remaining ?? 0;
  if (weekly) return `${amount(remaining)} more by Sunday.`;
  const rate = goalRateLabel(goal, remaining, progress.daysLeft);
  const pace = progress.status === "behind" && progress.expected !== null ? ` A steady pace means ${amount(progress.expected)} by today.` : "";
  return `Need ${amount(remaining)} more by ${shortDate(goal.dueDate ?? goal.startDate)}${rate ? `, ${rate}` : ""}.${pace}`;
}

function goalMeta(goal: Goal, today: string) {
  if (goal.measure === "weekly") {
    return `Last week: ${goal.lastWeek === null ? "nothing logged" : formatMetricValue(goal.lastWeek, goal.unit)}`;
  }
  if (goal.entryMode === "derived") return "Counted automatically";
  if (!goal.lastRecorded) return "Never logged";
  // A follower count or MRR keeps counting until a newer one replaces it.
  const age = dayCount(goal.lastRecorded, today) - 1;
  return goal.measure === "latest" && age > 30 ? `Last logged ${shortDate(goal.lastRecorded)}, ${age} days ago. Log a fresh number.` : `Last logged ${shortDate(goal.lastRecorded)}`;
}

function MetricCard({ item }: { item: AdminMetric }) {
  return <article className={`admin-metric-card tone-${item.tone}`}>
    <div><span>{item.label}</span>{item.delta === null ? <small>30D</small> : <small className={item.delta >= 0 ? "up" : "down"}>{item.delta >= 0 ? "↑" : "↓"} {Math.abs(item.delta).toFixed(1)}%</small>}</div>
    <strong>{item.value}</strong><p>{item.detail}</p>
  </article>;
}

/**
 * `only` pins one series and hides the switch, for sections that are about one flow. Bars are buttons, so a tap or a key shows their numbers.
 * With `sources`, each Outreach replies bar is split by the channel the replies came from.
 */
function GrowthChart({ trend, only, sources = null }: { trend: TrendPoint[]; only?: "outreach" | "website"; sources?: OutreachReplySources | null }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [picked, setSeries] = useState<"outreach" | "website">("outreach");
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const series = only ?? picked;
  const points = useMemo(() => chartPoints(trend.slice(-range), range, sources), [range, sources, trend]);
  const split = series === "outreach" && sources !== null;
  const parts = points.map((point) => split ? replyParts(point) : []);
  const sourceTotals = OUTREACH_CHANNELS.map((channel) => points.reduce((sum, point) => sum + (point.sources?.[channel.id] ?? 0), 0));
  const partsText = (index: number) => parts[index].length ? ` (${parts[index].map(partText).join(", ")})` : "";
  const primaryKey = series === "outreach" ? "outreach" : "drafts";
  const secondaryKey = series === "outreach" ? "replies" : "submissions";
  const ticks = axisTicks(points.flatMap((point) => [point[primaryKey], point[secondaryKey]]), { fromZero: true, whole: true });
  const tickLabels = axisLabels(ticks, "count");
  const barHeight = (value: number) => `${Math.max(value ? 5 : 0, (value / (ticks[2] || 1)) * 100)}%`;
  const primaryTotal = points.reduce((sum, point) => sum + point[primaryKey], 0);
  const secondaryTotal = points.reduce((sum, point) => sum + point[secondaryKey], 0);
  const names = series === "outreach" ? ["touches", "replies"] : ["saved drafts", "submitted builds"];
  const active = hovered ?? pinned;
  const when = (date: string) => range === 90 ? `From ${shortDate(date)}` : shortDate(date);
  const pickRange = (value: 7 | 30 | 90) => { setRange(value); setPinned(null); };

  return <article className="admin-panel admin-growth-panel">
    <header className="admin-panel-head"><div><p>GROWTH OVER TIME</p><h2>{series === "outreach" ? "Outreach activity" : "Website demand"}</h2></div>{only ? <span>{range === 90 ? "7 DAYS PER BAR" : "DAY BY DAY"}</span> : <div className="admin-segmented"><button aria-pressed={series === "outreach"} onClick={() => { setSeries("outreach"); setPinned(null); }} type="button">OUTREACH</button><button aria-pressed={series === "website"} onClick={() => { setSeries("website"); setPinned(null); }} type="button">WEBSITE</button></div>}</header>
    <div className="admin-chart-summary"><p><span>{series === "outreach" ? "TOUCHES" : "SAVED DRAFTS"}</span><b>{formatNumber(primaryTotal)}</b></p><p><span>{series === "outreach" ? "REPLIES" : "SUBMITTED BUILDS"}</span><b>{formatNumber(secondaryTotal)}</b></p><small>LAST {range} DAYS</small></div>
    {primaryTotal + secondaryTotal === 0 ? <p className="admin-chart-empty admin-growth-empty">{series === "outreach" ? `No outreach logged in the last ${range} days yet.` : `No briefs saved or builds submitted in the last ${range} days yet.`}</p> : <div aria-label={`${names[0]} and ${names[1]} ${range === 90 ? "in groups of 7 days" : "per day"} over the last ${range} days: ${formatNumber(primaryTotal)} ${names[0]}, ${formatNumber(secondaryTotal)} ${names[1]}. Select a bar to read its numbers.`} className="admin-bar-chart" role="group">
      <div aria-hidden="true" className="admin-bar-axis">{[2, 1, 0].map((index) => <span key={index}>{tickLabels[index]}</span>)}</div>
      {points.map((point, index) => <button aria-label={`${when(point.date)}: ${formatNumber(point[primaryKey])} ${names[0]}, ${formatNumber(point[secondaryKey])} ${names[1]}${partsText(index)}`} className={`admin-bar-group${active === index ? " active" : ""}`} key={point.date} onBlur={() => setPinned((current) => current === index ? null : current)} onClick={() => setPinned(index)} onFocus={() => setPinned(index)} onKeyDown={(event) => { if (event.key === "Escape") setPinned(null); }} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} type="button">
        <b className="admin-bar-pair"><i style={{ height: barHeight(point[primaryKey]) }} />{parts[index].length ? <i className="admin-bar-stack" style={{ height: barHeight(point[secondaryKey]) }}>{parts[index].map((part) => <span className={`admin-reply-${part.id}`} key={part.id} style={{ flexGrow: part.value }} />)}</i> : <i style={{ height: barHeight(point[secondaryKey]) }} />}</b>
        {showAxisLabel(index, points.length) ? <span aria-hidden="true">{shortDate(point.date)}</span> : null}
        {active === index ? <em aria-hidden="true" className={`admin-bar-tip${index < points.length / 4 ? " start" : index >= (points.length * 3) / 4 ? " end" : ""}`}><strong>{when(point.date)}</strong><small>{formatNumber(point[primaryKey])} {names[0]}</small><small>{formatNumber(point[secondaryKey])} {names[1]}</small>{parts[index].map((part) => <small className={`admin-tip-source admin-reply-${part.id}`} key={part.id}><i />{partText(part)}</small>)}</em> : null}
      </button>)}
    </div>}
    <footer className="admin-chart-foot"><div><span><i />{series === "outreach" ? "TOUCHES" : "SAVED DRAFTS"}</span>{split ? <>
      <span className="admin-reply-heading">REPLIES FROM</span>
      {OUTREACH_CHANNELS.map((channel, index) => <span className={`admin-reply-key admin-reply-${channel.id}`} key={channel.id}><i />{channel.label.toUpperCase()} {formatNumber(sourceTotals[index])}</span>)}
    </> : <span><i />{series === "outreach" ? "REPLIES" : "SUBMITTED BUILDS"}</span>}</div><div className="admin-segmented small">{([7, 30, 90] as const).map((value) => <button aria-pressed={range === value} key={value} onClick={() => pickRange(value)} type="button">{value}D</button>)}</div></footer>
  </article>;
}

function FunnelCard({ data }: { data: AdminDashboardData }) {
  const max = Math.max(1, data.funnel[0]?.value ?? 0);
  return <article className="admin-panel admin-funnel-panel">
    <header className="admin-panel-head"><div><p>WEBSITE FUNNEL</p><h2>From saved brief to build.</h2></div><span>180D</span></header>
    <div className="admin-funnel-list">{data.funnel.map((stage, index) => <div key={stage.label}><p><b>0{index + 1}</b><span>{stage.label}</span><strong>{stage.value}</strong><small>{stage.rate === null ? "N/A" : `${stage.rate.toFixed(1)}%`}</small></p><i><span style={{ width: `${(stage.value / max) * 100}%` }} /></i></div>)}</div>
  </article>;
}

/** Experiment results as they were saved, newest first, so a mistaken one can be voided. */
function RecentActivity({ data, sampleMode }: { data: AdminDashboardData; sampleMode: boolean }) {
  return <article className="admin-panel admin-recent-panel"><header className="admin-panel-head"><div><p>RECENT ENTRIES</p><h2>Latest results logged.</h2></div><span>{String(data.recentBatches.length).padStart(2, "0")} LOGS</span></header>
    {data.recentBatches.length ? <div className="admin-recent-list with-actions">{data.recentBatches.map((batch) => <div key={batch.id}><time>{shortDate(batch.date)}</time><p><b>{batch.teamMember}</b><span>{contextLabel(batch.context)}</span></p><strong>{batch.sent}<small> SENT</small></strong><em>{plural(batch.replies, "reply", "replies")} / {plural(batch.calls, "call", "calls")}</em><VoidBatchControl batchId={batch.id} sampleMode={sampleMode} /></div>)}</div> : <EmptyState title="No results logged yet" copy="Results you save under Enter performance appear here, and one logged by mistake can be voided." />}
    <AdminPagination data={data} kind="batches" />
  </article>;
}

/** Wrong entries are voided, not deleted: they stay audited but stop counting. */
function VoidBatchControl({ batchId, sampleMode }: { batchId: string; sampleMode: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidBatch, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.entityId, state.status]);
  if (!open) return <button className="admin-void-toggle" onClick={() => setOpen(true)} type="button">VOID</button>;
  return <form action={action} className="admin-void-form">
    <input name="batchId" type="hidden" value={batchId} />
    {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
    <label><span className="sr-only">Reason for voiding</span><input autoFocus maxLength={300} minLength={3} name="reason" placeholder="Why? e.g. logged twice" required /></label>
    <button disabled={sampleMode || pending} type="submit">{pending ? "VOIDING" : "CONFIRM VOID"}</button>
    <button onClick={() => setOpen(false)} type="button">CANCEL</button>
    {sampleMode ? <SampleFormNote /> : state.status === "error" ? <p className="admin-form-message error" role="status">{state.message}</p> : null}
  </form>;
}

/** Outreach is three channels added up: Dripify, Reddit DMs and cold calls. */
function Outreach({ data, channels, replySources, onLogOutreach, onOutreachCharts }: { data: AdminDashboardData; channels: OutreachChannelBoard; replySources: OutreachReplySources | null; onLogOutreach: (sources: string[] | null) => void; onOutreachCharts: () => void }) {
  return <div className="admin-section-stack">
    <OutreachChannels board={channels} onCharts={onOutreachCharts} />
    <section className="admin-two-column admin-chart-row admin-outreach-charts"><GrowthChart only="outreach" sources={replySources} trend={data.trend} /><LogOutreachPanel board={channels} onLog={onLogOutreach} /></section>
  </div>;
}

function Experiments({ data, sampleMode }: { data: AdminDashboardData; sampleMode: boolean }) {
  const [selectedId, setSelectedId] = useState(data.experiments[0]?.id ?? "");
  const experiment = data.experiments.find((item) => item.id === selectedId) ?? data.experiments[0] ?? null;
  const performance = experiment ? data.experimentPerformance[experiment.id] ?? [] : [];
  return <div className="admin-section-stack">
    <section className="admin-two-column admin-experiment-layout"><ExperimentForm enabled={data.outreachSchemaReady} sampleMode={sampleMode} /><ExperimentComparison experiment={experiment} experiments={data.experiments} pager={<AdminPagination data={data} kind="experiments" />} performance={performance} selectedId={selectedId} setSelectedId={setSelectedId} /></section>
    <ExperimentMetricEntry enabled={data.outreachSchemaReady} experiment={experiment} key={experiment?.id ?? "no-experiment"} sampleMode={sampleMode} />
    <RecentActivity data={data} sampleMode={sampleMode} />
    <article className="admin-panel admin-rules-panel"><header className="admin-panel-head"><div><p>MEASUREMENT RULES</p><h2>How results are judged.</h2></div></header><div>{[["01","Fair comparison","Each variant is measured against how many it sent at the step being tested."],["02","Points and percent","Going from 5% to 8% is 3 points higher, which is 60% better."],["03","Replies stay put","A reply counts for the step and variant that earned it."],["04","No early winners","A variant is only marked as leading once there is enough data and the gap is too big to be luck."]].map(([number,title,copy]) => <section key={number}><b>{number}</b><h3>{title}</h3><p>{copy}</p></section>)}</div></article>
  </div>;
}

function AdminPagination({ data, kind }: { data: AdminDashboardData; kind: "experiments" | "batches" }) {
  const { experimentPage, batchPage, experimentCount, batchCount } = data.pagination;
  const page = kind === "experiments" ? experimentPage : batchPage;
  const size = kind === "experiments" ? 25 : 20;
  const count = kind === "experiments" ? experimentCount : batchCount;
  const href = (next: number) => `/admin?experiments=${kind === "experiments" ? next : experimentPage}&batches=${kind === "batches" ? next : batchPage}`;
  if (page === 0 && count <= size) return null;
  return <nav aria-label={`${kind} pages`} className="admin-pagination">
    <span>{count ? `${Math.min(page * size + 1, count)}–${Math.min((page + 1) * size, count)} of ${count}` : "No"} {kind}. Totals include all pages.</span>
    {page > 0 ? <Link href={href(page - 1)} prefetch={false} scroll={false}>Previous {kind}</Link> : null}
    {(page + 1) * size < count ? <Link href={href(page + 1)} prefetch={false} scroll={false}>Next {kind}</Link> : null}
  </nav>;
}

function ExperimentForm({ enabled, sampleMode }: { enabled: boolean; sampleMode: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createExperiment, initialAdminActionState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <article className="admin-panel admin-experiment-form"><header className="admin-panel-head"><div><p>NEW EXPERIMENT</p><h2>Create a flexible comparison.</h2></div><span>A / B / CUSTOM</span></header><form action={action} key={state.entityId ?? "new-experiment"}>
    {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
    <Field label="Experiment title"><input maxLength={120} name="title" placeholder="TCPA angle vs speed-to-lead" required /></Field>
    <Field label="Audience"><input maxLength={120} name="audience" placeholder="Insurance agency owners" required /></Field>
    <Field label="Campaign, optional"><input maxLength={120} name="campaign" placeholder="August manual outreach" /></Field>
    <div className="admin-form-pair"><Field label="Channel"><select defaultValue="linkedin" name="channel"><option value="linkedin">LinkedIn</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option></select></Field><Field label="Method"><select defaultValue="manual" name="method"><option value="manual">Manual</option><option value="dripify">Dripify</option><option value="organic">Organic</option></select></Field></div>
    <div className="admin-form-pair"><Field label="Message step"><select defaultValue="initial_dm" name="messageStep"><option value="connection_request">Connection request</option><option value="initial_dm">Initial DM</option><option value="follow_up_1">Follow-up 1</option><option value="follow_up_2">Follow-up 2</option><option value="custom">Custom step</option></select></Field><Field label="Primary metric"><select defaultValue="reply_rate" name="primaryMetric"><option value="reply_rate">Reply rate</option><option value="positive_reply_rate">Positive reply rate</option><option value="booking_rate">Booking rate</option><option value="acceptance_rate">Connection acceptance</option></select></Field></div>
    <Field hint="Comma-separated. Labels A, B, C are assigned automatically." label="Variant titles"><input maxLength={500} name="variants" placeholder="TCPA hook, Speed-to-lead hook" required /></Field>
    {sampleMode ? <SampleFormNote /> : state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : null}
    <button disabled={sampleMode || !enabled || pending} type="submit">{pending ? "CREATING" : enabled ? "CREATE EXPERIMENT" : "STORAGE NOT READY"}<b>→</b></button>
  </form></article>;
}

function ExperimentComparison({ experiment, experiments, pager, performance, selectedId, setSelectedId }: { experiment: OutreachExperiment | null; experiments: OutreachExperiment[]; pager: React.ReactNode; performance: VariantPerformance[]; selectedId: string; setSelectedId: (id: string) => void }) {
  const maxRate = Math.max(1, ...performance.map((item) => item.primaryRate ?? 0));
  return <article className="admin-panel admin-comparison-panel"><header className="admin-panel-head"><div><p>VARIANT COMPARISON</p><h2>{experiment?.title ?? "No experiment yet"}</h2></div>{experiments.length ? <select aria-label="Select experiment" onChange={(event) => setSelectedId(event.target.value)} value={selectedId || experiment?.id}>{experiments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : null}</header>
    {experiment ? <><div className="admin-experiment-meta"><span>{experiment.audience}</span><span>{optionText(experiment.channel)}</span><span>{optionText(experiment.method)}</span><span>{optionText(experiment.messageStep)}</span><span>{optionText(experiment.primaryMetric)}</span></div><div className="admin-variant-list">{performance.map((variant) => <section key={variant.id}><header><b>{variant.label}</b><p><strong>{variant.title}</strong><span>{variant.status.toUpperCase()}</span></p><em>{variant.primaryRate === null ? "N/A" : `${variant.primaryRate.toFixed(1)}%`}</em></header><div className="admin-variant-track"><span style={{ width: `${((variant.primaryRate ?? 0) / maxRate) * 100}%` }} /></div><footer><span>{variant.primaryMetricLabel}</span><span>{variant.sent} sent</span><span>{plural(variant.replies, "reply", "replies")}</span><span>{variant.positiveReplies} positive</span><span>{variant.callsBooked} booked</span><span>{variant.connectionsAccepted}/{variant.connectionRequests} connections</span></footer></section>)}</div><VariantChart experiment={experiment} performance={performance} /></> : <EmptyState title="Create the first experiment" copy="Variants remain optional and receive their labels automatically. Your team controls every title and audience." />}
    {pager}
  </article>;
}

function ExperimentMetricEntry({ experiment, enabled, sampleMode }: { experiment: OutreachExperiment | null; enabled: boolean; sampleMode: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(logExperimentMetrics, initialAdminActionState);
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
    <header className="admin-panel-head"><div><p>ENTER PERFORMANCE</p><h2>Log new results for every variant.</h2></div><span>{experiment ? optionText(experiment.primaryMetric) : "SELECT A TEST"}</span></header>
    {experiment ? <form action={action}>
      <input name="experimentId" type="hidden" value={experiment.id} />
      {sampleMode ? <input name="sample" type="hidden" value="1" /> : null}
      <input name="messageStep" type="hidden" value={experiment.messageStep} />
      <input name="metrics" type="hidden" value={JSON.stringify(rows)} />
      <div className="admin-experiment-entry-context">
        <Field label="Activity date"><input defaultValue={new Date().toISOString().slice(0, 10)} name="activityDate" required type="date" /></Field>
        <Field label="Team member"><input defaultValue="Ajani team" maxLength={100} name="teamMember" required /></Field>
        <Field hint="Optional context for this update." label="Notes"><input maxLength={1000} name="notes" placeholder="Campaign or reporting period" /></Field>
      </div>
      <div className="admin-experiment-entry-grid">{rows.map((row, index) => <section key={row.variantId}>
        <header><b>{row.variantLabel}</b><div><strong>{experiment.variants[index]?.title}</strong><span>Tested at {optionText(experiment.messageStep)}</span></div></header>
        <div className="admin-experiment-input-grid">
          <ExperimentCountInput label={sentLabel} onChange={(value) => updateMetric(index, "sent", value)} value={row.sent} />
          <ExperimentCountInput label="Replies" onChange={(value) => updateMetric(index, "replies", value)} value={row.replies} />
          <ExperimentCountInput label="Positive replies" onChange={(value) => updateMetric(index, "positiveReplies", value)} value={row.positiveReplies} />
          <ExperimentCountInput label="Calls booked" onChange={(value) => updateMetric(index, "callsBooked", value)} value={row.callsBooked} />
          {!isConnectionTest ? <ExperimentCountInput label="Connection requests" onChange={(value) => updateMetric(index, "connectionRequests", value)} value={row.connectionRequests} /> : null}
          <ExperimentCountInput label="Connections accepted" onChange={(value) => updateMetric(index, "connectionsAccepted", value)} value={row.connectionsAccepted} />
        </div>
      </section>)}</div>
      <div className="admin-form-footer"><div>{sampleMode ? <SampleFormNote /> : state.message ? <p className={`admin-form-message ${state.status}`} role="status">{state.message}</p> : <p>Each save adds to the totals, so log only activity since your last entry. Void a mistaken entry under Recent entries below.</p>}</div><button disabled={sampleMode || !enabled || pending} type="submit">{pending ? "SAVING COUNTS" : enabled ? "SAVE PERFORMANCE" : "STORAGE NOT READY"}<b>→</b></button></div>
    </form> : <EmptyState title="Select or create an experiment" copy="Once a comparison exists, its variants and performance fields will appear here automatically." />}
  </article>;
}

function ExperimentCountInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input inputMode="numeric" min="0" onChange={(event) => onChange(event.target.value)} type="number" value={value} /></label>;
}

function WebsiteFunnel({ data }: { data: AdminDashboardData }) {
  return <div className="admin-section-stack"><section className="admin-two-column admin-website-layout"><FunnelCard data={data} /><article className="admin-panel admin-demand-panel"><header className="admin-panel-head"><div><p>REQUEST DEMAND</p><h2>What businesses are asking for.</h2></div><span>AI EXTRACTED</span></header>{data.contentDemand.length ? <DemandBars items={data.contentDemand} /> : <EmptyState title="No AI-classified demand yet" copy="Automation needs appear here after saved briefs complete the private AI demand extraction." />}</article></section><GrowthChart only="website" trend={data.trend} /><WebsiteMetricExplanation /></div>;
}

function WebsiteMetricExplanation() {
  const rows = [["Saved briefs","The first solid sign a visitor wants a system built. Page views alone are not counted."],["AI processed","AI read the brief and noted the type of business and the automation it asks for."],["Scope approved","The visitor approved a specific plan for their system."],["Account claimed","The visitor signed in, and the draft moved into their business account."],["Build submitted","The approved request was sent to the team to build."]];
  return <article className="admin-panel admin-definition-panel"><header className="admin-panel-head"><div><p>STATISTIC DEFINITIONS</p><h2>What each number means.</h2></div></header><div>{rows.map(([label,copy],index) => <section key={label}><b>0{index+1}</b><h3>{label}</h3><p>{copy}</p></section>)}</div></article>;
}

function Operations({ data }: { data: AdminDashboardData }) {
  return <div className="admin-section-stack"><SystemHealth systems={data.operations} /><section className="admin-operations-grid">{data.operations.map((item) => <article className="admin-panel" key={item.label}><header><div><i className={item.attention ? "attention" : "healthy"} /><span>{item.attention ? "ATTENTION" : "HOLDING"}</span></div><b>{item.label}</b></header><div><p><span>HEALTHY</span><strong>{item.healthy}</strong></p><p><span>NEEDS REVIEW</span><strong>{item.attention}</strong></p></div><footer>{item.detail}</footer></article>)}</section><article className="admin-panel admin-ops-note"><p>OPERATING PRINCIPLE</p><h2>Failures surface here. Credentials and private provider errors do not.</h2><span>The control desk reports job state, retries, health, and attention signals while sensitive keys remain server-only.</span></article></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

/** Sample numbers are made up, so every form that writes stays locked while they show. */
function SampleFormNote() {
  return <p className="admin-form-message sample">Sample data is on, so nothing can be saved. Switch to real data to log.</p>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="admin-empty"><i>+</i><b>{title}</b><p>{copy}</p></div>;
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

type ChartPoint = TrendPoint & { sources: Record<OutreachChannelId, number> | null };

/** Days as they are, or 7-day groups for 90 days; each carries its replies by channel when known. */
function chartPoints(points: TrendPoint[], range: number, sources: OutreachReplySources | null): ChartPoint[] {
  const days = points.map((point) => ({ ...point, sources: sources?.[point.date] ? { ...sources[point.date] } : null }));
  if (range !== 90) return days;
  const weeks: ChartPoint[] = [];
  days.forEach((point, index) => {
    const bucket = Math.floor(index / 7);
    weeks[bucket] ??= { date: point.date, drafts: 0, submissions: 0, outreach: 0, replies: 0, sources: null };
    weeks[bucket].drafts += point.drafts; weeks[bucket].submissions += point.submissions; weeks[bucket].outreach += point.outreach; weeks[bucket].replies += point.replies;
    if (point.sources) {
      const week = weeks[bucket].sources ??= { dripify: 0, reddit: 0, cold_calls: 0 };
      OUTREACH_CHANNELS.forEach((channel) => { week[channel.id] += point.sources![channel.id]; });
    }
  });
  return weeks;
}

/**
 * A bar's replies by channel, bottom to top. Any reply the channels don't
 * account for stays in the plain replies colour, so the bar always matches
 * the total.
 */
function replyParts(point: ChartPoint) {
  const parts: Array<{ id: string; label: string; value: number }> = OUTREACH_CHANNELS
    .map((channel) => ({ id: channel.id, label: channel.label, value: point.sources?.[channel.id] ?? 0 }))
    .filter((part) => part.value > 0);
  const unsplit = point.replies - parts.reduce((sum, part) => sum + part.value, 0);
  return unsplit > 0 ? [...parts, { id: "unsplit", label: "", value: unsplit }] : parts;
}

function partText(part: { id: string; label: string; value: number }) {
  return part.id === "unsplit" ? `${formatNumber(part.value)} not matched to a channel` : `${formatNumber(part.value)} from ${part.label}`;
}

function showAxisLabel(index: number, length: number) { return index === 0 || index === length - 1 || index === Math.floor(length / 2); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function shortDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatTime(value: string) { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function optionText(value: string) { return optionLabel(value) ?? titleCase(value); }
/** Batch context arrives as "Linkedin / Dripify / Audience"; known options get their proper names. */
function contextLabel(value: string) { return value.split(" / ").map((part) => optionLabel(part) ?? part).join(" / "); }
