/**
 * Sample data for the control desk's "Sample data" mode: realistic, made-up
 * numbers so every chart and section can be seen filled in. It only changes
 * what is rendered; nothing here is ever written to the database.
 *
 * Isomorphic on purpose (no server-only, no Node APIs): the Trends section
 * builds its sample series in the browser. Deterministic: every number comes
 * from a hash of the metric, account and date (anchored to `today`), so the
 * same inputs always give the same numbers on the server and in the browser.
 * Only IEEE-exact arithmetic is used (no Math.exp/pow/log) for that reason.
 *
 * The series follow load_analytics_series (20261016010000_analytics_metric_store.sql):
 * grain-truncated ranges, ISO (Monday) weeks, partial buckets, sums for flows,
 * carried-forward latest values per account for stocks, ratios recomputed from
 * their components, an equal-length previous window, and null (unknown) wherever
 * the database would return null.
 */
import { aggregateExperimentPerformance } from "@/lib/admin/experiment-performance";
import { dayCount, formatDay, parseDay, periodStart } from "@/lib/admin/metric-query";
import type {
  Goal, GoalBoard, GoalMeasure, MetricAggregation, MetricBucket, MetricCatalog, MetricCategory, MetricDefinition, MetricEntry,
  MetricEntryMode, MetricGrain, MetricSeries, MetricSeriesQuery, MetricSeriesResult, MetricUnit,
} from "@/lib/admin/metric-types";
import type { AdminDashboardData, AdminMetric, OutreachExperiment, OutreachTotals, RecentBatch } from "@/lib/admin/types";

/** Days of made-up history before today. Manual and connector metrics start here. */
export const SAMPLE_HISTORY_DAYS = 180;
const TODAY_INDEX = SAMPLE_HISTORY_DAYS;
const YESTERDAY_INDEX = SAMPLE_HISTORY_DAYS - 1;
/** Same cap as the RPC. */
const MAX_BUCKETS = 732;

/** One stored (or derived) daily value, like a row of analytics_daily_values. */
export type SampleRow = { date: string; dimension: string; value: number };
type RowMap = Map<string, SampleRow[]>;

// ---------------------------------------------------------------------------
// Built-in definitions: the active rows of analytics_metric_definitions after
// every 20261016 migration (X is retired), in catalog order.
// ---------------------------------------------------------------------------

type DefinitionOptions = Partial<Pick<MetricDefinition, "numeratorKey" | "denominatorKey" | "higherIsBetter" | "chartable">>;

function definition(
  key: string, category: MetricCategory, label: string, description: string,
  unit: MetricUnit, aggregation: MetricAggregation, entryMode: MetricEntryMode, options: DefinitionOptions = {},
): MetricDefinition {
  return {
    key, source: key.slice(0, key.indexOf(".")), category, label, description, unit, aggregation,
    numeratorKey: null, denominatorKey: null, entryMode, higherIsBetter: true, chartable: true,
    firstDate: null, lastDate: null, dimensions: [], ...options,
  };
}

