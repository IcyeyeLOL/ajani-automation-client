import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAdequateProportionSample, multipleComparisonCriticalZ, twoProportionZScore } from "@/lib/admin/statistics";
import type {
  AdminDashboardData,
  AdminMetric,
  FunnelStage,
  OperationsStatus,
  OutreachExperiment,
  OutreachMessageStep,
  OutreachTotals,
  RecentBatch,
  TrendPoint,
  VariantPerformance,
} from "@/lib/admin/types";

type Row = Record<string, unknown>;
type ReadResult = { rows: Row[]; available: boolean };

const DAY_MS = 86_400_000;

export async function loadAdminDashboardData(): Promise<AdminDashboardData> {
  const generatedAt = new Date().toISOString();
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return emptyDashboard(generatedAt);
  }

  const since = new Date(Date.now() - 180 * DAY_MS).toISOString();
  const [
    drafts,
    aiStates,
    builds,
    organizations,
    quotes,
    subscriptions,
    systems,
    aiRuns,
    transcriptionJobs,
    notificationJobs,
    experimentsResult,
    variantsResult,
    batchesResult,
    batchMetricsResult,
  ] = await Promise.all([
    readRows(admin, "request_drafts", "id,status,payload,claimed_at,submitted_build_request_id,created_at,updated_at", "created_at", since),
    readRows(admin, "request_draft_ai_states", "request_draft_id,state,clarification_round,approved_revision,confidence,requires_human_review,latest_extraction,created_at,updated_at", "created_at", since),
    readRows(admin, "build_requests", "id,request_draft_id,status,quoted_amount_cents,paid_at,created_at,updated_at", "created_at", since),
    readRows(admin, "organizations", "id,industry,budget_tier,created_at", "created_at", since),
    readRows(admin, "build_request_quotes", "id,tier,amount_cents,review_status,created_at,reviewed_at"),
    readRows(admin, "billing_subscriptions", "id,status,amount_cents,interval,created_at"),
    readRows(admin, "automation_systems", "id,status,health,last_success_at,last_error_at,created_at"),
    readRows(admin, "request_draft_ai_runs", "id,task,status,latency_ms,error_code,created_at,completed_at", "created_at", since),
    readRows(admin, "voice_memo_transcription_jobs", "id,status,attempt_count,confidence,started_at,completed_at,created_at", "created_at", since),
    readRows(admin, "build_request_notification_jobs", "build_request_id,status,attempt_count,created_at,sent_at", "created_at", since),
    readRows(admin, "outreach_experiments", "id,title,audience,campaign,channel,method,message_step,primary_metric,status,created_at"),
    readRows(admin, "outreach_variants", "id,experiment_id,label,title,sort_order,active,created_at"),
    readRows(admin, "outreach_batches", "id,activity_date,team_member,channel,method,audience,campaign,experiment_id,created_at"),
    readRows(admin, "outreach_batch_metrics", "id,batch_id,variant_id,variant_label,connection_requests,connections_accepted,initial_dms,f1_sent,f2_sent,custom_sent,replies,attributed_replies,positive_replies,calls_booked,created_at"),
  ]);

  const coreAvailable = drafts.available || builds.available || organizations.available;
  const outreachSchemaReady = experimentsResult.available && variantsResult.available && batchesResult.available && batchMetricsResult.available;
  const experiments = shapeExperiments(experimentsResult.rows, variantsResult.rows);
  const batchById = new Map(batchesResult.rows.map((batch) => [stringValue(batch.id), batch]));
  const outreach = aggregateOutreach(batchMetricsResult.rows);
  const experimentPerformance = aggregateExperimentPerformance(experiments, batchesResult.rows, batchMetricsResult.rows);
  const trend = buildTrend(drafts.rows, builds.rows, batchesResult.rows, batchMetricsResult.rows);
  const funnel = buildFunnel(drafts.rows, aiStates.rows);
  const operations = buildOperations(systems.rows, aiRuns.rows, transcriptionJobs.rows, notificationJobs.rows);
  const recentBatches = buildRecentBatches(batchesResult.rows, batchMetricsResult.rows);
  const contentDemand = buildContentDemand(aiStates.rows);
  const metrics = buildMetrics({
    drafts: drafts.rows,
    builds: builds.rows,
    organizations: organizations.rows,
    quotes: quotes.rows,
    subscriptions: subscriptions.rows,
    batches: batchesResult.rows,
    batchMetrics: batchMetricsResult.rows,
    batchById,
  });

  return {
    generatedAt,
    dataConnected: coreAvailable,
    outreachSchemaReady,
    metrics,
    trend,
    funnel,
    outreach,
    experiments,
    experimentPerformance,
    operations,
    recentBatches,
    contentDemand,
  };
}

