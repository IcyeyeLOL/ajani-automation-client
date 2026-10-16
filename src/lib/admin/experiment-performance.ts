import { hasAdequateProportionSample, multipleComparisonCriticalZ, twoProportionZScore } from "@/lib/admin/statistics";
import type { OutreachExperiment, OutreachMessageStep, VariantPerformance } from "@/lib/admin/types";

// Isomorphic (no server-only): the dashboard read model and the sample-data
// generator share this math, so sample comparisons behave like real ones.
type Row = Record<string, unknown>;

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

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
