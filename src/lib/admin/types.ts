export type AdminRange = "7d" | "30d" | "90d";

export type TrendPoint = {
  date: string;
  drafts: number;
  submissions: number;
  outreach: number;
  replies: number;
};

export type AdminMetric = {
  label: string;
  value: string;
  detail: string;
  delta: number | null;
  tone: "brand" | "neutral" | "success" | "warning";
};

export type FunnelStage = {
  label: string;
  value: number;
  rate: number | null;
};

export type OutreachVariant = {
  id: string;
  label: string;
  title: string;
};

export type OutreachMessageStep = "connection_request" | "initial_dm" | "follow_up_1" | "follow_up_2" | "custom";

export type OutreachExperiment = {
  id: string;
  title: string;
  audience: string;
  campaign: string | null;
  channel: string;
  method: string;
  messageStep: OutreachMessageStep;
  primaryMetric: string;
  status: string;
  variants: OutreachVariant[];
};

export type VariantPerformance = {
  id: string;
  label: string;
  title: string;
  sent: number;
  replies: number;
  positiveReplies: number;
  callsBooked: number;
  connectionRequests: number;
  connectionsAccepted: number;
  acceptanceRate: number | null;
  replyRate: number | null;
  positiveRate: number | null;
  bookingRate: number | null;
  primaryRate: number | null;
  primaryNumerator: number;
  primaryDenominator: number;
  primaryMetricLabel: string;
  relativeLift: number | null;
  status: "early signal" | "leading" | "not enough data";
};

export type OutreachTotals = {
  connectionRequests: number;
  connectionsAccepted: number;
  initialDms: number;
  f1Sent: number;
  f2Sent: number;
  customSent: number;
  replies: number;
  /** Exposure replies are measured against: initial DMs, or sends at a tested step. */
  replyBase: number;
  positiveReplies: number;
  callsBooked: number;
  acceptanceRate: number | null;
  replyRate: number | null;
};

/** The three ways the owner reaches people; each id is also its Log numbers source. */
export type OutreachChannelId = "dripify" | "reddit" | "cold_calls";

/** Last-30-day outreach for one channel. null means not logged (or not synced) in the window, never zero. */
export type OutreachChannelSummary = {
  id: OutreachChannelId;
  label: string;
  /** Outreach's Channel-filter key, e.g. "linkedin/dripify". */
  dimension: string;
  /** Its sends and replies come from a nightly sync (Dripify), not from Log numbers. */
  synced: boolean;
  touches: number | null;
  replies: number | null;
  /** People reached: what the reply rate is measured against. */
  reached: number | null;
  /** Replies ÷ people reached, 0–1. */
  replyRate: number | null;
  callsBooked: number | null;
  /** The last sync for a synced channel; otherwise the newest day anything was logged. */
  lastDate: string | null;
  /** Whether Log numbers has a tab for this channel yet. */
  loggable: boolean;
};

export type OutreachChannelBoard = {
  status: "available" | "unavailable";
  from: string;
  to: string;
  channels: OutreachChannelSummary[];
  /** The three channels added up: what Outreach totals show. */
  total: Pick<OutreachChannelSummary, "touches" | "replies" | "reached" | "replyRate" | "callsBooked">;
  /** Dripify's key is set, so its numbers sync every night. */
  dripifyConnected: boolean;
};

export type OperationsStatus = {
  label: string;
  healthy: number;
  attention: number;
  detail: string;
};

export type RecentBatch = {
  id: string;
  date: string;
  teamMember: string;
  context: string;
  sent: number;
  replies: number;
  calls: number;
};

export type AdminDashboardData = {
  generatedAt: string;
  dataConnected: boolean;
  dataStatus: "available" | "partial" | "unavailable";
  dataNotice: string | null;
  coverageStartedAt: string | null;
  pagination: { experimentPage: number; batchPage: number; experimentCount: number; batchCount: number };
  outreachSchemaReady: boolean;
  metrics: AdminMetric[];
  trend: TrendPoint[];
  funnel: FunnelStage[];
  outreach: OutreachTotals;
  experiments: OutreachExperiment[];
  experimentPerformance: Record<string, VariantPerformance[]>;
  operations: OperationsStatus[];
  recentBatches: RecentBatch[];
  contentDemand: Array<{ label: string; value: number }>;
};