async function readRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  columns: string,
  dateColumn?: string,
  since?: string,
): Promise<ReadResult> {
  let query = admin.from(table).select(columns).limit(10_000);
  if (dateColumn && since) query = query.gte(dateColumn, since);
  const { data, error } = await query;
  if (error) {
    console.error("Admin dashboard query failed", { table, code: error.code, message: error.message });
    return { rows: [], available: false };
  }
  return { rows: (data ?? []) as unknown as Row[], available: true };
}

function emptyDashboard(generatedAt: string): AdminDashboardData {
  return {
    generatedAt,
    dataConnected: false,
    outreachSchemaReady: false,
    metrics: [
      metric("Saved drafts", "0", "Connect Supabase to load website activity", null, "neutral"),
      metric("Submitted builds", "0", "No connected request data", null, "neutral"),
      metric("Outreach touches", "0", "Apply the outreach migration to begin", null, "brand"),
      metric("Replies", "0", "No outreach data yet", null, "neutral"),
      metric("Quoted pipeline", "$0", "Pricing remains editable per request", null, "neutral"),
      metric("Monthly retainers", "$0", "No active subscriptions connected", null, "success"),
    ],
    trend: emptyTrend(),
    funnel: ["Brief saved", "AI processed", "Scope approved", "Account claimed", "Build submitted"].map((label) => ({ label, value: 0, rate: null })),
    outreach: emptyOutreach(),
    experiments: [],
    experimentPerformance: {},
    operations: [],
    recentBatches: [],
    contentDemand: [],
  };
}

