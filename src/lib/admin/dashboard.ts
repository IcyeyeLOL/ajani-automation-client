import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/admin/session";
import { withinDeadline } from "@/lib/operations/deadline";
import { hasAdequateProportionSample, multipleComparisonCriticalZ, twoProportionZScore } from "@/lib/admin/statistics";
import type {
  AdminDashboardData, AdminMetric, OutreachExperiment, OutreachMessageStep,
  OutreachTotals, VariantPerformance,
} from "@/lib/admin/types";

type Row = Record<string, unknown>;
export type AdminPages = { experimentPage?: number; batchPage?: number };

export function adminPageNumber(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, 100_000) : 0;
}

export async function loadAdminDashboardData(pages: AdminPages = {}): Promise<AdminDashboardData> {
  // The DAL authorizes independently of the layout, which can render in parallel.
  await requireAdminSession();
  const generatedAt = new Date().toISOString();
  const experimentPage = adminPageNumber(pages.experimentPage);
  const batchPage = adminPageNumber(pages.batchPage);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await withinDeadline(admin.rpc("load_admin_analytics", {
      p_experiment_page: experimentPage,
      p_batch_page: batchPage,
    }), Date.now() + 12_000);
    if (error) throw error;
    return shapeAdminAnalytics(data, generatedAt, { experimentPage, batchPage });
  } catch (error) {
    console.error("Admin analytics unavailable", {
      code: error && typeof error === "object" && "code" in error ? error.code : "analytics_unavailable",
    });
    return {
      generatedAt, dataConnected: false, outreachSchemaReady: false, dataStatus: "unavailable",
      dataNotice: "Analytics are unavailable. Check the analytics migration and database connection; missing values are not zero activity.",
      coverageStartedAt: null,
      pagination: { experimentPage, batchPage, experimentCount: 0, batchCount: 0 },
      metrics: [], trend: [], funnel: [], outreach: emptyOutreach(), experiments: [],
      experimentPerformance: {}, operations: [], recentBatches: [], contentDemand: [],
    };
  }
}

/** SQL aggregates include every matching row; only detail lists are paginated. */
export function shapeAdminAnalytics(raw: unknown, generatedAt: string, pages: Required<AdminPages>): AdminDashboardData {
  const payload = objectValue(raw);
  if (!payload.metrics || !payload.funnel || !Array.isArray(payload.trend)
    || !Array.isArray(payload.experiments) || !Array.isArray(payload.recent_batches)) {
    throw new Error("analytics_payload_incomplete");
  }
  const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(objectValue) : [];
  const totals = objectValue(payload.metrics);
  const n = (key: string) => numberValue(totals[key]);
  const funnel = objectValue(payload.funnel);
  const saved = numberValue(funnel.saved);
  const experiments = shapeExperiments(rows(payload.experiments), rows(payload.variants));
  const coverageStartedAt = nullableString(payload.coverage_started_at);
  const coverageDate = coverageStartedAt?.slice(0, 10);
  const completeCohortWindow = coverageStartedAt !== null
    && Date.parse(coverageStartedAt) <= Date.parse(generatedAt) - 180 * 86_400_000;
  return {
    generatedAt, dataConnected: true, outreachSchemaReady: true, dataStatus: completeCohortWindow ? "available" : "partial",
    coverageStartedAt,
    dataNotice: completeCohortWindow ? null : coverageDate
      ? `Cohort tracking began ${coverageDate} UTC. Earlier cohorts include only drafts retained at backfill; already-deleted history cannot be reconstructed. New cohorts remain stable after retention.`
      : "Historical cohort coverage has not been established.",
    pagination: { ...pages, experimentCount: numberValue(payload.experiment_count), batchCount: numberValue(payload.batch_count) },
    metrics: [
      metric("Saved drafts", formatNumber(n("saved_current")), `${n("organizations_current")} new business workspaces; UTC calendar days`, growth(n("saved_current"), n("saved_previous")), "neutral"),
      metric("Submitted builds", formatNumber(n("builds_current")), n("saved_current") ? `${percentage(n("cohort_submitted_current"), n("saved_current"))?.toFixed(1)}% of 30-day draft cohorts converted` : "No drafts in this 30-day cohort", growth(n("builds_current"), n("builds_previous")), "brand"),
      metric("Outreach touches", formatNumber(n("outreach_current")), "Manual and Dripify activity", growth(n("outreach_current"), n("outreach_previous")), "brand"),
      metric("Replies", formatNumber(n("replies_current")), rateLabel(n("replies_current"), n("initial_dms_current"), "reply rate"), growth(n("replies_current"), n("replies_previous")), "success"),
      metric("Quoted pipeline", formatMoney(n("quoted_pipeline")), "Pending and approved quotes", null, "neutral"),
      metric("Monthly retainers", formatMoney(n("mrr")), "Active monthly subscriptions", null, "success"),
    ],
    trend: rows(payload.trend).map((row) => ({
      date: stringValue(row.date), drafts: numberValue(row.drafts), submissions: numberValue(row.submissions),
      outreach: numberValue(row.outreach), replies: numberValue(row.replies),
    })),
    funnel: [["saved", "Brief saved"], ["processed", "AI processed"], ["approved", "Scope approved"], ["claimed", "Account claimed"], ["submitted", "Build submitted"]].map(([key, label]) => ({
      label, value: numberValue(funnel[key]), rate: percentage(numberValue(funnel[key]), saved),
    })),
    outreach: aggregateOutreach([objectValue(payload.outreach)]),
    experiments,
    experimentPerformance: aggregateExperimentPerformance(experiments, experiments.map((item) => ({ id: item.id, experiment_id: item.id })), rows(payload.experiment_metrics)),
    operations: rows(payload.operations).map((row) => ({
      label: stringValue(row.label), healthy: numberValue(row.healthy), attention: numberValue(row.attention), detail: stringValue(row.detail),
    })),
    recentBatches: rows(payload.recent_batches).map((row) => ({
      id: stringValue(row.id), date: stringValue(row.activity_date), teamMember: stringValue(row.team_member),
      context: [titleCase(stringValue(row.channel)), titleCase(stringValue(row.method)), stringValue(row.audience)].filter(Boolean).join(" / "),
      sent: numberValue(row.sent), replies: numberValue(row.replies), calls: numberValue(row.calls),
    })),
    contentDemand: rows(payload.content_demand).map((row) => ({ label: stringValue(row.label), value: numberValue(row.value) })),
  };
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
