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

export type OutreachExperiment = {
  id: string;
  title: string;
  audience: string;
  campaign: string | null;
  channel: string;
  method: string;
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
  replies: number;
  positiveReplies: number;
  callsBooked: number;
  acceptanceRate: number | null;
  replyRate: number | null;
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