function buildMetrics(input: {
  drafts: Row[];
  builds: Row[];
  organizations: Row[];
  quotes: Row[];
  subscriptions: Row[];
  batches: Row[];
  batchMetrics: Row[];
  batchById: Map<string, Row>;
}): AdminMetric[] {
  const now = Date.now();
  const currentStart = now - 30 * DAY_MS;
  const previousStart = now - 60 * DAY_MS;
  const countPeriod = (rows: Row[], key: string, start: number, end: number) => rows.filter((row) => {
    const time = Date.parse(stringValue(row[key]));
    return Number.isFinite(time) && time >= start && time < end;
  }).length;
  const draftCurrent = countPeriod(input.drafts, "created_at", currentStart, now + 1);
  const draftPrevious = countPeriod(input.drafts, "created_at", previousStart, currentStart);
  const buildCurrent = countPeriod(input.builds, "created_at", currentStart, now + 1);
  const buildPrevious = countPeriod(input.builds, "created_at", previousStart, currentStart);
  const draftCohortSubmitted = input.drafts.filter((row) => {
    const time = Date.parse(stringValue(row.created_at));
    return Number.isFinite(time) && time >= currentStart && Boolean(row.submitted_build_request_id);
  }).length;
  const orgCurrent = countPeriod(input.organizations, "created_at", currentStart, now + 1);
  const currentBatchIds = new Set(input.batches.filter((row) => Date.parse(stringValue(row.activity_date)) >= currentStart).map((row) => stringValue(row.id)));
  const previousBatchIds = new Set(input.batches.filter((row) => {
    const time = Date.parse(stringValue(row.activity_date));
    return time >= previousStart && time < currentStart;
  }).map((row) => stringValue(row.id)));
  const sumTouches = (ids: Set<string>) => input.batchMetrics.reduce((sum, row) => ids.has(stringValue(row.batch_id))
    ? sum + outreachTouchCount(row)
    : sum, 0);
  const sumReplies = (ids: Set<string>) => input.batchMetrics.reduce((sum, row) => ids.has(stringValue(row.batch_id)) ? sum + numberValue(row.replies) : sum, 0);
  const outreachCurrent = sumTouches(currentBatchIds);
  const outreachPrevious = sumTouches(previousBatchIds);
  const repliesCurrent = sumReplies(currentBatchIds);
  const repliesPrevious = sumReplies(previousBatchIds);
  const pipeline = input.quotes.filter((row) => stringValue(row.review_status) !== "rejected").reduce((sum, row) => sum + numberValue(row.amount_cents), 0);
  const mrr = input.subscriptions.filter((row) => stringValue(row.status) === "active" && stringValue(row.interval) === "month").reduce((sum, row) => sum + numberValue(row.amount_cents), 0);

  return [
    metric("Saved drafts", formatNumber(draftCurrent), `${orgCurrent} new business workspace${orgCurrent === 1 ? "" : "s"}`, growth(draftCurrent, draftPrevious), "neutral"),
    metric("Submitted builds", formatNumber(buildCurrent), draftCurrent ? `${percentage(draftCohortSubmitted, draftCurrent)?.toFixed(1)}% of 30-day drafts converted` : "No drafts in this 30-day cohort", growth(buildCurrent, buildPrevious), "brand"),
    metric("Outreach touches", formatNumber(outreachCurrent), "Manual and Dripify activity", growth(outreachCurrent, outreachPrevious), "brand"),
    metric("Replies", formatNumber(repliesCurrent), rateLabel(repliesCurrent, initialDmsForIds(input.batchMetrics, currentBatchIds), "reply rate"), growth(repliesCurrent, repliesPrevious), "success"),
    metric("Quoted pipeline", formatMoney(pipeline), "Pending and approved quotes", null, "neutral"),
    metric("Monthly retainers", formatMoney(mrr), "Active monthly subscriptions", null, "success"),
  ];
}

function buildFunnel(drafts: Row[], aiStates: Row[]): FunnelStage[] {
  const aiByDraft = new Map(aiStates.map((state) => [stringValue(state.request_draft_id), state]));
  const saved = drafts.length;
  const processed = drafts.filter((draft) => {
    const state = aiByDraft.get(stringValue(draft.id));
    return state && hasAiDemandExtraction(objectValue(state.latest_extraction));
  }).length;
  const approved = drafts.filter((draft) => numberOrNull(aiByDraft.get(stringValue(draft.id))?.approved_revision) !== null).length;
  const claimed = drafts.filter((draft) => Boolean(draft.claimed_at)).length;
  const submitted = drafts.filter((draft) => Boolean(draft.submitted_build_request_id)).length;
  return [
    { label: "Brief saved", value: saved, rate: saved ? 100 : null },
    { label: "AI processed", value: processed, rate: percentage(processed, saved) },
    { label: "Scope approved", value: approved, rate: percentage(approved, saved) },
    { label: "Account claimed", value: claimed, rate: percentage(claimed, saved) },
    { label: "Build submitted", value: submitted, rate: percentage(submitted, saved) },
  ];
}