export const SAMPLE_DEFINITIONS: MetricDefinition[] = [
  definition("ajani.drafts_saved", "business", "Briefs saved", "Website requests saved, by UTC day saved. Survives draft retention.", "count", "sum", "derived"),
  definition("ajani.cohort_submitted", "business", "Saved briefs later submitted", "Briefs saved in the period that have since been submitted as builds.", "count", "sum", "derived", { chartable: false }),
  definition("ajani.builds_submitted", "business", "Builds submitted", "Approved build requests entering the delivery pipeline, by UTC day submitted.", "count", "sum", "derived"),
  definition("ajani.new_workspaces", "business", "New client workspaces", "Business workspaces created when a client signs in to submit.", "count", "sum", "derived"),
  definition("ajani.brief_to_build_rate", "business", "Brief → build conversion", "Share of briefs saved in the period that became submitted builds (cohort).", "ratio", "ratio", "derived", { numeratorKey: "ajani.cohort_submitted", denominatorKey: "ajani.drafts_saved" }),
  definition("outreach.touches", "outreach", "Outreach touches", "Connection requests, first messages and follow-ups sent. Voided entries excluded.", "count", "sum", "derived"),
  definition("outreach.connection_requests", "outreach", "Connection requests", "Connection requests sent.", "count", "sum", "derived"),
  definition("outreach.connections_accepted", "outreach", "Connections accepted", "Connection requests accepted.", "count", "sum", "derived"),
  definition("outreach.initial_dms", "outreach", "First messages", "Unique first messages sent.", "count", "sum", "derived"),
  definition("outreach.follow_ups", "outreach", "Follow-ups", "First, second and custom follow-ups sent.", "count", "sum", "derived"),
  definition("outreach.replies", "outreach", "Replies", "Unique replies received.", "count", "sum", "derived"),
  definition("outreach.reply_base", "outreach", "Reply base", "What replies are measured against: first messages sent, or for an A/B test the sends at the tested step.", "count", "sum", "derived", { chartable: false }),
  definition("outreach.positive_replies", "outreach", "Positive replies", "Replies showing interest.", "count", "sum", "derived"),
  definition("outreach.calls_booked", "outreach", "Calls booked", "Sales calls booked from logged outreach. Count a call only once Calendly confirms the booking.", "count", "sum", "derived"),
  definition("outreach.acceptance_rate", "outreach", "Connection acceptance", "Connections accepted ÷ connection requests.", "ratio", "ratio", "derived", { numeratorKey: "outreach.connections_accepted", denominatorKey: "outreach.connection_requests" }),
  definition("outreach.reply_rate", "outreach", "Reply rate", "Replies ÷ people messaged at the measured step.", "ratio", "ratio", "derived", { numeratorKey: "outreach.replies", denominatorKey: "outreach.reply_base" }),
  definition("outreach.positive_reply_rate", "outreach", "Positive reply rate", "Positive replies ÷ people messaged at the measured step.", "ratio", "ratio", "derived", { numeratorKey: "outreach.positive_replies", denominatorKey: "outreach.reply_base" }),
  definition("outreach.reply_to_call_rate", "outreach", "Replies → calls", "Calls booked ÷ replies.", "ratio", "ratio", "derived", { numeratorKey: "outreach.calls_booked", denominatorKey: "outreach.replies" }),
  definition("dripify.leads_total", "outreach", "Dripify leads loaded", "Leads loaded into launched Dripify campaigns, from the latest daily sync of each campaign.", "count", "last", "connector"),
  definition("dripify.leads_contacted", "outreach", "Dripify leads contacted", "Leads that received at least one Dripify step, added up across campaigns (a lead in two campaigns counts twice).", "count", "last", "connector"),
  definition("dripify.leads_accepted", "outreach", "Dripify connections accepted", "Leads who accepted a Dripify connection request.", "count", "last", "connector"),
  definition("dripify.leads_replied", "outreach", "Dripify leads replied", "Leads who replied to a Dripify campaign.", "count", "last", "connector"),
  definition("dripify.acceptance_rate", "outreach", "Dripify acceptance rate (lifetime)", "Leads who accepted ÷ leads contacted, over each campaign's whole life so far, so it moves slowly. Matches Dripify's own acceptance rate.", "ratio", "ratio", "derived", { numeratorKey: "dripify.leads_accepted", denominatorKey: "dripify.leads_contacted" }),
  definition("dripify.reply_rate", "outreach", "Dripify reply rate (lifetime)", "Leads who replied ÷ leads contacted (replies per 100 people reached), over each campaign's whole life so far. Matches Dripify's own reply rate.", "ratio", "ratio", "derived", { numeratorKey: "dripify.leads_replied", denominatorKey: "dripify.leads_contacted" }),
  definition("reddit.dm_calls_booked", "outreach", "Calls booked from Reddit DMs", "Calls set up from Reddit conversations. Count a call only once Calendly confirms the booking.", "count", "sum", "manual"),
  definition("reddit.dm_replies", "outreach", "Reddit DM replies", "People who replied to a Reddit outreach message, on the day they replied.", "count", "sum", "manual"),
  definition("reddit.dm_reply_rate", "outreach", "Reddit DM reply rate", "Replies ÷ DMs sent. Replies come in after the DM, so a short range can read high or low.", "ratio", "ratio", "derived", { numeratorKey: "reddit.dm_replies", denominatorKey: "reddit.dms_sent" }),
  definition("reddit.dms_sent", "outreach", "Reddit DMs sent", "People messaged on Reddit for outreach. Count each person once, on the day of the first message.", "count", "sum", "manual"),
  definition("dripify.new_accepted", "outreach", "Dripify connections accepted (new)", "Leads who accepted a Dripify connection request since the previous sync, recorded on the sync day.", "count", "sum", "connector"),
  definition("dripify.new_contacted", "outreach", "Dripify leads contacted (new)", "Leads Dripify contacted for the first time since the previous sync, recorded on the sync day.", "count", "sum", "connector"),
  definition("dripify.new_replies", "outreach", "Dripify replies (new)", "Leads who replied to a Dripify campaign for the first time since the previous sync, recorded on the sync day.", "count", "sum", "connector"),
  definition("dripify.period_acceptance_rate", "outreach", "Dripify acceptance (this period)", "New connections accepted ÷ new leads contacted in the chosen range. Acceptances arrive days after invites, so a short range can read high or low; compare with the lifetime rate.", "ratio", "ratio", "derived", { numeratorKey: "dripify.new_accepted", denominatorKey: "dripify.new_contacted" }),
  definition("dripify.period_reply_rate", "outreach", "Dripify reply rate (this period)", "New replies ÷ new leads contacted in the chosen range. Replies arrive after the outreach, so a short range can read high or low; compare with the lifetime rate.", "ratio", "ratio", "derived", { numeratorKey: "dripify.new_replies", denominatorKey: "dripify.new_contacted" }),
  definition("youtube.subscribers", "content", "YouTube subscribers", "Channel subscribers on the recorded day. When synced, YouTube rounds this to three significant figures.", "count", "last", "manual"),
  definition("youtube.total_views", "content", "YouTube views, all time", "Channel views since it was created, on the recorded day (synced from YouTube).", "count", "last", "connector"),
  definition("dripify.leads_failed", "outreach", "Dripify leads failed", "Leads Dripify could not process, for example when LinkedIn refused an action (Dripify's \"Failed\").", "count", "last", "connector", { higherIsBetter: false }),
  definition("dripify.leads_finished", "outreach", "Dripify leads finished", "Leads that went through every step of a campaign (Dripify's \"Finished\").", "count", "last", "connector"),
  definition("dripify.leads_in_progress", "outreach", "Dripify leads in a sequence", "Leads moving through a campaign's steps right now (Dripify's \"In progress\").", "count", "last", "connector"),
  definition("dripify.leads_remaining", "outreach", "Dripify leads not yet contacted", "Leads loaded into a campaign that Dripify has not contacted yet. When this runs low, add leads or the campaign stops sending.", "count", "last", "connector"),
  definition("youtube.views", "content", "YouTube views", "Video views during the recorded day or period.", "count", "sum", "manual"),
  definition("dripify.active_campaigns", "outreach", "Active Dripify campaigns", "Campaigns sending right now, on the recorded day.", "count", "last", "connector"),
  definition("dripify.unread_messages", "outreach", "Unread Dripify messages", "Conversations in the Dripify inbox with replies nobody has read yet, on the recorded day.", "count", "last", "connector", { higherIsBetter: false }),
  definition("youtube.watch_hours", "content", "YouTube watch hours", "Hours watched during the recorded day or period.", "hours", "sum", "manual"),
  definition("youtube.likes", "content", "YouTube likes", "Likes received during the recorded day or period.", "count", "sum", "manual"),
  definition("youtube.comments", "content", "YouTube comments", "Comments received during the recorded day or period.", "count", "sum", "manual"),
  definition("youtube.videos_published", "content", "YouTube videos published", "Videos and Shorts published.", "count", "sum", "manual"),
  definition("youtube.shorts_views", "content", "YouTube Shorts views", "Views of Shorts during the recorded day or period. Included in YouTube views.", "count", "sum", "manual"),
  definition("youtube.shares", "content", "YouTube shares", "Shares during the recorded day or period.", "count", "sum", "manual"),
  definition("youtube.subscribers_gained", "content", "YouTube subscribers gained", "New subscribers during the recorded day (synced from YouTube Analytics).", "count", "sum", "connector"),
  definition("youtube.subscribers_lost", "content", "YouTube subscribers lost", "Unsubscribes during the recorded day (synced from YouTube Analytics).", "count", "sum", "connector", { higherIsBetter: false }),
  definition("tiktok.followers", "content", "TikTok followers", "Account followers on the recorded day.", "count", "last", "manual"),
  definition("tiktok.views", "content", "TikTok views", "Video views during the recorded day or period.", "count", "sum", "manual"),
  definition("tiktok.likes", "content", "TikTok likes", "Likes received during the recorded day or period.", "count", "sum", "manual"),
  definition("tiktok.comments", "content", "TikTok comments", "Comments received during the recorded day or period.", "count", "sum", "manual"),
  definition("tiktok.shares", "content", "TikTok shares", "Shares during the recorded day or period.", "count", "sum", "manual"),
  definition("tiktok.profile_views", "content", "TikTok profile views", "Profile views during the recorded day or period.", "count", "sum", "manual"),
  definition("tiktok.videos_published", "content", "TikTok videos published", "Videos published.", "count", "sum", "manual"),
  definition("instagram.followers", "content", "Instagram followers", "Account followers on the recorded day.", "count", "last", "manual"),
  definition("instagram.reach", "content", "Instagram reach", "Accounts reached during the recorded day or period. Added up across days, so an account reached on two days counts twice.", "count", "sum", "manual"),
  definition("instagram.views", "content", "Instagram views", "Views during the recorded day or period.", "count", "sum", "manual"),
  definition("instagram.interactions", "content", "Instagram interactions", "Likes, comments, shares, saves and replies during the recorded day or period.", "count", "sum", "manual"),
  definition("instagram.comments", "content", "Instagram comments", "Comments during the recorded day or period.", "count", "sum", "manual"),
  definition("instagram.likes", "content", "Instagram likes", "Likes during the recorded day or period.", "count", "sum", "manual"),
  definition("instagram.profile_visits", "content", "Instagram profile visits", "Profile visits during the recorded day or period. Instagram's API stopped reporting this in 2025, so log it from the app.", "count", "sum", "manual"),
  definition("instagram.posts_published", "content", "Instagram posts published", "Posts and Reels published.", "count", "sum", "manual"),
  definition("instagram.saves", "content", "Instagram saves", "Saves during the recorded day or period.", "count", "sum", "manual"),
  definition("instagram.shares", "content", "Instagram shares", "Shares during the recorded day or period.", "count", "sum", "manual"),
  definition("instagram.profile_link_taps", "content", "Instagram link taps", "Taps on the links and contact buttons on your profile during the recorded day or period.", "count", "sum", "manual"),
  definition("linkedin.followers", "content", "LinkedIn followers", "Profile or page followers on the recorded day.", "count", "last", "manual"),
  definition("linkedin.impressions", "content", "LinkedIn impressions", "Post impressions during the recorded day or period.", "count", "sum", "manual"),
  definition("linkedin.engagements", "content", "LinkedIn engagements", "LinkedIn's social engagements during the recorded day or period: reactions, comments, reposts, sends and saves.", "count", "sum", "manual"),
  definition("linkedin.profile_views", "content", "LinkedIn profile views", "Profile views during the recorded day or period.", "count", "sum", "manual"),
  definition("linkedin.posts_published", "content", "LinkedIn posts published", "Posts published.", "count", "sum", "manual"),
  definition("linkedin.reactions", "content", "LinkedIn reactions", "Reactions on your posts during the recorded day or period.", "count", "sum", "manual"),
  definition("linkedin.comments", "content", "LinkedIn comments", "Comments on your posts during the recorded day or period.", "count", "sum", "manual"),
  definition("reddit.karma", "content", "Reddit karma", "Post and comment karma together, on the recorded day.", "count", "last", "manual"),
  definition("reddit.views", "content", "Reddit views", "Views on your Reddit posts during the recorded day or period.", "count", "sum", "manual"),
  definition("reddit.posts_published", "content", "Reddit posts published", "Posts published.", "count", "sum", "manual"),
  definition("reddit.comments", "content", "Reddit comments", "Comments on your posts during the recorded day or period.", "count", "sum", "manual"),
  definition("reddit.upvotes", "content", "Reddit upvotes", "Upvotes on your posts during the recorded day or period.", "count", "sum", "manual"),
  definition("sales.content_leads", "revenue", "Leads from content", "Qualified DMs or conversations that started from your posts or videos, on any platform. Count each person once, on the day they reached out.", "count", "sum", "manual"),
  definition("sales.calls_held", "revenue", "Sales calls held", "Booked calls the prospect showed up to.", "count", "sum", "manual"),
  definition("sales.proposals_sent", "revenue", "Proposals sent", "Quotes or proposals sent to prospects.", "count", "sum", "manual"),
  definition("sales.deals_won", "revenue", "Clients signed", "Clients who signed and paid their first invoice (the setup fee), on the day they paid.", "count", "sum", "manual"),
  definition("sales.close_rate", "revenue", "Close rate", "Clients signed ÷ sales calls held.", "ratio", "ratio", "derived", { numeratorKey: "sales.deals_won", denominatorKey: "sales.calls_held" }),
  definition("revenue.cash_collected", "revenue", "Cash collected", "Money received during the recorded day or period, setup fees and retainers together.", "currency_cents", "sum", "manual"),
  definition("revenue.mrr", "revenue", "Monthly recurring revenue", "Monthly retainer fees from clients paying right now. Setup fees and pilots without a retainer do not count.", "currency_cents", "last", "manual"),
  definition("revenue.active_clients", "revenue", "Active clients", "Clients paying you right now. Not the same as total clients signed, which the growth goal counts.", "count", "last", "manual"),
];

const SAMPLE_DEFINITION_BY_KEY = new Map(SAMPLE_DEFINITIONS.map((item) => [item.key, item]));

/** Display names for connector accounts, like analytics_dimension_labels. */
export const SAMPLE_DIMENSION_LABELS: Record<string, string> = {
  "dripify:101": "Insurance owners TX",
  "dripify:202": "Med spa founders FL",
  "dripify:303": "HVAC owners Midwest",
  "dripify-team:7": "Ajani team",
};

/** Cohort metrics are unknown before tracking began (admin_analytics_coverage). */
const COHORT_KEYS = new Set(["ajani.drafts_saved", "ajani.cohort_submitted"]);

// ---------------------------------------------------------------------------
// Deterministic randomness.
// ---------------------------------------------------------------------------

function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  // murmur3 finalizer: neighbouring dates must not give neighbouring numbers.
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/** Uniform in [0, 1) from the metric key, account, date and a salt. */
function rand(...parts: Array<string | number>) {
  return hash(parts.join("|")) / 4_294_967_296;
}

function between(min: number, max: number, unit: number) {
  return min + (max - min) * unit;
}

function intBetween(min: number, max: number, unit: number) {
  return Math.min(max, min + Math.floor((max - min + 1) * unit));
}

