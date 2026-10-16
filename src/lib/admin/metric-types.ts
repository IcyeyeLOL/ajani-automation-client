export type MetricGrain = "day" | "week" | "month" | "quarter" | "year";
export type MetricUnit = "count" | "currency_cents" | "hours" | "ratio";
export type MetricAggregation = "sum" | "last" | "ratio";
export type MetricCategory = "business" | "outreach" | "content" | "revenue";
export type MetricEntryMode = "derived" | "manual" | "connector";

export type MetricDefinition = {
  key: string;
  source: string;
  category: MetricCategory;
  label: string;
  description: string;
  unit: MetricUnit;
  aggregation: MetricAggregation;
  numeratorKey: string | null;
  denominatorKey: string | null;
  entryMode: MetricEntryMode;
  higherIsBetter: boolean;
  chartable: boolean;
  /** First and last recorded day for manual/connector data; null for live-derived metrics. */
  firstDate: string | null;
  lastDate: string | null;
  /** Accounts, campaigns or channel/method breakdowns available for filtering. */
  dimensions: string[];
};

export type MetricEntry = {
  metricKey: string;
  date: string;
  dimension: string;
  value: number;
  recordedAt: string;
};

export type MetricCatalog = {
  status: "available" | "unavailable";
  today: string;
  metrics: MetricDefinition[];
  recentEntries: MetricEntry[];
  /** Display names for connector accounts, such as Dripify campaign names, by account key. */
  dimensionLabels: Record<string, string>;
  /** Whether each connector has its credentials configured (never the credentials themselves). */
  connectors: { dripify: boolean };
};

/** total = running sum since the start date; latest = newest value of a stock; weekly = this ISO week's sum. */
export type GoalMeasure = "total" | "latest" | "weekly";

export type Goal = {
  key: string;
  metricKey: string;
  label: string;
  description: string;
  measure: GoalMeasure;
  unit: MetricUnit;
  entryMode: MetricEntryMode;
  target: number;
  startDate: string;
  /** null for weekly goals, which repeat. */
  dueDate: string | null;
  /** null means nothing recorded (unknown), never zero. */
  current: number | null;
  /** Latest-value goals: the value the day before the goal began, when one was recorded. */
  baseline: number | null;
  /** Weekly goals: last week's total. */
  lastWeek: number | null;
  /** Newest day with a recorded value (manual and connector metrics). */
  lastRecorded: string | null;
};

export type GoalBoard = {
  status: "available" | "unavailable";
  today: string;
  weekStart: string;
  goals: Goal[];
};

export type MetricBucket = {
  start: string;
  end: string;
  /** The period is still in progress (or cut by the range end). */
  partial: boolean;
};

export type MetricSeries = {
  metricKey: string;
  /** One value per bucket. null means unknown (nothing recorded), never zero. */
  values: Array<number | null>;
  numerators: Array<number | null> | null;
  denominators: Array<number | null> | null;
  current: number | null;
  previous: number | null;
  currentNumerator: number | null;
  currentDenominator: number | null;
  previousNumerator: number | null;
  previousDenominator: number | null;
  /** Tracking start for metrics with limited history; earlier periods are unknown. */
  coverageFrom: string | null;
};

export type MetricSeriesResult = {
  grain: MetricGrain;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  today: string;
  dimension: string | null;
  buckets: MetricBucket[];
  series: MetricSeries[];
};

export type MetricSeriesQuery = {
  metrics: string[];
  grain: MetricGrain;
  from: string;
  to: string;
  dimension: string | null;
};