function buildTrend(drafts: Row[], builds: Row[], batches: Row[], metrics: Row[]): TrendPoint[] {
  const points = emptyTrend();
  const byDate = new Map(points.map((point) => [point.date, point]));
  drafts.forEach((row) => increment(byDate, stringValue(row.created_at).slice(0, 10), "drafts", 1));
  builds.forEach((row) => increment(byDate, stringValue(row.created_at).slice(0, 10), "submissions", 1));
  const batchById = new Map(batches.map((batch) => [stringValue(batch.id), batch]));
  metrics.forEach((row) => {
    const batch = batchById.get(stringValue(row.batch_id));
    if (!batch) return;
    const date = stringValue(batch.activity_date).slice(0, 10);
    increment(byDate, date, "outreach", outreachTouchCount(row));
    increment(byDate, date, "replies", numberValue(row.replies));
  });
  return points;
}

function emptyTrend(): TrendPoint[] {
  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(Date.now() - (89 - index) * DAY_MS).toISOString().slice(0, 10);
    return { date, drafts: 0, submissions: 0, outreach: 0, replies: 0 };
  });
}

function increment(map: Map<string, TrendPoint>, date: string, key: keyof Omit<TrendPoint, "date">, amount: number) {
  const point = map.get(date);
  if (point) point[key] += amount;
}

function shapeExperiments(experiments: Row[], variants: Row[]): OutreachExperiment[] {
  return [...experiments].sort((a, b) => stringValue(b.created_at).localeCompare(stringValue(a.created_at))).map((experiment) => ({
    id: stringValue(experiment.id),
    title: stringValue(experiment.title),
    audience: stringValue(experiment.audience),
    campaign: nullableString(experiment.campaign),
    channel: stringValue(experiment.channel),
    method: stringValue(experiment.method),
    messageStep: messageStepValue(experiment.message_step),
    primaryMetric: stringValue(experiment.primary_metric),
    status: stringValue(experiment.status),
    variants: variants
      .filter((variant) => stringValue(variant.experiment_id) === stringValue(experiment.id) && variant.active !== false)
      .sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order))
      .map((variant) => ({ id: stringValue(variant.id), label: stringValue(variant.label), title: stringValue(variant.title) })),
  }));
}

function aggregateOutreach(rows: Row[]): OutreachTotals {
  const totals = rows.reduce<OutreachTotals>((sum, row) => ({
    connectionRequests: sum.connectionRequests + numberValue(row.connection_requests),
    connectionsAccepted: sum.connectionsAccepted + numberValue(row.connections_accepted),
    initialDms: sum.initialDms + numberValue(row.initial_dms),
    f1Sent: sum.f1Sent + numberValue(row.f1_sent),
    f2Sent: sum.f2Sent + numberValue(row.f2_sent),
    customSent: sum.customSent + numberValue(row.custom_sent),
    replies: sum.replies + numberValue(row.replies),
    positiveReplies: sum.positiveReplies + numberValue(row.positive_replies),
    callsBooked: sum.callsBooked + numberValue(row.calls_booked),
    acceptanceRate: null,
    replyRate: null,
  }), emptyOutreach());
  totals.acceptanceRate = percentage(totals.connectionsAccepted, totals.connectionRequests);
  totals.replyRate = percentage(totals.replies, totals.initialDms);
  return totals;
}

function emptyOutreach(): OutreachTotals {
  return { connectionRequests: 0, connectionsAccepted: 0, initialDms: 0, f1Sent: 0, f2Sent: 0, customSent: 0, replies: 0, positiveReplies: 0, callsBooked: 0, acceptanceRate: null, replyRate: null };
}