/** Poisson-like count (a binomial with many trials), using comparisons only. */
function countEvents(mean: number, ...seed: Array<string | number>) {
  if (mean <= 0) return 0;
  const trials = Math.max(12, Math.ceil(mean * 3));
  const chance = mean / trials;
  let count = 0;
  for (let trial = 0; trial < trials; trial += 1) if (rand(...seed, trial) < chance) count += 1;
  return count;
}

function sampleUuid(...parts: Array<string | number>) {
  const hex = [0, 1, 2, 3].map((part) => hash([...parts, part].join("|")).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Timeline: SAMPLE_HISTORY_DAYS days before today, through today.
// ---------------------------------------------------------------------------

type Timeline = { dates: string[]; dow: number[] };

function buildTimeline(today: string): Timeline {
  const cursor = parseDay(today);
  cursor.setUTCDate(cursor.getUTCDate() - SAMPLE_HISTORY_DAYS);
  const dates: string[] = [];
  const dow: number[] = [];
  for (let index = 0; index <= SAMPLE_HISTORY_DAYS; index += 1) {
    dates.push(formatDay(cursor));
    dow.push(cursor.getUTCDay());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { dates, dow };
}

function isWeekday(dow: number) {
  return dow >= 1 && dow <= 5;
}

/** Audiences grow over the sample period: 0.75 at the start, 1.25 today. */
function audience(index: number) {
  return 0.75 + (0.5 * index) / SAMPLE_HISTORY_DAYS;
}

function addDays(day: string, days: number) {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

/** First day of sample history (and of cohort tracking). */
export function sampleHistoryStart(today: string) {
  return addDays(today, -SAMPLE_HISTORY_DAYS);
}

function addRow(rows: RowMap, key: string, date: string, dimension: string, value: number) {
  const list = rows.get(key);
  const row = { date, dimension, value };
  if (list) list.push(row);
  else rows.set(key, [row]);
}

/** Posts or videos per day, from per-weekday odds (index 0 is Sunday). */
function publishing(key: string, account: string, line: Timeline, odds: readonly number[], doubleOdds: number) {
  return line.dates.map((date, index) => rand(key, account, date) < odds[line.dow[index]]
    ? rand(key, account, date, "double") < doubleOdds ? 2 : 1
    : 0);
}

/** Reach from today's and recent posts: a post keeps being seen for a few days. */
function postReach(posts: number[], index: number, decay: readonly number[], reach: (day: number) => number) {
  let total = 0;
  for (let back = 0; back < decay.length && index - back >= 0; back += 1) {
    if (posts[index - back]) total += posts[index - back] * reach(index - back) * decay[back];
  }
  return total;
}

// ---------------------------------------------------------------------------
// Generators, one per group of related metrics so they agree with each other.
// ---------------------------------------------------------------------------

const LINKEDIN_ACCOUNTS = [
  { account: "@ajani", followers: 2_925, odds: [0.08, 0.7, 0.4, 0.65, 0.5, 0.3, 0.04], doubleOdds: 0.1, base: [140, 320], reach: [850, 2_200], views: [12, 34], followDivisor: 520 },
  { account: "ajani-automation", followers: 276, odds: [0, 0.04, 0.32, 0.04, 0.32, 0.04, 0], doubleOdds: 0, base: [16, 48], reach: [140, 420], views: [2, 8], followDivisor: 120 },
] as const;

function buildLinkedIn(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  for (const profile of LINKEDIN_ACCOUNTS) {
    const { account } = profile;
    const posts = publishing("linkedin.posts_published", account, line, profile.odds, profile.doubleOdds);
    const reach = (day: number) => between(profile.reach[0], profile.reach[1], rand("linkedin.reach", account, line.dates[day])) * audience(day);
    let followers = profile.followers;
    // Typed in each evening, so manual numbers end yesterday.
    for (let index = 0; index <= YESTERDAY_INDEX; index += 1) {
      const date = line.dates[index];
      const unit = (salt: string) => rand("linkedin", account, date, salt);
      const impressions = Math.round(between(profile.base[0], profile.base[1], unit("base")) * audience(index) + postReach(posts, index, [1, 0.45, 0.15], reach));
      const reactions = Math.round(impressions * between(0.014, 0.026, unit("reactions")));
      const comments = Math.round(impressions * between(0.002, 0.0055, unit("comments")));
      const engagements = reactions + comments + Math.round(impressions * between(0.002, 0.006, unit("reposts")));
      const profileViews = Math.round(between(profile.views[0], profile.views[1], unit("views")) * audience(index) + impressions * 0.006);
      followers += Math.max(-1, Math.round(impressions / profile.followDivisor + between(-0.9, 1.1, unit("follow"))));
      addRow(rows, "linkedin.followers", date, account, followers);
      addRow(rows, "linkedin.impressions", date, account, impressions);
      addRow(rows, "linkedin.engagements", date, account, engagements);
      addRow(rows, "linkedin.reactions", date, account, reactions);
      addRow(rows, "linkedin.comments", date, account, comments);
      addRow(rows, "linkedin.profile_views", date, account, profileViews);
      addRow(rows, "linkedin.posts_published", date, account, posts[index]);
    }
  }
  return rows;
}

function buildYouTube(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  const videos = publishing("youtube.videos_published", "", line, [0.05, 0.12, 0.45, 0.12, 0.35, 0.08, 0.1], 0.1);
  const reach = (day: number) => between(180, 650, rand("youtube.reach", line.dates[day])) * audience(day);
  let subscribers = 412;
  let totalViews = 17_850;
  for (let index = 0; index <= YESTERDAY_INDEX; index += 1) {
    const date = line.dates[index];
    const unit = (salt: string) => rand("youtube", date, salt);
    const views = Math.round(between(45, 110, unit("base")) * audience(index) + postReach(videos, index, [1, 0.55, 0.3, 0.15, 0.08], reach));
    const gained = Math.round(views * between(0.005, 0.01, unit("gained")));
    const lost = Math.round(gained * between(0.12, 0.35, unit("lost")));
    subscribers += gained - lost;
    totalViews += views;
    addRow(rows, "youtube.views", date, "", views);
    addRow(rows, "youtube.shorts_views", date, "", Math.round(views * between(0.32, 0.55, unit("shorts"))));
    addRow(rows, "youtube.watch_hours", date, "", Math.round((views * between(1.4, 2.8, unit("minutes")) / 60) * 100) / 100);
    addRow(rows, "youtube.likes", date, "", Math.round(views * between(0.03, 0.055, unit("likes"))));
    addRow(rows, "youtube.comments", date, "", Math.round(views * between(0.003, 0.009, unit("comments"))));
    addRow(rows, "youtube.shares", date, "", Math.round(views * between(0.004, 0.011, unit("shares"))));
    addRow(rows, "youtube.videos_published", date, "", videos[index]);
    addRow(rows, "youtube.subscribers", date, "", subscribers);
    // YouTube Analytics finalizes a day late, so synced numbers also end yesterday.
    addRow(rows, "youtube.subscribers_gained", date, "", gained);
    addRow(rows, "youtube.subscribers_lost", date, "", lost);
    addRow(rows, "youtube.total_views", date, "", totalViews);
  }
  return rows;
}

function buildInstagram(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  const posts = publishing("instagram.posts_published", "", line, [0.35, 0.45, 0.2, 0.5, 0.25, 0.45, 0.3], 0.05);
  const reach = (day: number) => between(280, 1_100, rand("instagram.reach", line.dates[day])) * audience(day);
  let followers = 788;
  for (let index = 0; index <= YESTERDAY_INDEX; index += 1) {
    const date = line.dates[index];
    const unit = (salt: string) => rand("instagram", date, salt);
    const reached = Math.round(between(90, 220, unit("base")) * audience(index) + postReach(posts, index, [1, 0.45, 0.18], reach));
    const likes = Math.round(reached * between(0.04, 0.07, unit("likes")));
    const comments = Math.round(reached * between(0.004, 0.01, unit("comments")));
    const saves = Math.round(reached * between(0.003, 0.008, unit("saves")));
    const shares = Math.round(reached * between(0.003, 0.009, unit("shares")));
    const visits = Math.round(between(6, 16, unit("visits")) * audience(index) + reached * between(0.018, 0.035, unit("visit-rate")));
    followers += Math.max(-1, Math.round(visits * between(0.05, 0.11, unit("follow")) - (unit("unfollow") < 0.3 ? 1 : 0)));
    addRow(rows, "instagram.followers", date, "", followers);
    addRow(rows, "instagram.reach", date, "", reached);
    addRow(rows, "instagram.views", date, "", Math.round(reached * between(1.5, 2.4, unit("views"))));
    addRow(rows, "instagram.likes", date, "", likes);
    addRow(rows, "instagram.comments", date, "", comments);
    addRow(rows, "instagram.saves", date, "", saves);
    addRow(rows, "instagram.shares", date, "", shares);
    addRow(rows, "instagram.interactions", date, "", likes + comments + saves + shares + intBetween(0, 3, unit("replies")));
    addRow(rows, "instagram.profile_visits", date, "", visits);
    addRow(rows, "instagram.profile_link_taps", date, "", Math.round(visits * between(0.04, 0.12, unit("taps"))));
    addRow(rows, "instagram.posts_published", date, "", posts[index]);
  }
  return rows;
}

function buildTikTok(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  const videos = publishing("tiktok.videos_published", "", line, [0.4, 0.35, 0.3, 0.4, 0.3, 0.45, 0.45], 0.05);
  // Most videos reach a few hundred to a couple of thousand people; about one in thirty takes off.
  const reach = (day: number) => {
    const date = line.dates[day];
    return rand("tiktok.viral", date) < 0.035 ? between(6_000, 12_000, rand("tiktok.reach", date)) : between(250, 2_200, rand("tiktok.reach", date));
  };
  let followers = 231;
  for (let index = 0; index <= YESTERDAY_INDEX; index += 1) {
    const date = line.dates[index];
    const unit = (salt: string) => rand("tiktok", date, salt);
    const views = Math.round(between(60, 160, unit("base")) * audience(index) + postReach(videos, index, [1, 0.5, 0.2, 0.08], reach));
    const profileViews = Math.round(views * between(0.012, 0.025, unit("profile")));
    followers += Math.max(-1, Math.round(profileViews * between(0.06, 0.12, unit("follow")) - (unit("unfollow") < 0.25 ? 1 : 0)));
    addRow(rows, "tiktok.followers", date, "", followers);
    addRow(rows, "tiktok.views", date, "", views);
    addRow(rows, "tiktok.likes", date, "", Math.round(views * between(0.05, 0.09, unit("likes"))));
    addRow(rows, "tiktok.comments", date, "", Math.round(views * between(0.003, 0.008, unit("comments"))));
    addRow(rows, "tiktok.shares", date, "", Math.round(views * between(0.002, 0.006, unit("shares"))));
    addRow(rows, "tiktok.profile_views", date, "", profileViews);
    addRow(rows, "tiktok.videos_published", date, "", videos[index]);
  }
  return rows;
}

function buildReddit(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  const posts = publishing("reddit.posts_published", "", line, [0.1, 0.18, 0.12, 0.18, 0.12, 0.1, 0.1], 0);
  const reach = (day: number) => between(500, 3_400, rand("reddit.reach", line.dates[day]));
  const dms = line.dates.map((date, index) => isWeekday(line.dow[index]) && rand("reddit.dms_sent", date, "active") < 0.75 ? intBetween(2, 7, rand("reddit.dms_sent", date)) : 0);
  let karma = 1_140;
  for (let index = 0; index <= YESTERDAY_INDEX; index += 1) {
    const date = line.dates[index];
    const unit = (salt: string) => rand("reddit", date, salt);
    const views = Math.round(between(15, 110, unit("base")) * audience(index) + postReach(posts, index, [1, 0.3, 0.1], reach));
    const upvotes = Math.round(views * between(0.01, 0.02, unit("upvotes")));
    const comments = Math.round(views * between(0.004, 0.01, unit("comments")));
    karma += Math.max(-2, upvotes + Math.round(comments / 2) + intBetween(0, 4, unit("commenting")) - (unit("downvoted") < 0.1 ? 3 : 0));
    addRow(rows, "reddit.karma", date, "", karma);
    addRow(rows, "reddit.views", date, "", views);
    addRow(rows, "reddit.upvotes", date, "", upvotes);
    addRow(rows, "reddit.comments", date, "", comments);
    addRow(rows, "reddit.posts_published", date, "", posts[index]);
    // Outreach DMs are logged on workdays only.
    if (isWeekday(line.dow[index])) {
      const recent = dms[index] + (index > 0 ? dms[index - 1] : 0);
      const replies = Math.min(recent, Math.round(recent * between(0.06, 0.16, unit("replies"))));
      addRow(rows, "reddit.dms_sent", date, "", dms[index]);
      addRow(rows, "reddit.dm_replies", date, "", replies);
      addRow(rows, "reddit.dm_calls_booked", date, "", replies > 0 && unit("call") < 0.18 ? 1 : 0);
    }
  }
  return rows;
}

const OUTREACH_CHANNELS = [
  { dimension: "linkedin/manual", channel: "linkedin", method: "manual", audience: "Insurance agency owners", team: ["Owner", "Setter"], weekdayOdds: 1, weekday: [18, 32], weekendOdds: 0.3, weekend: [1, 5], requests: 0.45, dms: 0.3 },
  { dimension: "linkedin/dripify", channel: "linkedin", method: "dripify", audience: "Med spa founders", team: ["Owner"], weekdayOdds: 1, weekday: [8, 16], weekendOdds: 0, weekend: [0, 0], requests: 0.55, dms: 0.25 },
  { dimension: "instagram/manual", channel: "instagram", method: "manual", audience: "HVAC business owners", team: ["Setter"], weekdayOdds: 0.55, weekday: [2, 7], weekendOdds: 0.1, weekend: [1, 3], requests: 0, dms: 0.7 },
] as const;

/** Outreach batches, rolled up per day and channel/method like analytics_daily_values. */
function buildOutreach(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  for (let index = 0; index <= TODAY_INDEX; index += 1) {
    const date = line.dates[index];
    const weekday = isWeekday(line.dow[index]);
    for (const channel of OUTREACH_CHANNELS) {
      const unit = (salt: string) => rand("outreach", channel.dimension, date, salt);
      if (unit("logged") >= (weekday ? channel.weekdayOdds : channel.weekendOdds)) continue;
      const [low, high] = weekday ? channel.weekday : channel.weekend;
      // Volume ramps up over the period: 20-60 touches a workday in total, a few at weekends.
      const touches = Math.max(1, Math.round(intBetween(low, high, unit("volume")) * (0.85 + (0.23 * index) / SAMPLE_HISTORY_DAYS)));
      const requests = channel.requests ? Math.round(touches * (channel.requests + between(-0.05, 0.05, unit("requests")))) : 0;
      const dms = Math.min(touches - requests, Math.round(touches * (channel.dms + between(-0.05, 0.05, unit("dms")))));
      const followUps = touches - requests - dms;
      const accepted = Math.round(requests * between(0.26, 0.42, unit("accepted")));
      const replies = Math.min(dms, Math.round(touches * between(0.05, 0.12, unit("replies"))));
      const positive = Math.round(replies * between(0.3, 0.6, unit("positive")));
      let calls = 0;
      for (let reply = 0; reply < positive; reply += 1) if (rand("outreach.call", channel.dimension, date, reply) < 0.32) calls += 1;
      const values: Array<[string, number]> = [
        ["outreach.touches", touches], ["outreach.connection_requests", requests], ["outreach.connections_accepted", accepted],
        ["outreach.initial_dms", dms], ["outreach.follow_ups", followUps], ["outreach.replies", replies],
        ["outreach.reply_base", dms], ["outreach.positive_replies", positive], ["outreach.calls_booked", calls],
      ];
      values.forEach(([key, value]) => addRow(rows, key, date, channel.dimension, value));
    }
  }
  return rows;
}

/** Website briefs: each saved draft moves through the funnel, and some become builds days later. */
function buildAjani(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  const builds = new Array<number>(line.dates.length).fill(0);
  const workspaces = new Array<number>(line.dates.length).fill(0);
  for (let index = 0; index <= TODAY_INDEX; index += 1) {
    const date = line.dates[index];
    const mean = (0.55 + (0.9 * index) / SAMPLE_HISTORY_DAYS) * (isWeekday(line.dow[index]) ? 1 : 0.55);
    const saved = countEvents(mean, "ajani.drafts_saved", date);
    if (!saved) continue;
    let processed = 0;
    let approved = 0;
    let claimed = 0;
    let submitted = 0;
    for (let draft = 0; draft < saved; draft += 1) {
      const unit = (salt: string) => rand("ajani.draft", date, draft, salt);
      if (unit("processed") >= 0.94) continue;
      processed += 1;
      if (unit("approved") >= 0.6) continue;
      approved += 1;
      if (unit("claimed") >= 0.74) continue;
      claimed += 1;
      if (unit("submits") >= 0.66) continue;
      const day = index + intBetween(1, 12, unit("lag"));
      // A brief that will be submitted later is not submitted yet.
      if (day > TODAY_INDEX) continue;
      submitted += 1;
      builds[day] += 1;
      if (unit("new-client") < 0.78) workspaces[day] += 1;
    }
    addRow(rows, "ajani.drafts_saved", date, "", saved);
    addRow(rows, "ajani.cohort_submitted", date, "", submitted);
    // Funnel stages for the dashboard (not metrics; "~" keys never match a metric key).
    addRow(rows, "~funnel.processed", date, "", processed);
    addRow(rows, "~funnel.approved", date, "", approved);
    addRow(rows, "~funnel.claimed", date, "", claimed);
  }
  builds.forEach((count, index) => { if (count) addRow(rows, "ajani.builds_submitted", line.dates[index], "", count); });
  workspaces.forEach((count, index) => { if (count) addRow(rows, "ajani.new_workspaces", line.dates[index], "", count); });
  return rows;
}

type DripifyCampaignPlan = {
  id: number; firstSync: number; loads: Array<[number, number]> | "low"; pace: [number, number]; accept: number; reply: number; fail: number;
  /** The owner tops a campaign up on a workday once its unsent leads fall below `below`, until day `until`. */
  refill?: { below: number; size: [number, number]; until: number };
};

const DRIPIFY_CAMPAIGNS: DripifyCampaignPlan[] = [
  // Topped up for its first months, then left to run out; late acceptances and replies keep arriving.
  { id: 101, firstSync: 0, loads: [[0, 820]], refill: { below: 70, size: [380, 560], until: 120 }, pace: [14, 22], accept: 0.29, reply: 0.052, fail: 0.03 },
  { id: 202, firstSync: 52, loads: [[52, 600]], refill: { below: 80, size: [420, 680], until: TODAY_INDEX }, pace: [15, 23], accept: 0.36, reply: 0.074, fail: 0.025 },
  // Newest campaign, nearly out of fresh leads today.
  { id: 303, firstSync: 138, loads: "low", pace: [16, 24], accept: 0.33, reply: 0.061, fail: 0.035 },
];
const DRIPIFY_TEAM = "dripify-team:7";
const SEQUENCE_DAYS = 21;

/** Share of a day's contacts who have responded `days` days later (geometric lag), built by multiplication only. */
function lagCurve(keep: number) {
  const curve: number[] = [];
  let remaining = 1;
  for (let day = 0; day <= SAMPLE_HISTORY_DAYS; day += 1) {
    remaining *= keep;
    curve.push(1 - remaining);
  }
  return curve;
}
const ACCEPT_CURVE = lagCurve(0.72);
const REPLY_CURVE = lagCurve(0.86);

/**
 * Per-campaign running totals from Dripify's nightly sync: they only ever
 * increase (accepted and replied never pass contacted), and the new_* flows are
 * each total's change since the previous sync. A campaign's first sync has no
 * earlier total, so its first day has no new_* values, like the connector.
 */
function buildDripify(line: Timeline): RowMap {
  const rows: RowMap = new Map();
  const sending = new Array<number>(line.dates.length).fill(0);
  const newReplies = new Array<number>(line.dates.length).fill(0);
  for (const campaign of DRIPIFY_CAMPAIGNS) {
    const dimension = `dripify:${campaign.id}`;
    const contactedPerDay = new Array<number>(line.dates.length).fill(0);
    const quality = line.dates.map((date) => between(0.85, 1.15, rand("dripify.quality", dimension, date)));
    const pace = (index: number) => isWeekday(line.dow[index]) ? intBetween(campaign.pace[0], campaign.pace[1], rand("dripify.pace", dimension, line.dates[index])) : 0;
    let loads = campaign.loads === "low" ? [] : campaign.loads;
    if (campaign.loads === "low") {
      // Size the only load so a couple of days of leads are left today.
      let planned = 0;
      for (let index = campaign.firstSync; index <= TODAY_INDEX; index += 1) planned += pace(index);
      loads = [[campaign.firstSync, planned + 26]];
    }
    let total = 0;
    let contacted = 0;
    let previous: { contacted: number; accepted: number; replied: number } | null = null;
    for (let index = campaign.firstSync; index <= TODAY_INDEX; index += 1) {
      const date = line.dates[index];
      for (const [day, size] of loads) if (day === index) total += size;
      const refill = campaign.refill;
      if (refill && index > campaign.firstSync && index <= refill.until && isWeekday(line.dow[index]) && total - contacted < refill.below) {
        total += intBetween(refill.size[0], refill.size[1], rand("dripify.refill", dimension, date));
      }
      const sent = Math.min(total - contacted, pace(index));
      contactedPerDay[index] = sent;
      contacted += sent;
      let expectedAccepted = 0;
      let expectedReplied = 0;
      let expectedFailed = 0;
      let expectedFinished = 0;
      for (let day = campaign.firstSync; day <= index; day += 1) {
        const leads = contactedPerDay[day];
        if (!leads) continue;
        const age = index - day;
        expectedAccepted += leads * Math.min(0.95, campaign.accept * quality[day]) * ACCEPT_CURVE[age];
        expectedReplied += leads * Math.min(0.5, campaign.reply * quality[day]) * REPLY_CURVE[age];
        expectedFailed += leads * campaign.fail * Math.min(1, (age + 1) / 3);
        if (age >= SEQUENCE_DAYS) expectedFinished += leads * (1 - campaign.fail);
      }
      const accepted = Math.floor(expectedAccepted);
      const replied = Math.min(accepted, Math.floor(expectedReplied));
      const failed = Math.floor(expectedFailed);
      const finished = Math.floor(expectedFinished);
      const counts: Array<[string, number]> = [
        ["dripify.leads_total", total], ["dripify.leads_contacted", contacted], ["dripify.leads_accepted", accepted],
        ["dripify.leads_replied", replied], ["dripify.leads_remaining", total - contacted],
        ["dripify.leads_in_progress", contacted - finished - failed], ["dripify.leads_finished", finished], ["dripify.leads_failed", failed],
      ];
      if (previous) {
        counts.push(["dripify.new_contacted", contacted - previous.contacted], ["dripify.new_accepted", accepted - previous.accepted], ["dripify.new_replies", replied - previous.replied]);
        newReplies[index] += replied - previous.replied;
      }
      counts.forEach(([key, value]) => addRow(rows, key, date, dimension, value));
      if (total - contacted > 0) sending[index] += 1;
      previous = { contacted, accepted, replied };
    }
  }
  for (let index = 0; index <= TODAY_INDEX; index += 1) {
    const date = line.dates[index];
    addRow(rows, "dripify.active_campaigns", date, DRIPIFY_TEAM, sending[index]);
    addRow(rows, "dripify.unread_messages", date, DRIPIFY_TEAM, Math.min(9, Math.round(newReplies[index] * between(0.4, 0.9, rand("dripify.unread", date)) + intBetween(0, 2, rand("dripify.unread", date, "carry")))));
  }
  return rows;
}

/**
 * Clients: setup fees on signing, monthly retainers 30 days apart, one churn.
 * Days are counted back from today (an earlier client predates the history).
 */
const SAMPLE_DEALS = [
  { daysAgo: 200, setup: 180_000, retainer: 30_000, churnDaysAgo: null },
  { daysAgo: 168, setup: 200_000, retainer: 50_000, churnDaysAgo: null },
  { daysAgo: 139, setup: 150_000, retainer: 0, churnDaysAgo: null },
  { daysAgo: 110, setup: 250_000, retainer: 40_000, churnDaysAgo: 58 },
  { daysAgo: 75, setup: 180_000, retainer: 45_000, churnDaysAgo: null },
  { daysAgo: 41, setup: 300_000, retainer: 0, churnDaysAgo: null },
  { daysAgo: 12, setup: 150_000, retainer: 30_000, churnDaysAgo: null },
] as const;

function weekdayOnOrBefore(line: Timeline, index: number) {
  let day = index;
  while (day > 0 && !isWeekday(line.dow[day])) day -= 1;
  return day;
}

function weekdayOnOrAfter(line: Timeline, index: number) {
  let day = index;
  while (day < line.dow.length && !isWeekday(line.dow[day])) day += 1;
  return day;
}

/** Sales and revenue, logged every workday (zeros included) through yesterday. */
function buildBusiness(line: Timeline, outreach: RowMap, reddit: RowMap): RowMap {
  const rows: RowMap = new Map();
  const length = line.dates.length;
  const deals = new Array<number>(length).fill(0);
  const cash = new Array<number>(length).fill(0);
  const held = new Array<number>(length).fill(0);
  const proposals = new Array<number>(length).fill(0);
  const signed = SAMPLE_DEALS.map((deal) => {
    const raw = TODAY_INDEX - deal.daysAgo;
    const day = raw >= 0 ? weekdayOnOrBefore(line, raw) : raw;
    return { ...deal, day, churnDay: deal.churnDaysAgo === null ? null : TODAY_INDEX - deal.churnDaysAgo };
  });
  for (const deal of signed) {
    if (deal.day >= 0) {
      deals[deal.day] += 1;
      cash[deal.day] += deal.setup;
      // Signing day has its own calls held (the walkthrough, the team intro, the closing call), so close rate stays believable.
      held[deal.day] += 3;
    }
    if (!deal.retainer) continue;
    for (let month = 1; ; month += 1) {
      const due = deal.day + 30 * month;
      if (deal.churnDay !== null && due >= deal.churnDay) break;
      if (due > YESTERDAY_INDEX) break;
      if (due < 0) continue;
      const paid = weekdayOnOrAfter(line, due);
      if (paid <= YESTERDAY_INDEX) cash[paid] += deal.retainer;
    }
  }
  // About seven in ten booked calls take place, one to six days after booking.
  const booked = [...(outreach.get("outreach.calls_booked") ?? []), ...(reddit.get("reddit.dm_calls_booked") ?? [])];
  const indexOf = new Map(line.dates.map((date, index) => [date, index]));
  for (const row of booked) {
    for (let call = 0; call < row.value; call += 1) {
      const unit = (salt: string) => rand("sales.calls_held", row.date, row.dimension, call, salt);
      if (unit("show") >= 0.72) continue;
      const day = weekdayOnOrAfter(line, (indexOf.get(row.date) ?? 0) + intBetween(1, 6, unit("lag")));
      if (day > YESTERDAY_INDEX) continue;
      held[day] += 1;
      if (unit("proposal") < 0.38) {
        const sent = weekdayOnOrAfter(line, day + intBetween(0, 2, unit("proposal-lag")));
        if (sent <= YESTERDAY_INDEX) proposals[sent] += 1;
      }
    }
  }
  for (let index = 0; index <= YESTERDAY_INDEX; index += 1) {
    if (!isWeekday(line.dow[index])) continue;
    const date = line.dates[index];
    const active = signed.filter((deal) => deal.retainer && deal.day <= index && (deal.churnDay === null || index < deal.churnDay));
    addRow(rows, "sales.deals_won", date, "", deals[index]);
    addRow(rows, "sales.calls_held", date, "", held[index]);
    addRow(rows, "sales.proposals_sent", date, "", proposals[index]);
    addRow(rows, "sales.content_leads", date, "", countEvents(0.25 + (0.35 * index) / SAMPLE_HISTORY_DAYS, "sales.content_leads", date));
    addRow(rows, "revenue.cash_collected", date, "", cash[index]);
    addRow(rows, "revenue.mrr", date, "", active.reduce((sum, deal) => sum + deal.retainer, 0));
    addRow(rows, "revenue.active_clients", date, "", active.length);
  }
  return rows;
}

/** Any metric this file does not know (a definition added after it was written). */
function buildGeneric(item: MetricDefinition, line: Timeline): SampleRow[] {
  if (item.aggregation === "ratio") return [];
  const scale = 2 + Math.floor(rand(item.key, "scale") * 30);
  const end = item.entryMode === "manual" ? YESTERDAY_INDEX : TODAY_INDEX;
  const rows: SampleRow[] = [];
  let stock = scale * 40;
  for (let index = 0; index <= end; index += 1) {
    const date = line.dates[index];
    const unit = rand(item.key, "", date);
    let value: number;
    if (item.aggregation === "last") {
      stock += Math.round(between(-0.2, 1, unit) * scale * 0.2);
      value = Math.max(0, stock);
    } else {
      value = countEvents(scale * 0.25 * audience(index), item.key, "", date);
    }
    if (item.unit === "currency_cents") value *= 2_500;
    if (item.unit === "hours") value = Math.round(value * between(0.2, 0.6, rand(item.key, date, "hours")) * 100) / 100;
    rows.push({ date, dimension: "", value });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Row cache, keyed by today: groups are generated once and only read after.
// ---------------------------------------------------------------------------

type GroupId = "linkedin" | "youtube" | "instagram" | "tiktok" | "reddit" | "outreach" | "ajani" | "dripify" | "business";
const GROUP_BY_SOURCE: Record<string, GroupId> = {
  linkedin: "linkedin", youtube: "youtube", instagram: "instagram", tiktok: "tiktok", reddit: "reddit",
  outreach: "outreach", ajani: "ajani", dripify: "dripify", sales: "business", revenue: "business",
};
const rowCache = new Map<string, { line: Timeline; groups: Map<GroupId, RowMap>; generic: Map<string, SampleRow[]> }>();

function cacheFor(today: string) {
  let entry = rowCache.get(today);
  if (!entry) {
    if (rowCache.size >= 3) rowCache.delete(rowCache.keys().next().value as string);
    entry = { line: buildTimeline(today), groups: new Map(), generic: new Map() };
    rowCache.set(today, entry);
  }
  return entry;
}

function groupRows(group: GroupId, today: string): RowMap {
  const entry = cacheFor(today);
  let rows = entry.groups.get(group);
  if (!rows) {
    const line = entry.line;
    rows = group === "linkedin" ? buildLinkedIn(line)
      : group === "youtube" ? buildYouTube(line)
        : group === "instagram" ? buildInstagram(line)
          : group === "tiktok" ? buildTikTok(line)
            : group === "reddit" ? buildReddit(line)
              : group === "outreach" ? buildOutreach(line)
                : group === "ajani" ? buildAjani(line)
                  : group === "dripify" ? buildDripify(line)
                    : buildBusiness(line, groupRows("outreach", today), groupRows("reddit", today));
    entry.groups.set(group, rows);
  }
  return rows;
}

/** Every daily value of one metric (all accounts), oldest first. Ratios have none: they are computed. */
function rowsFor(key: string, item: MetricDefinition | undefined, today: string): SampleRow[] {
  if (item?.aggregation === "ratio") return [];
  const group = GROUP_BY_SOURCE[key.slice(0, key.indexOf("."))];
  const known = group ? groupRows(group, today).get(key) : undefined;
  if (known) return known;
  if (!item) return [];
  const entry = cacheFor(today);
  let rows = entry.generic.get(key);
  if (!rows) {
    rows = buildGeneric(item, entry.line);
    entry.generic.set(key, rows);
  }
  return rows;
}

/** The sample's daily rows for one metric: what analytics_daily_values would return. */
export function sampleMetricRows(key: string, today: string, definitions: MetricDefinition[] = SAMPLE_DEFINITIONS): SampleRow[] {
  const item = definitions.find((candidate) => candidate.key === key) ?? SAMPLE_DEFINITION_BY_KEY.get(key);
  return rowsFor(key, item, today).map((row) => ({ ...row }));
}

// ---------------------------------------------------------------------------
// Catalog.
// ---------------------------------------------------------------------------

const RECENT_ENTRY_ORDER = [
  "linkedin.followers", "linkedin.impressions", "linkedin.posts_published", "revenue.cash_collected", "sales.calls_held",
  "youtube.subscribers", "youtube.views", "instagram.followers", "instagram.reach", "tiktok.followers", "tiktok.views", "reddit.karma",
];

export function sampleMetricCatalog(definitions: MetricDefinition[], today: string): MetricCatalog {
  const metrics = definitions.length ? definitions : SAMPLE_DEFINITIONS;
  const lookup = new Map(metrics.map((item) => [item.key, item]));
  const outreachDimensions = OUTREACH_CHANNELS.map((channel) => channel.dimension).sort();
  const catalogMetrics = metrics.map((item): MetricDefinition => {
    // Like load_analytics_catalog: a ratio shows its numerator's stored history.
    const dataKey = item.aggregation === "ratio" ? item.numeratorKey ?? item.key : item.key;
    const dataDefinition = lookup.get(dataKey) ?? SAMPLE_DEFINITION_BY_KEY.get(dataKey);
    const stored = dataDefinition && dataDefinition.entryMode !== "derived" ? rowsFor(dataKey, dataDefinition, today) : [];
    const dates = stored.map((row) => row.date).sort();
    return {
      ...item,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      dimensions: item.source === "outreach"
        ? outreachDimensions
        : [...new Set(stored.map((row) => row.dimension).filter(Boolean))].sort().slice(0, 50),
    };
  });
  return {
    status: "available",
    today,
    metrics: catalogMetrics,
    recentEntries: sampleRecentEntries(lookup, today),
    dimensionLabels: { ...SAMPLE_DIMENSION_LABELS },
    connectors: { dripify: true },
  };
}

/** A dozen of the newest manual entries (never zeros), as if typed in each evening. */
function sampleRecentEntries(lookup: Map<string, MetricDefinition>, today: string): MetricEntry[] {
  const entries: MetricEntry[] = [];
  for (const back of [1, 2, 3, 4]) {
    const date = addDays(today, -back);
    for (const key of RECENT_ENTRY_ORDER) {
      const item = lookup.get(key);
      if (!item || item.entryMode !== "manual") continue;
      const row = rowsFor(key, item, today).find((candidate) => candidate.date === date && candidate.value > 0);
      if (!row) continue;
      // Typed in that evening, newest first.
      entries.push({ metricKey: key, date, dimension: row.dimension, value: row.value, recordedAt: `${date}T21:${String(59 - entries.length * 4).padStart(2, "0")}:00.000Z` });
      if (entries.length === 12) return entries;
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Series: load_analytics_series, in TypeScript.
// ---------------------------------------------------------------------------

type ComponentSeries = { values: Array<number | null>; current: number | null; previous: number | null; availableFrom: string | null };

function nextPeriod(start: Date, grain: MetricGrain) {
  const next = new Date(start.getTime());
  if (grain === "day") next.setUTCDate(next.getUTCDate() + 1);
  if (grain === "week") next.setUTCDate(next.getUTCDate() + 7);
  if (grain === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  if (grain === "quarter") next.setUTCMonth(next.getUTCMonth() + 3);
  if (grain === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

function bucketsFor(grain: MetricGrain, rangeFrom: string, rangeTo: string, today: string): MetricBucket[] {
  const buckets: MetricBucket[] = [];
  for (let start = parseDay(rangeFrom); formatDay(start) <= rangeTo; start = nextPeriod(start, grain)) {
    if (buckets.length >= MAX_BUCKETS) throw new Error("Too many periods; choose a larger grain");
    const naturalEnd = addDays(formatDay(nextPeriod(start, grain)), -1);
    buckets.push({
      start: formatDay(start),
      end: naturalEnd > rangeTo ? rangeTo : naturalEnd,
      partial: naturalEnd > rangeTo || naturalEnd >= today,
    });
  }
  return buckets;
}

/** numeric(20,4) storage: sums of hours stay clean. */
function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/** round(numerator / denominator, 6), as the RPC returns ratios. */
function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function laterDate(left: string | null, right: string | null) {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

export function sampleMetricSeries(query: MetricSeriesQuery, definitions: MetricDefinition[], today: string): MetricSeriesResult {
  const lookup = new Map(SAMPLE_DEFINITIONS.map((item) => [item.key, item]));
  definitions.forEach((item) => lookup.set(item.key, item));
  const { grain } = query;
  const dimension = query.dimension?.trim().toLowerCase() || null;
  if (query.from > query.to || query.from < "2000-01-01" || query.to > addDays(today, 1)) throw new Error("Invalid date range");
  // Unknown metrics are skipped here; the RPC would refuse the whole request.
  const requested = [...new Set(query.metrics)].filter((key) => lookup.has(key)).sort();
  const rangeFrom = formatDay(periodStart(grain, parseDay(query.from)));
  const rangeTo = query.to;
  const buckets = bucketsFor(grain, rangeFrom, rangeTo, today);
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.start, index]));
  const previousTo = addDays(rangeFrom, -1);
  const previousFrom = addDays(rangeFrom, -dayCount(rangeFrom, rangeTo));
  const coverage = sampleHistoryStart(today);
  const components = new Map<string, ComponentSeries | null>();

  const measure = (key: string | null): ComponentSeries | null => {
    if (!key) return null;
    if (components.has(key)) return components.get(key) ?? null;
    const item = lookup.get(key);
    let result: ComponentSeries | null = null;
    if (item && item.aggregation !== "ratio") {
      const availableFrom = COHORT_KEYS.has(key) ? coverage : null;
      // Only derived flows are true zeros on quiet days, and only when the
      // account/channel filter applies to them (outreach has channels).
      const zeroFilled = item.entryMode === "derived" && item.aggregation === "sum" && (dimension === null || item.source === "outreach");
      const rows = rowsFor(key, item, today).filter((row) => row.date <= rangeTo && (dimension === null || row.dimension === dimension));
      const values: Array<number | null> = buckets.map(() => null);
      let current: number | null = null;
      let previous: number | null = null;
      if (item.aggregation === "sum") {
        for (const row of rows) {
          if (row.date < previousFrom) continue;
          if (row.date >= rangeFrom) {
            const index = bucketIndex.get(formatDay(periodStart(grain, parseDay(row.date)))) as number;
            values[index] = (values[index] ?? 0) + row.value;
            current = (current ?? 0) + row.value;
          } else {
            previous = (previous ?? 0) + row.value;
          }
        }
      } else {
        // Stocks: each account's latest value at the end of each bucket,
        // carried forward until a newer one is recorded, summed across accounts.
        const accounts = new Map<string, SampleRow[]>();
        for (const row of rows) {
          const list = accounts.get(row.dimension);
          if (list) list.push(row);
          else accounts.set(row.dimension, [row]);
        }
        const latestBy = (list: SampleRow[], day: string) => {
          let latest: SampleRow | null = null;
          for (const row of list) {
            if (row.date > day) break;
            latest = row;
          }
          return latest;
        };
        for (const list of accounts.values()) {
          list.sort((left, right) => left.date.localeCompare(right.date));
          let position = -1;
          buckets.forEach((bucket, index) => {
            while (position + 1 < list.length && list[position + 1].date <= bucket.end) position += 1;
            if (position >= 0) values[index] = (values[index] ?? 0) + list[position].value;
          });
          const atEnd = latestBy(list, rangeTo);
          if (atEnd) current = (current ?? 0) + atEnd.value;
          const atPreviousEnd = latestBy(list, previousTo);
          if (atPreviousEnd) previous = (previous ?? 0) + atPreviousEnd.value;
        }
      }
      // Recorded metrics without a value, periods before tracking began and
      // filters that do not apply stay null (unknown), never zero.
      result = {
        availableFrom,
        values: values.map((value, index) => value !== null ? round4(value)
          : zeroFilled && (availableFrom === null || buckets[index].end >= availableFrom) ? 0 : null),
        current: current !== null ? round4(current) : zeroFilled && (availableFrom === null || rangeTo >= availableFrom) ? 0 : null,
        // A comparison window reaching before tracking began would be biased.
        previous: availableFrom !== null && previousFrom < availableFrom ? null
          : previous !== null ? round4(previous) : zeroFilled ? 0 : null,
      };
    }
    components.set(key, result);
    return result;
  };

  const series = requested.flatMap((key): MetricSeries[] => {
    const item = lookup.get(key) as MetricDefinition;
    if (item.aggregation !== "ratio") {
      const own = measure(key);
      if (!own) return [];
      return [{
        metricKey: key, values: own.values, numerators: null, denominators: null,
        current: own.current, previous: own.previous,
        currentNumerator: null, currentDenominator: null, previousNumerator: null, previousDenominator: null,
        coverageFrom: own.availableFrom,
      }];
    }
    const numerator = measure(item.numeratorKey);
    const denominator = measure(item.denominatorKey);
    // The RPC builds a ratio's buckets from its denominator.
    if (!denominator) return [];
    const ratio = (top: number | null, bottom: number | null) => bottom !== null && bottom > 0 && top !== null ? round6(top / bottom) : null;
    const numerators = buckets.map((_, index) => numerator?.values[index] ?? null);
    return [{
      metricKey: key,
      values: buckets.map((_, index) => ratio(numerators[index], denominator.values[index])),
      numerators,
      denominators: denominator.values,
      current: ratio(numerator?.current ?? null, denominator.current),
      previous: ratio(numerator?.previous ?? null, denominator.previous),
      currentNumerator: numerator?.current ?? null,
      currentDenominator: denominator.current,
      previousNumerator: numerator?.previous ?? null,
      previousDenominator: denominator.previous,
      coverageFrom: laterDate(numerator?.availableFrom ?? null, denominator.availableFrom),
    }];
  });

  return { grain, from: rangeFrom, to: rangeTo, previousFrom, previousTo, today, dimension, buckets, series };
}

// ---------------------------------------------------------------------------
// Growth goals: the five seeded in 20261016030000_growth_goals.sql, measured
// from the sample series exactly as load_analytics_goals measures real ones.
// ---------------------------------------------------------------------------

type SampleGoal = { key: string; metricKey: string; label: string; description: string; measure: GoalMeasure; target: number; startDate: string; dueDate: string | null };

export const SAMPLE_GOALS: SampleGoal[] = [
  { key: "clients_signed", metricKey: "sales.deals_won", label: "Clients signed", measure: "total", target: 5, startDate: "2026-07-12", dueDate: "2027-01-01",
    description: "Growth Goal Sheet: 5 signed clients by Jan 1, 2027, counted from Jul 12, 2026. A client counts once they sign and pay the first invoice." },
  { key: "revenue_collected", metricKey: "revenue.cash_collected", label: "Revenue collected", measure: "total", target: 500_000, startDate: "2026-07-12", dueDate: "2027-01-01",
    description: "Growth Goal Sheet: $5,000+ collected between Jul 12, 2026 and Jan 1, 2027. Tracked separately from monthly recurring revenue; both have to hit target." },
  { key: "monthly_recurring_revenue", metricKey: "revenue.mrr", label: "Monthly recurring revenue", measure: "latest", target: 200_000, startDate: "2026-07-12", dueDate: "2027-01-01",
    description: "Growth Goal Sheet: $2,000+ a month in active retainers by Jan 1, 2027. Setup fees and pilots without a retainer do not count." },
  { key: "linkedin_followers", metricKey: "linkedin.followers", label: "LinkedIn followers", measure: "latest", target: 4_000, startDate: "2026-07-12", dueDate: "2027-01-01",
    description: "Growth Goal Sheet: 4,000 LinkedIn followers by Jan 1, 2027. Every LinkedIn account you log is added together." },
  { key: "linkedin_posts_weekly", metricKey: "linkedin.posts_published", label: "LinkedIn posts this week", measure: "weekly", target: 3, startDate: "2026-07-12", dueDate: null,
    description: "LinkedIn post system: 3-4 posts a week. Judge the week, not the single post. Weeks run Monday to Sunday (UTC)." },
];

export function sampleGoalBoard(today: string): GoalBoard {
  const weekStart = formatDay(periodStart("week", parseDay(today)));
  const series = (metricKey: string, grain: MetricGrain, from: string, to: string) =>
    sampleMetricSeries({ metrics: [metricKey], grain, from, to, dimension: null }, SAMPLE_DEFINITIONS, today).series[0] ?? null;
  const goals = SAMPLE_GOALS.flatMap((goal): Goal[] => {
    const item = SAMPLE_DEFINITION_BY_KEY.get(goal.metricKey);
    if (!item) return [];
    const end = goal.dueDate && goal.dueDate < today ? goal.dueDate : today;
    let measured: MetricSeries | null = null;
    let lastWeek: MetricSeries | null = null;
    if (goal.startDate <= today) {
      if (goal.measure === "weekly") {
        measured = series(goal.metricKey, "week", weekStart, today);
        lastWeek = series(goal.metricKey, "week", addDays(weekStart, -7), addDays(weekStart, -1));
      } else {
        // Day grain keeps the range exactly at the start date.
        measured = series(goal.metricKey, "day", goal.startDate, end);
      }
    }
    const recorded = rowsFor(goal.metricKey, item, today)
      .filter((row) => row.date <= end && (goal.measure !== "total" || row.date >= goal.startDate))
      .map((row) => row.date);
    return [{
      key: goal.key, metricKey: goal.metricKey, label: goal.label, description: goal.description, measure: goal.measure,
      unit: item.unit, entryMode: item.entryMode, target: goal.target, startDate: goal.startDate, dueDate: goal.dueDate,
      current: measured?.current ?? null,
      // The previous window ends the day before the goal began.
      baseline: goal.measure === "latest" ? measured?.previous ?? null : null,
      lastWeek: lastWeek?.current ?? null,
      lastRecorded: recorded.length ? recorded.reduce((latest, date) => (date > latest ? date : latest)) : null,
    }];
  });
  return { status: "available", today, weekStart, goals };
}

// ---------------------------------------------------------------------------
// Dashboard: the load_admin_analytics read model, shaped like shapeAdminAnalytics.
// ---------------------------------------------------------------------------

type ExperimentPlan = Omit<OutreachExperiment, "variants"> & {
  variants: Array<{ label: string; title: string; counts: Record<string, number> }>;
};

/** Newest first, like the dashboard. One clear leader, one too close to call, one too small to judge. */
const SAMPLE_EXPERIMENTS: ExperimentPlan[] = [
  {
    id: sampleUuid("experiment", 3), title: "Loom video vs text follow-up", audience: "HVAC business owners", campaign: null,
    channel: "linkedin", method: "manual", messageStep: "follow_up_1", primaryMetric: "booking_rate", status: "active",
    variants: [
      { label: "A", title: "Text follow-up", counts: { f1_sent: 38, attributed_replies: 6, replies: 6, positive_replies: 3, calls_booked: 1 } },
      { label: "B", title: "Loom video", counts: { f1_sent: 41, attributed_replies: 9, replies: 9, positive_replies: 5, calls_booked: 3 } },
      { label: "C", title: "Case-study link", counts: { f1_sent: 35, attributed_replies: 4, replies: 4, positive_replies: 2, calls_booked: 1 } },
    ],
  },
  {
    id: sampleUuid("experiment", 2), title: "No note vs short personal note", audience: "Med spa founders", campaign: "Med spa founders FL",
    channel: "linkedin", method: "dripify", messageStep: "connection_request", primaryMetric: "acceptance_rate", status: "active",
    variants: [
      { label: "A", title: "No note", counts: { connection_requests: 260, connections_accepted: 88, initial_dms: 70, attributed_replies: 9, replies: 9, positive_replies: 3, calls_booked: 1 } },
      { label: "B", title: "Short personal note", counts: { connection_requests: 255, connections_accepted: 97, initial_dms: 80, attributed_replies: 13, replies: 13, positive_replies: 5, calls_booked: 2 } },
    ],
  },
  {
    id: sampleUuid("experiment", 1), title: "Outcome hook vs compliance hook", audience: "Insurance agency owners", campaign: "Q3 founder outreach",
    channel: "linkedin", method: "manual", messageStep: "initial_dm", primaryMetric: "reply_rate", status: "completed",
    variants: [
      { label: "A", title: "Outcome hook", counts: { initial_dms: 420, attributed_replies: 63, replies: 63, positive_replies: 24, calls_booked: 7 } },
      { label: "B", title: "Compliance hook", counts: { initial_dms: 410, attributed_replies: 98, replies: 98, positive_replies: 41, calls_booked: 12 } },
    ],
  },
];

const SAMPLE_CONTENT_DEMAND = [
  { label: "Missed-call text back", value: 17 },
  { label: "Lead follow-up", value: 13 },
  { label: "Appointment reminders", value: 10 },
  { label: "Review requests", value: 8 },
  { label: "Quote follow-up", value: 6 },
  { label: "Intake forms", value: 4 },
];

// Sample data fits on one page, so page numbers from the URL are accepted and ignored.
export function sampleDashboardData(_pages: { experimentPage?: number; batchPage?: number }, now: Date = new Date()): AdminDashboardData {
  const today = now.toISOString().slice(0, 10);
  const outreach = groupRows("outreach", today);
  const ajani = groupRows("ajani", today);
  const rowsOf = (map: RowMap, key: string) => map.get(key) ?? [];
  const total = (rows: SampleRow[], from: string, to: string) => rows.reduce((sum, row) => row.date >= from && row.date <= to ? sum + row.value : sum, 0);
  const currentStart = addDays(today, -29);
  const previousStart = addDays(today, -59);
  const previousEnd = addDays(today, -30);
  const window = (map: RowMap, key: string) => ({ current: total(rowsOf(map, key), currentStart, today), previous: total(rowsOf(map, key), previousStart, previousEnd) });

  const saved = window(ajani, "ajani.drafts_saved");
  const builds = window(ajani, "ajani.builds_submitted");
  const touches = window(outreach, "outreach.touches");
  const replies = window(outreach, "outreach.replies");
  const cohortSubmitted = total(rowsOf(ajani, "ajani.cohort_submitted"), currentStart, today);
  const organizations = total(rowsOf(ajani, "ajani.new_workspaces"), currentStart, today);
  const replyBase = total(rowsOf(outreach, "outreach.reply_base"), currentStart, today);

  const daily = (map: RowMap, key: string) => {
    const byDate = new Map<string, number>();
    rowsOf(map, key).forEach((row) => byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value));
    return byDate;
  };
  const drafts = daily(ajani, "ajani.drafts_saved");
  const submissions = daily(ajani, "ajani.builds_submitted");
  const touchesByDay = daily(outreach, "outreach.touches");
  const repliesByDay = daily(outreach, "outreach.replies");
  const trend = Array.from({ length: 90 }, (_, index) => {
    const date = addDays(today, index - 89);
    return { date, drafts: drafts.get(date) ?? 0, submissions: submissions.get(date) ?? 0, outreach: touchesByDay.get(date) ?? 0, replies: repliesByDay.get(date) ?? 0 };
  });

  const funnelFrom = addDays(today, -179);
  const funnelSaved = total(rowsOf(ajani, "ajani.drafts_saved"), funnelFrom, today);
  const funnel = ([
    ["Brief saved", funnelSaved],
    ["AI processed", total(rowsOf(ajani, "~funnel.processed"), funnelFrom, today)],
    ["Scope approved", total(rowsOf(ajani, "~funnel.approved"), funnelFrom, today)],
    ["Account claimed", total(rowsOf(ajani, "~funnel.claimed"), funnelFrom, today)],
    ["Build submitted", total(rowsOf(ajani, "ajani.cohort_submitted"), funnelFrom, today)],
  ] as const).map(([label, value]) => ({ label, value, rate: percentage(value, funnelSaved) }));

  const allTime = (key: string) => rowsOf(outreach, key).reduce((sum, row) => sum + row.value, 0);
  // Follow-ups split into first and second follow-ups per batch.
  const followUps = rowsOf(outreach, "outreach.follow_ups").reduce((split, row) => {
    const first = Math.round(row.value * 0.62);
    return { f1: split.f1 + first, f2: split.f2 + row.value - first };
  }, { f1: 0, f2: 0 });
  const outreachTotals: OutreachTotals = {
    connectionRequests: allTime("outreach.connection_requests"),
    connectionsAccepted: allTime("outreach.connections_accepted"),
    initialDms: allTime("outreach.initial_dms"),
    f1Sent: followUps.f1,
    f2Sent: followUps.f2,
    customSent: 0,
    replies: allTime("outreach.replies"),
    replyBase: allTime("outreach.reply_base"),
    positiveReplies: allTime("outreach.positive_replies"),
    callsBooked: allTime("outreach.calls_booked"),
    acceptanceRate: null,
    replyRate: null,
  };
  outreachTotals.acceptanceRate = percentage(outreachTotals.connectionsAccepted, outreachTotals.connectionRequests);
  outreachTotals.replyRate = percentage(outreachTotals.replies, outreachTotals.replyBase);

  const experiments: OutreachExperiment[] = SAMPLE_EXPERIMENTS.map((plan) => ({
    ...plan,
    variants: plan.variants.map((variant) => ({ id: sampleUuid("variant", plan.id, variant.label), label: variant.label, title: variant.title })),
  }));
  // The same aggregation the real dashboard runs, over made-up per-variant totals.
  const experimentMetrics = SAMPLE_EXPERIMENTS.flatMap((plan) => plan.variants.map((variant) => ({
    batch_id: plan.id, variant_id: sampleUuid("variant", plan.id, variant.label), variant_label: variant.label, ...variant.counts,
  })));
  const experimentPerformance = aggregateExperimentPerformance(experiments, experiments.map((item) => ({ id: item.id, experiment_id: item.id })), experimentMetrics);

  const recentBatches: RecentBatch[] = rowsOf(outreach, "outreach.touches")
    .filter((row) => row.date >= addDays(today, -6))
    .sort((left, right) => right.date.localeCompare(left.date) || left.dimension.localeCompare(right.dimension))
    .slice(0, 12)
    .map((row) => {
      const channel = OUTREACH_CHANNELS.find((item) => item.dimension === row.dimension) ?? OUTREACH_CHANNELS[0];
      const valueOn = (key: string) => rowsOf(outreach, key).find((item) => item.date === row.date && item.dimension === row.dimension)?.value ?? 0;
      return {
        id: sampleUuid("batch", row.date, row.dimension),
        date: row.date,
        teamMember: channel.team[Math.floor(rand("outreach.team", row.date, row.dimension) * channel.team.length)],
        context: [titleCase(channel.channel), titleCase(channel.method), channel.audience].join(" / "),
        sent: row.value,
        replies: valueOn("outreach.replies"),
        calls: valueOn("outreach.calls_booked"),
      };
    });

  const processed = funnel[1].value;
  const buildsRecent = total(rowsOf(ajani, "ajani.builds_submitted"), funnelFrom, today);
  const operations = [
    { label: "AI workflow", healthy: processed, attention: 2, detail: `${processed + 2} recorded jobs` },
    { label: "Transcription", healthy: Math.round(processed * 0.4), attention: 0, detail: `${Math.round(processed * 0.4)} recorded jobs` },
    { label: "Internal notification", healthy: buildsRecent, attention: 0, detail: `${buildsRecent} recorded jobs` },
    { label: "Live systems", healthy: 4, attention: 1, detail: "5 provisioned systems" },
  ];

  return {
    generatedAt: now.toISOString(),
    dataConnected: true,
    dataStatus: "available",
    dataNotice: null,
    coverageStartedAt: `${sampleHistoryStart(today)}T00:00:00.000Z`,
    pagination: { experimentPage: 0, batchPage: 0, experimentCount: experiments.length, batchCount: recentBatches.length },
    outreachSchemaReady: true,
    metrics: [
      metricCard("Saved drafts", formatNumber(saved.current), `${organizations} new business accounts in the last 30 days, by UTC date`, growth(saved.current, saved.previous), "neutral"),
      metricCard("Submitted builds", formatNumber(builds.current), saved.current ? `${(percentage(cohortSubmitted, saved.current) ?? 0).toFixed(1)}% of drafts saved in the last 30 days became builds` : "No drafts saved in the last 30 days", growth(builds.current, builds.previous), "brand"),
      metricCard("Outreach touches", formatNumber(touches.current), "From outreach batches you log", growth(touches.current, touches.previous), "brand"),
      metricCard("Replies", formatNumber(replies.current), rateLabel(replies.current, replyBase, "reply rate"), growth(replies.current, replies.previous), "success"),
    ],
    trend,
    funnel,
    outreach: outreachTotals,
    experiments,
    experimentPerformance,
    operations,
    recentBatches,
    contentDemand: SAMPLE_CONTENT_DEMAND.map((item) => ({ ...item })),
  };
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

function metricCard(label: string, value: string, detail: string, delta: number | null, tone: AdminMetric["tone"]): AdminMetric {
  return { label, value, detail, delta, tone };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
