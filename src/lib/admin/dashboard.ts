import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/admin/session";
import { withinDeadline } from "@/lib/operations/deadline";
import { aggregateExperimentPerformance } from "@/lib/admin/experiment-performance";
import type {
  AdminDashboardData, AdminMetric, OutreachExperiment, OutreachMessageStep, OutreachTotals,
} from "@/lib/admin/types";

// Moved to an isomorphic module so the sample-data generator reuses the same math.
export { aggregateExperimentPerformance };

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
      metric("Saved drafts", formatNumber(n("saved_current")), `${n("organizations_current")} new business accounts in the last 30 days, by UTC date`, growth(n("saved_current"), n("saved_previous")), "neutral"),
      metric("Submitted builds", formatNumber(n("builds_current")), n("saved_current") ? `${percentage(n("cohort_submitted_current"), n("saved_current"))?.toFixed(1)}% of drafts saved in the last 30 days became builds` : "No drafts saved in the last 30 days", growth(n("builds_current"), n("builds_previous")), "brand"),
      // Batches logged on the Outreach page only: the nightly Dripify sync feeds Trends, not this card.
      metric("Outreach touches", formatNumber(n("outreach_current")), "From outreach batches you log", growth(n("outreach_current"), n("outreach_previous")), "brand"),
      metric("Replies", formatNumber(n("replies_current")), rateLabel(n("replies_current"), "reply_base_current" in totals ? n("reply_base_current") : n("initial_dms_current"), "reply rate"), growth(n("replies_current"), n("replies_previous")), "success"),
      // Revenue is not shown here: no code writes billing_subscriptions or build_request_quotes, so
      // those cards always read $0. The growth goals above show the revenue numbers the owner logs.
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
    // Replies are measured against the exposure that produced them. Payloads
    // from before the reply_base migration keep the original initial-DM basis.
    replyBase: sum.replyBase + ("reply_base" in row ? numberValue(row.reply_base) : numberValue(row.initial_dms)),
    positiveReplies: sum.positiveReplies + numberValue(row.positive_replies),
    callsBooked: sum.callsBooked + numberValue(row.calls_booked),
    acceptanceRate: null,
    replyRate: null,
  }), emptyOutreach());
  totals.acceptanceRate = percentage(totals.connectionsAccepted, totals.connectionRequests);
  totals.replyRate = percentage(totals.replies, totals.replyBase);
  return totals;
}

function emptyOutreach(): OutreachTotals {
  return { connectionRequests: 0, connectionsAccepted: 0, initialDms: 0, f1Sent: 0, f2Sent: 0, customSent: 0, replies: 0, replyBase: 0, positiveReplies: 0, callsBooked: 0, acceptanceRate: null, replyRate: null };
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