export function aggregateExperimentPerformance(experiments: OutreachExperiment[], batches: Row[], metrics: Row[]) {
  const batchById = new Map(batches.map((batch) => [stringValue(batch.id), batch]));
  return Object.fromEntries(experiments.map((experiment) => {
    const experimentRows = metrics.filter((row) => {
      const batch = batchById.get(stringValue(row.batch_id));
      return batch && stringValue(batch.experiment_id) === experiment.id;
    });
    const performance: VariantPerformance[] = experiment.variants.map((variant) => {
      const rows = experimentRows.filter((row) => stringValue(row.variant_id) === variant.id || stringValue(row.variant_label) === variant.label);
      const sent = rows.reduce((sum, row) => sum + exposureCount(row, experiment.messageStep), 0);
      const attributedReplies = rows.reduce((sum, row) => sum + numberValue(row.attributed_replies), 0);
      const positiveReplies = rows.reduce((sum, row) => sum + numberValue(row.positive_replies), 0);
      const callsBooked = rows.reduce((sum, row) => sum + numberValue(row.calls_booked), 0);
      const connectionRequests = rows.reduce((sum, row) => sum + numberValue(row.connection_requests), 0);
      const connectionsAccepted = rows.reduce((sum, row) => sum + numberValue(row.connections_accepted), 0);
      const primary = primaryOutcome(experiment.primaryMetric, {
        sent,
        replies: attributedReplies,
        positiveReplies,
        callsBooked,
        connectionRequests,
        connectionsAccepted,
      });
      return {
        ...variant,
        sent,
        replies: attributedReplies,
        positiveReplies,
        callsBooked,
        connectionRequests,
        connectionsAccepted,
        acceptanceRate: percentage(connectionsAccepted, connectionRequests),
        replyRate: percentage(attributedReplies, sent),
        positiveRate: percentage(positiveReplies, sent),
        bookingRate: percentage(callsBooked, sent),
        primaryRate: percentage(primary.numerator, primary.denominator),
        primaryNumerator: primary.numerator,
        primaryDenominator: primary.denominator,
        primaryMetricLabel: primary.label,
        relativeLift: null,
        status: primary.denominator < 50 ? "not enough data" : "early signal",
      };
    });
    const baseline = performance[0]?.primaryRate ?? null;
    performance.forEach((variant) => {
      variant.relativeLift = variant.primaryRate !== null && baseline !== null && baseline > 0 ? ((variant.primaryRate - baseline) / baseline) * 100 : null;
    });
    const ranked = performance.filter((item) => item.primaryRate !== null).sort((a, b) => (b.primaryRate ?? 0) - (a.primaryRate ?? 0));
    const leader = ranked[0];
    const runnerUp = ranked[1];
    if (leader && runnerUp
      && hasAdequateProportionSample(leader.primaryNumerator, leader.primaryDenominator)
      && hasAdequateProportionSample(runnerUp.primaryNumerator, runnerUp.primaryDenominator)) {
      const zScore = twoProportionZScore(
        leader.primaryNumerator,
        leader.primaryDenominator,
        runnerUp.primaryNumerator,
        runnerUp.primaryDenominator,
      );
      const criticalZ = multipleComparisonCriticalZ(performance.length);
      if (zScore !== null && Math.abs(zScore) >= criticalZ) leader.status = "leading";
    }
    return [experiment.id, performance];
  }));
}

function primaryOutcome(metricName: string, totals: {
  sent: number;
  replies: number;
  positiveReplies: number;
  callsBooked: number;
  connectionRequests: number;
  connectionsAccepted: number;
}) {
  if (metricName === "acceptance_rate") return { numerator: totals.connectionsAccepted, denominator: totals.connectionRequests, label: "acceptance rate" };
  if (metricName === "positive_reply_rate") return { numerator: totals.positiveReplies, denominator: totals.sent, label: "positive reply rate" };
  if (metricName === "booking_rate") return { numerator: totals.callsBooked, denominator: totals.sent, label: "booking rate" };
  return { numerator: totals.replies, denominator: totals.sent, label: "reply rate" };
}

function exposureCount(row: Row, messageStep: OutreachMessageStep) {
  if (messageStep === "connection_request") return numberValue(row.connection_requests);
  if (messageStep === "follow_up_1") return numberValue(row.f1_sent);
  if (messageStep === "follow_up_2") return numberValue(row.f2_sent);
  if (messageStep === "custom") return numberValue(row.custom_sent);
  return numberValue(row.initial_dms);
}

function messageStepValue(value: unknown): OutreachMessageStep {
  const step = stringValue(value);
  return ["connection_request", "initial_dm", "follow_up_1", "follow_up_2", "custom"].includes(step)
    ? step as OutreachMessageStep
    : "initial_dm";
}

function buildOperations(systems: Row[], aiRuns: Row[], transcriptionJobs: Row[], notificationJobs: Row[]): OperationsStatus[] {
  const statuses: OperationsStatus[] = [];
  statuses.push({
    label: "Live systems",
    healthy: systems.filter((row) => stringValue(row.health) === "healthy").length,
    attention: systems.filter((row) => ["warning", "error", "paused"].includes(stringValue(row.health))).length,
    detail: systems.length ? `${systems.length} provisioned automation${systems.length === 1 ? "" : "s"}` : "No live systems provisioned yet",
  });
  statuses.push(jobStatus("AI workflow", aiRuns));
  statuses.push(jobStatus("Transcription", transcriptionJobs));
  statuses.push(jobStatus("Internal notification", notificationJobs));
  return statuses;
}

function jobStatus(label: string, rows: Row[]): OperationsStatus {
  const healthy = rows.filter((row) => ["succeeded", "sent"].includes(stringValue(row.status))).length;
  const attention = rows.filter((row) => ["retryable_failed", "terminal_failed", "failed"].includes(stringValue(row.status))).length;
  return { label, healthy, attention, detail: rows.length ? `${rows.length} recorded job${rows.length === 1 ? "" : "s"}` : "No jobs recorded in this period" };
}

function buildRecentBatches(batches: Row[], metrics: Row[]): RecentBatch[] {
  return [...batches]
    .sort((a, b) => stringValue(b.activity_date).localeCompare(stringValue(a.activity_date)))
    .slice(0, 8)
    .map((batch) => {
      const rows = metrics.filter((row) => stringValue(row.batch_id) === stringValue(batch.id));
      return {
        id: stringValue(batch.id),
        date: stringValue(batch.activity_date),
        teamMember: stringValue(batch.team_member),
        context: [titleCase(stringValue(batch.channel)), titleCase(stringValue(batch.method)), stringValue(batch.audience)].filter(Boolean).join(" / "),
        sent: rows.reduce((sum, row) => sum + outreachTouchCount(row), 0),
        replies: rows.reduce((sum, row) => sum + numberValue(row.replies), 0),
        calls: rows.reduce((sum, row) => sum + numberValue(row.calls_booked), 0),
      };
    });
}

export function buildContentDemand(aiStates: Row[]) {
  const counts = new Map<string, number>();
  aiStates.forEach((row) => {
    const extraction = objectValue(row.latest_extraction);
    const demand = objectValue(extraction.demand);
    if (demand.method !== "ai") return;
    const confidence = numberOrNull(demand.confidence);
    if (confidence !== null && confidence < 0.5) return;
    const category = typeof demand.demandCategory === "string" ? demand.demandCategory.trim() : "";
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
}

function hasAiDemandExtraction(extraction: Row) {
  return objectValue(extraction.demand).method === "ai";
}

function initialDmsForIds(rows: Row[], ids: Set<string>) {
  return rows.reduce((sum, row) => ids.has(stringValue(row.batch_id)) ? sum + numberValue(row.initial_dms) : sum, 0);
}

export function outreachTouchCount(row: Row) {
  return numberValue(row.connection_requests) + numberValue(row.initial_dms) + numberValue(row.f1_sent) + numberValue(row.f2_sent) + numberValue(row.custom_sent);
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function rateLabel(numerator: number, denominator: number, label: string) {
  const value = percentage(numerator, denominator);
  return value === null ? `No ${label} denominator yet` : `${value.toFixed(1)}% ${label}`;
}

function growth(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function metric(label: string, value: string, detail: string, delta: number | null, tone: AdminMetric["tone"]): AdminMetric {
  return { label, value, detail, delta, tone };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
