import type { MetricDefinition } from "@/lib/admin/metric-types";

/**
 * Reads spreadsheets without AI: day-by-day tables, files that mix platforms
 * (a platform column, or a heading per platform) and "long" files (date,
 * metric, value). Every row's numbers go to that row's own platform, and a
 * number only another platform has is never put on it.
 *
 * What the reader can't settle on its own it hands on instead of guessing:
 * a column that could mean one of a few numbers becomes a question with its
 * cells attached, and a list with one row per call, post or payment becomes a
 * log. The AI agent or the owner answers; code copies or counts the exact
 * numbers. Values come back in the units people type: counts, hours, dollars.
 */
export type TableValue = { metricKey: string; date: string; value: number; evidence: string };
export type TableNote = { item: string; reason: string };
export type TableCell = { date: string; value: number; evidence: string };
export type TableQuestion = {
  id: string;
  group: string;
  /** The rows' platform or log, when the file says. */
  source: string | null;
  header: string;
  /** "meaning": a known header with a few possible meanings. "open": a number column the reader doesn't recognise. */
  kind: "meaning" | "open";
  candidates: string[];
  reason: string;
  cells: TableCell[];
};
export type TableCheck = { ok: boolean; text: string };
export type TableGroup = {
  id: string;
  source: string | null;
  label: string;
  decidedBy: "platform column" | "heading" | "file name" | "columns" | "you" | null;
  rows: number;
  timeZone: string | null;
  from: string | null;
  to: string | null;
  /** Metrics read with certainty, and the column each came from. */
  read: Array<{ metricKey: string; header: string; days: number }>;
  /** Metrics this group's rows leave blank (a blank cell is unknown, never zero). */
  blank: string[];
  checks: TableCheck[];
};
export type LogColumn = { id: string; header: string; numeric: boolean; values: Array<{ value: string; count: number }> | null };
/** A list with one row per call, post, deal or payment. Code counts it once the AI agent says what counts. */
export type TableLog = {
  id: string;
  group: string;
  source: string | null;
  label: string;
  rows: number;
  from: string;
  to: string;
  columns: LogColumn[];
  /** Each row's date and cells by column id, people's details left out. Stays on the server. */
  data: Array<{ date: string; rawDate: string; cells: Record<string, string> }>;
};
export type CountRule = { metricKey: string; columnId: string | null; equals: string[]; amountColumnId: string | null };
export type TableRead = {
  values: TableValue[];
  notUsed: TableNote[];
  /** Headers whose meaning is still open. */
  unresolved: string[];
  questions: TableQuestion[];
  groups: TableGroup[];
  logs: TableLog[];
  /** The file names people or has their contact details: its text never goes to the AI, and those columns never leave the reader. */
  people: boolean;
  note: string;
};
export type ReadOptions = { platform?: string | null };

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

/** Platforms whose numbers belong only to their own rows. TikTok is retired but still recognised. */
const PLATFORMS = new Set(["instagram", "youtube", "linkedin", "reddit", "tiktok", "facebook", "x", "threads"]);
/** What a platform column may call each source, after qualifier words are dropped. */
const ROW_LABELS: Record<string, string[]> = {
  instagram: ["instagram", "ig", "insta"],
  youtube: ["youtube", "yt"],
  linkedin: ["linkedin", "li", "linked_in"],
  reddit: ["reddit"],
  tiktok: ["tiktok", "tik_tok"],
  cold_calls: ["cold_calls", "cold_call", "cold_calling", "calls", "phone"],
  dripify: ["dripify"],
  facebook: ["facebook", "fb"],
  x: ["x", "twitter"],
  threads: ["threads"],
};
/** Names in a file name or a heading. Stricter: "x", "li" or "calls" there mean nothing. */
const TITLE_LABELS: Record<string, string[]> = {
  instagram: ["instagram", "ig", "insta"],
  youtube: ["youtube", "yt"],
  linkedin: ["linkedin"],
  reddit: ["reddit"],
  tiktok: ["tiktok"],
  cold_calls: ["cold_calls", "cold_call", "cold_calling"],
  dripify: ["dripify"],
  facebook: ["facebook"],
  x: ["twitter"],
};
const SOURCE_NAMES: Record<string, string> = {
  instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", reddit: "Reddit", tiktok: "TikTok", facebook: "Facebook",
  x: "X", threads: "Threads", cold_calls: "Cold calls", sales: "Sales", revenue: "Revenue", dripify: "Dripify",
};
const UNTRACKED_REASONS: Record<string, string> = {
  dripify: "Dripify numbers come from its nightly sync, not from files",
};
const QUALIFIERS = new Set(["page", "profile", "account", "business", "creator", "company", "personal", "official", "main"]);
const TOTAL_WORDS = new Set(["total", "totals", "all", "combined", "overall", "sum", "grand_total", "all_platforms"]);
const ENTITY_HEADERS = ["platform", "platform_name", "network", "social_network", "social_platform", "social_media"];
/** Only a platform column when every value names a source. */
const WEAK_ENTITY_HEADERS = ["channel", "source", "app", "site", "medium"];
const TIME_ZONE_HEADER = /(^|_)(time_?zone|timezone|tz)$/;
/** A column saying who or which session a row is, so a log's rows on one day add up. */
const PART_HEADERS = ["caller", "rep", "agent", "setter", "sdr", "closer", "salesperson", "team_member", "member", "session", "shift", "block"];
const PERSONAL_HEADERS = new Set([
  "name", "first_name", "last_name", "full_name", "contact", "contact_name", "lead", "lead_name", "prospect", "prospect_name",
  "client_name", "customer_name", "email", "e_mail", "email_address", "work_email", "phone", "phone_number", "mobile", "cell",
  "telephone", "linkedin_url", "linkedin_profile", "profile_url", "profile_link", "address", "street_address",
]);
const WINDOW_HEADERS = ["window", "period", "range", "timeframe", "time_period", "date_range"];
const METRIC_NAME_HEADERS = ["metric", "metric_name", "measure", "kpi", "field", "stat", "statistic"];
const VALUE_HEADERS = ["value", "count", "amount", "number", "total", "qty"];
const CONTACT_TAPS = ["contact_taps", "contact_button_taps"];
const BLANK = new Set(["", "-", "—", "–", "n/a", "na", "null", "none", "blank"]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Log columns with more distinct text than this are notes or names, not categories. */
const MAX_CATEGORIES = 12;

/** Header names people and exports use, beyond each metric's key and label. */
const EXTRA_ALIASES: Record<string, string[]> = {
  "instagram.reach": ["accounts_reached"],
  "instagram.interactions": ["content_interactions", "total_interactions"],
  "instagram.profile_link_taps": ["link_taps", "external_link_taps", "website_taps", "link_clicks"],
  "instagram.posts_published": ["posts", "posts_and_reels"],
  "youtube.videos_published": ["videos", "uploads"],
  "youtube.watch_hours": ["watch_time_hours", "watch_time"],
  "linkedin.posts_published": ["posts"],
  "linkedin.impressions": ["post_impressions"],
  "reddit.posts_published": ["posts"],
  "reddit.dms_sent": ["dms"],
  "cold_calls.dials": ["dials", "cold_calls", "calls_made", "cold_calls_made"],
  "cold_calls.positive_replies": ["positive", "positive_replies", "interested"],
  "cold_calls.neutral_replies": ["neutral", "neutral_replies"],
  "cold_calls.negative_replies": ["negative", "negative_replies", "not_interested"],
  "cold_calls.follow_ups": ["follow_ups", "followups", "follow_up", "callbacks", "call_backs"],
  "cold_calls.meetings_booked": ["meetings_booked", "meetings_set", "appointments_set"],
  "sales.deals_won": ["clients_signed", "deals_won", "new_clients", "clients_won"],
  "sales.calls_held": ["sales_calls", "calls_held", "sales_calls_held"],
  "sales.proposals_sent": ["proposals"],
  "sales.content_leads": ["leads_from_content", "content_leads"],
  "revenue.cash_collected": ["cash_collected", "cash", "revenue_collected"],
  "revenue.mrr": ["mrr", "monthly_recurring_revenue"],
};

/**
 * A running total ("last") is only matched by headers that clearly mean the
 * total. YouTube Studio's daily "Subscribers" column is the day's net change,
 * so the bare word never maps to the subscriber total.
 */
const TOTAL_ONLY_ALIASES: Record<string, string[]> = {
  "youtube.subscribers": ["total_subscribers", "subscribers_total", "subscriber_count"],
};

type Meaning = { key: string } | { ask: string[]; reason: string } | { skip: string };
/**
 * What a header means on one platform when it differs from the plain match.
 * LinkedIn names its daily post number "impressions" and its interactions
 * "engagements"; other words are left for the AI agent or the owner.
 */
const PLATFORM_MEANINGS: Record<string, Record<string, Meaning>> = {
  linkedin: {
    impressions: { key: "linkedin.impressions" },
    engagements: { key: "linkedin.engagements" },
    views: { ask: ["linkedin.impressions"], reason: "LinkedIn calls a post's daily views impressions. \"Views\" usually means the same, but some exports use it for video or profile views." },
    post_views: { ask: ["linkedin.impressions"], reason: "LinkedIn calls a post's daily views impressions. \"Views\" usually means the same, but some exports use it for video or profile views." },
    interactions: { ask: ["linkedin.engagements"], reason: "Not LinkedIn's own word. It usually means engagements (reactions, comments, reposts, sends and saves), but some tools add clicks." },
    likes: { ask: ["linkedin.reactions"], reason: "A like is one of LinkedIn's several reactions." },
    total_followers: { ask: ["linkedin.followers"], reason: "Usually the follower total, but some exports use the name for that day's new followers." },
    members_reached: { skip: "LinkedIn's members reached isn't tracked on these charts" },
    unique_views: { skip: "Unique views aren't tracked on these charts" },
    reposts: { skip: "Reposts count inside engagements, not on their own" },
    clicks: { skip: "Clicks aren't tracked on these charts" },
  },
  instagram: {
    impressions: { skip: "Instagram replaced impressions with views in 2025, and they're counted differently" },
  },
  youtube: {
    subscribers: { skip: "YouTube's daily \"Subscribers\" is that day's net change, not the total" },
  },
};

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function sourceName(source: string | null) {
  return source === null ? "Rows without a platform" : SOURCE_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/** Sources a file name or heading names, as whole words. */
function sourcesIn(text: string, labels: Record<string, string[]>) {
  const words = `_${normalizeHeader(text)}_`;
  return Object.entries(labels).filter(([, names]) => names.some((name) => words.includes(`_${name}_`))).map(([source]) => source);
}

type RowLabel = { kind: "source"; source: string } | { kind: "total" } | { kind: "blank" } | { kind: "unknown" };

/** What a platform cell names: "LinkedIn Page" → linkedin, "IG" → instagram, "Total" → a total row. */
function rowLabel(raw: string): RowLabel {
  const name = normalizeHeader(raw);
  if (!name) return { kind: "blank" };
  if (TOTAL_WORDS.has(name)) return { kind: "total" };
  const words = name.split("_").filter((word) => !QUALIFIERS.has(word));
  for (const candidate of new Set([words.join("_"), words.join("")])) {
    for (const [source, labels] of Object.entries(ROW_LABELS)) if (labels.includes(candidate)) return { kind: "source", source };
  }
  return { kind: "unknown" };
}

/** A day's change in a running total ("new_followers", "followers_gained"), never the total itself. */
function isChangeHeader(name: string) {
  return /^(new|net)_/.test(name) || /_(gained|lost|gain|loss|change|growth|delta|added)$/.test(name) || name === "follows" || name === "unfollows";
}

/** Rates, percentages and averages: the charts work them out from their parts. */
function isRateHeader(name: string, cells: string[]) {
  return /(^|_)(rate|ratio|percent|percentage|pct|ctr|avg|average|mean|median)(_|$)/.test(name) || cells.some((cell) => cell.trim().endsWith("%"));
}

function aliasesFor(metric: MetricDefinition) {
  const total = TOTAL_ONLY_ALIASES[metric.key];
  if (total) return total;
  const suffix = metric.key.slice(metric.key.indexOf(".") + 1);
  const label = normalizeHeader(metric.label).replace(new RegExp(`^${metric.source}_`), "");
  return [...new Set([suffix, label, ...(EXTRA_ALIASES[metric.key] ?? [])])];
}

type Catalog = {
  /** Prefixed headers ("instagram_reach", "ig_reach") → key. */
  exact: Map<string, string>;
  /** Bare headers ("reach", "followers") → every key they could mean. */
  loose: Map<string, string[]>;
  byKey: Map<string, MetricDefinition>;
  /** Sources with at least one importable number. */
  sources: Set<string>;
};

function buildCatalog(metrics: MetricDefinition[]): Catalog {
  const exact = new Map<string, string>();
  const loose = new Map<string, string[]>();
  for (const metric of metrics) {
    for (const alias of aliasesFor(metric)) {
      exact.set(`${metric.source}_${alias}`, metric.key);
      for (const word of TITLE_LABELS[metric.source] ?? []) exact.set(`${word}_${alias}`, metric.key);
      loose.set(alias, [...new Set([...(loose.get(alias) ?? []), metric.key])]);
    }
  }
  return { exact, loose, byKey: new Map(metrics.map((metric) => [metric.key, metric])), sources: new Set(metrics.map((metric) => metric.source)) };
}

function sourceOf(key: string) {
  return key.slice(0, key.indexOf("."));
}

type Resolved =
  | { kind: "key"; key: string }
  | { kind: "ask"; candidates: string[]; reason: string; open: boolean }
  | { kind: "skip"; reason: string };

/** What one header means on one source's rows. A platform's rows only ever fill that platform's numbers. */
function resolveHeader(name: string, source: string | null, catalog: Catalog): Resolved {
  const known = (keys: string[]) => keys.filter((key) => catalog.byKey.has(key));
  const exactKey = catalog.exact.get(name);
  if (exactKey) {
    const keySource = sourceOf(exactKey);
    if (!PLATFORMS.has(keySource) || source === null || keySource === source) return { kind: "key", key: exactKey };
    return { kind: "skip", reason: `Named for ${sourceName(keySource)}, but these are ${sourceName(source)} rows` };
  }
  const special = source ? PLATFORM_MEANINGS[source]?.[name] : undefined;
  if (special) {
    if ("skip" in special) return { kind: "skip", reason: special.skip };
    if ("key" in special) return catalog.byKey.has(special.key) ? { kind: "key", key: special.key } : { kind: "skip", reason: "Not a number these charts track" };
    const candidates = known(special.ask);
    return candidates.length ? { kind: "ask", candidates, reason: special.reason, open: false } : { kind: "skip", reason: "Not a number these charts track" };
  }
  const candidates = catalog.loose.get(name) ?? [];
  const business = candidates.filter((key) => !PLATFORMS.has(sourceOf(key)));
  if (source !== null) {
    const pool = [...candidates.filter((key) => sourceOf(key) === source), ...business.filter((key) => sourceOf(key) !== source)];
    if (pool.length === 1) return { kind: "key", key: pool[0] };
    if (pool.length > 1) return { kind: "ask", candidates: pool, reason: `"${name}" could mean more than one number for ${sourceName(source)}.`, open: false };
    if (candidates.length) return { kind: "skip", reason: `${sourceName(source)} has no number like this on the charts` };
    return { kind: "skip", reason: "Not a number these charts track" };
  }
  if (business.length === 1 && candidates.length === 1) return { kind: "key", key: business[0] };
  if (candidates.length) return { kind: "ask", candidates, reason: "The file doesn't say which platform these rows are for.", open: false };
  return { kind: "skip", reason: "Not a number these charts track" };
}

// ---------------------------------------------------------------------------
// Cells.
// ---------------------------------------------------------------------------

/** Rows of cells from CSV, TSV or Markdown table text. */
export function parseTable(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length >= 2) {
    return lines.flatMap((line) => {
      if (!/^\s*\|.*\|\s*$/.test(line)) return [[line.trim()]];
      const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
      return cells.every((cell) => /^:?-{2,}:?$/.test(cell)) ? [] : [cells];
    });
  }
  const sample = lines.filter((line) => line.trim()).slice(0, 8).join("\n");
  const delimiter = [",", "\t", ";"].map((mark) => ({ mark, count: sample.split(mark).length })).sort((a, b) => b.count - a.count)[0].mark;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { cell += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"" && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

type DateOrder = "mdy" | "dmy" | null;

/** YYYY-MM-DD from ISO dates, month names, or slashed dates whose order the column settles. */
export function parseDate(raw: string, order: DateOrder): string | null {
  const value = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const pad = (number: number) => String(number).padStart(2, "0");
  const build = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
  };
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/.exec(value);
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(?:[a-z]+ )?([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/.exec(value);
  if (match && MONTHS.includes(match[1])) return build(Number(match[3]), MONTHS.indexOf(match[1]) + 1, Number(match[2]));
  match = /^(?:[a-z]+ )?(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/.exec(value);
  if (match && MONTHS.includes(match[2])) return build(Number(match[3]), MONTHS.indexOf(match[2]) + 1, Number(match[1]));
  match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  if (match && order) return order === "mdy" ? build(Number(match[3]), Number(match[1]), Number(match[2])) : build(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

/** Whether slashed dates in a column are month-first or day-first, when any of them shows it. */
export function dateOrder(cells: string[]): DateOrder {
  let order: DateOrder = null;
  for (const cell of cells) {
    const match = /^(\d{1,2})[/.](\d{1,2})[/.]\d{4}$/.exec(cell.trim());
    if (!match) continue;
    if (Number(match[1]) > 12) order = "dmy";
    else if (Number(match[2]) > 12) order = "mdy";
  }
  return order;
}

/** A number as written in a sheet: "2,219", "$1,250.50", " 73 ". Blank means unknown. */
export function parseNumber(raw: string): number | null | "blank" {
  const value = raw.trim().toLowerCase();
  if (BLANK.has(value)) return "blank";
  const plain = value.replace(/^\$/, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(plain)) return Number(plain.replace(/,/g, ""));
  if (/^-?\d+(\.\d+)?$/.test(plain)) return Number(plain);
  return null;
}

function isBlank(raw: string | undefined) {
  return raw === undefined || BLANK.has(raw.trim().toLowerCase());
}

/** Text that is someone's contact details or a long note: never shown to the AI or in evidence. */
function looksPersonal(raw: string) {
  return /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(raw) || /linkedin\.com\/in\//i.test(raw) || /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/.test(raw);
}

function headerRoles(names: string[]) {
  return {
    dateIndex: names.findIndex((name) => (name === "date" || name === "day" || name.startsWith("date_")) && !WINDOW_HEADERS.includes(name)),
    windowIndex: names.findIndex((name) => WINDOW_HEADERS.includes(name)),
    metricIndex: names.findIndex((name) => METRIC_NAME_HEADERS.includes(name)),
    valueIndex: names.findIndex((name) => VALUE_HEADERS.includes(name)),
  };
}

function isHeaderRow(row: string[]) {
  const names = row.map(normalizeHeader);
  const roles = headerRoles(names);
  return (roles.dateIndex >= 0 || roles.windowIndex >= 0) && names.filter(Boolean).length >= 2;
}

/** A one-cell row naming exactly one source: a section heading such as "LinkedIn". */
function headingOf(row: string[]) {
  const filled = row.filter((cell) => cell.trim());
  if (filled.length !== 1 || /\d/.test(filled[0])) return null;
  const sources = sourcesIn(filled[0], TITLE_LABELS);
  return sources.length === 1 ? sources[0] : null;
}

/** A header row names people (a name, email or phone column), or a cell holds contact details. */
function hasPersonalData(rows: string[][]) {
  return rows.some((row, index) => (index === 0 || isHeaderRow(row)) && row.some((cell) => PERSONAL_HEADERS.has(normalizeHeader(cell))))
    || rows.some((row) => row.some(looksPersonal));
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

type RowRecord = { date: string; rawDate: string; part: string | null; partIsTotal: boolean; timeZone: string | null; cells: Map<string, string> };
type ColumnSpec = { key: string; header: string; name: string };
type GroupBuilder = TableGroup & { dates: Set<string>; zones: Set<string> };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Finds every daily table (a header row with a date column), every long table
 * (date, metric, value) and every totals table, and reads them. Returns null
 * when the text has no table and names no one, so the AI agent reads it.
 */
export function readDailyTable(text: string, fileName: string, metrics: MetricDefinition[], options: ReadOptions = {}): TableRead | null {
  const rows = parseTable(text);
  const catalog = buildCatalog(metrics);
  const people = hasPersonalData(rows);
  const fileSources = sourcesIn(fileName, TITLE_LABELS);
  const fileSource = fileSources.length === 1 ? fileSources[0] : null;
  const hint = options.platform && Object.hasOwn(SOURCE_NAMES, options.platform) ? options.platform : null;
  const values: TableValue[] = [];
  const notUsed: TableNote[] = [];
  const questions: TableQuestion[] = [];
  const logs: TableLog[] = [];
  const groups = new Map<string, GroupBuilder>();
  let tables = 0;
  let totalsTables = 0;
  let previousEnd = 0;

  const groupFor = (source: string | null, decidedBy: TableGroup["decidedBy"]): GroupBuilder => {
    const id = source ?? "unnamed";
    let group = groups.get(id);
    if (!group) {
      group = { id, source, label: sourceName(source), decidedBy, rows: 0, timeZone: null, from: null, to: null, read: [], blank: [], checks: [], dates: new Set(), zones: new Set() };
      groups.set(id, group);
    }
    return group;
  };

  for (let start = 0; start < rows.length; start += 1) {
    if (!isHeaderRow(rows[start])) continue;
    const header = rows[start];
    const names = header.map(normalizeHeader);
    const roles = headerRoles(names);
    let end = start + 1;
    while (end < rows.length && rows[end].some((cell) => cell.trim()) && !isHeaderRow(rows[end]) && !headingOf(rows[end])) end += 1;
    const body = rows.slice(start + 1, end);
    const titleRows = rows.slice(Math.max(previousEnd, start - 3), start);
    const titleSources = [...new Set(titleRows.flatMap((row) => sourcesIn(row.join(" "), TITLE_LABELS)))];
    const heading = titleSources.length === 1 ? titleSources[0] : null;
    previousEnd = end;
    start = end - 1;

    if (roles.dateIndex < 0) {
      totalsTables += 1;
      for (const row of body) {
        const window = row[roles.windowIndex]?.trim();
        if (window) notUsed.push({ item: `Totals for ${window}`, reason: "A total for a whole period; it can't be split into days" });
      }
      continue;
    }
    tables += 1;

    // Column roles: labels never count as numbers, people's details are never read.
    const entityIndex = (() => {
      const strong = names.findIndex((name) => ENTITY_HEADERS.includes(name));
      if (strong >= 0) return strong;
      return names.findIndex((name, index) => WEAK_ENTITY_HEADERS.includes(name)
        && body.some((row) => !isBlank(row[index]))
        && body.every((row) => isBlank(row[index]) || rowLabel(row[index]).kind === "source" || rowLabel(row[index]).kind === "total"));
    })();
    const zoneIndex = names.findIndex((name) => TIME_ZONE_HEADER.test(name));
    const partIndex = names.findIndex((name) => PART_HEADERS.includes(name));
    const long = roles.metricIndex >= 0 && roles.valueIndex >= 0;
    const ignored = new Set([roles.dateIndex, roles.windowIndex, entityIndex, zoneIndex, partIndex].filter((index) => index >= 0));
    names.forEach((name, index) => {
      if (!name || PERSONAL_HEADERS.has(name) || /(^|_)(id|url|link|notes?)$/.test(name) || body.some((row) => looksPersonal(row[index] ?? ""))) ignored.add(index);
    });
    const columns: ColumnSpec[] = long ? [] : names.flatMap((name, index) => ignored.has(index) ? [] : [{ key: `${tables}:c${index}`, header: header[index], name }]);
    const order = dateOrder(body.map((row) => row[roles.dateIndex] ?? ""));

    // Rows by group: the row's platform cell first, then a heading, the file name, or the owner's answer.
    const blockGroups = new Map<string, { group: GroupBuilder; records: RowRecord[] }>();
    const leftOut = new Map<string, { item: string; reason: string; rows: number }>();
    const skipRows = (item: string, reason: string) => {
      const entry = leftOut.get(item) ?? { item, reason, rows: 0 };
      entry.rows += 1;
      leftOut.set(item, entry);
    };
    for (const row of body) {
      const rawDate = row[roles.dateIndex] ?? "";
      const date = parseDate(rawDate, order);
      if (!date) {
        if (/total|sum|average|avg/i.test(rawDate)) notUsed.push({ item: `Row "${rawDate}"`, reason: "A total or average row, not a day" });
        else if (rawDate.trim()) notUsed.push({ item: `Row "${rawDate}"`, reason: "The date could not be read" });
        continue;
      }
      let source: string | null = null;
      let decidedBy: TableGroup["decidedBy"] = null;
      if (entityIndex >= 0) {
        const label = rowLabel(row[entityIndex] ?? "");
        if (label.kind === "total") { skipRows(`Rows for "${row[entityIndex].trim()}"`, "A total of the other rows, not a platform"); continue; }
        if (label.kind === "unknown") { skipRows(`Rows for "${row[entityIndex].trim()}"`, "Not a platform or log these charts track"); continue; }
        if (label.kind === "source") { source = label.source; decidedBy = "platform column"; }
      }
      if (!source) {
        source = heading ?? fileSource ?? hint;
        decidedBy = heading ? "heading" : fileSource ? "file name" : hint ? "you" : null;
      }
      if (source && !catalog.sources.has(source)) {
        skipRows(`${sourceName(source)} rows`, UNTRACKED_REASONS[source] ?? `${sourceName(source)} isn't tracked on these charts`);
        continue;
      }
      const cells = new Map<string, string>();
      if (long) {
        const metricName = row[roles.metricIndex]?.trim() ?? "";
        if (metricName) cells.set(`${tables}:m:${normalizeHeader(metricName)}`, row[roles.valueIndex] ?? "");
      } else {
        for (const column of columns) cells.set(column.key, row[Number(column.key.slice(column.key.indexOf(":c") + 2))] ?? "");
      }
      const part = partIndex >= 0 ? row[partIndex]?.trim() || null : null;
      const record: RowRecord = {
        date, rawDate: rawDate.trim(), part, partIsTotal: part !== null && TOTAL_WORDS.has(normalizeHeader(part)),
        timeZone: zoneIndex >= 0 ? row[zoneIndex]?.trim() || null : null, cells,
      };
      const id = source ?? "unnamed";
      const entry = blockGroups.get(id) ?? { group: groupFor(source, decidedBy), records: [] };
      entry.records.push(record);
      blockGroups.set(id, entry);
    }
    for (const entry of leftOut.values()) notUsed.push({ item: `${entry.item} (${plural(entry.rows, "row")})`, reason: entry.reason });

    const longColumns = (records: RowRecord[]): ColumnSpec[] => {
      const seen = new Map<string, ColumnSpec>();
      for (const record of records) {
        for (const key of record.cells.keys()) {
          if (seen.has(key)) continue;
          const name = key.slice(key.indexOf(":m:") + 3);
          const raw = body.find((row) => `${tables}:m:${normalizeHeader(row[roles.metricIndex] ?? "")}` === key)?.[roles.metricIndex] ?? name;
          seen.set(key, { key, header: raw.trim(), name });
        }
      }
      return [...seen.values()];
    };

    for (const { group, records } of blockGroups.values()) {
      readGroup({
        group, records, columns: long ? longColumns(records) : columns, long, partIndex, catalog, values, notUsed, questions, logs,
        multiGroup: blockGroups.size > 1 || groups.size > 1, tableIndex: tables,
      });
    }
  }

  if (!tables && !totalsTables) {
    if (!people) return null;
    return {
      values: [], notUsed: [], unresolved: [], questions: [], groups: [], logs: [], people,
      note: "This looks like a list of people (names or contact details), not daily totals, so nothing was read and it wasn't sent to the AI.",
    };
  }

  const finished: TableGroup[] = [...groups.values()].map(({ dates, zones, ...group }) => {
    const sorted = [...dates].sort();
    return { ...group, from: sorted[0] ?? null, to: sorted[sorted.length - 1] ?? null, timeZone: zones.size === 1 ? [...zones][0] : zones.size > 1 ? [...zones].join(", ") : null };
  });
  const unresolved = [...new Set(questions.map((question) => question.header))];
  // Day by day, each day in column order (the sort is stable).
  values.sort((a, b) => a.date.localeCompare(b.date));
  return { values, notUsed: notUsed.slice(0, 60), unresolved, questions, groups: finished, logs, people, note: readNote(values, finished, questions, logs, totalsTables, tables) };
}

type GroupContext = {
  group: GroupBuilder;
  records: RowRecord[];
  columns: ColumnSpec[];
  long: boolean;
  partIndex: number;
  catalog: Catalog;
  values: TableValue[];
  notUsed: TableNote[];
  questions: TableQuestion[];
  logs: TableLog[];
  multiGroup: boolean;
  tableIndex: number;
};

/** Reads one platform's (or log's) rows from one table. */
function readGroup(context: GroupContext) {
  const { group, records, columns, long, partIndex, catalog, values, notUsed, questions, logs, multiGroup } = context;
  const tag = (item: string) => multiGroup ? `${item} (${group.label})` : item;
  group.rows += records.length;
  for (const record of records) {
    group.dates.add(record.date);
    if (record.timeZone) group.zones.add(record.timeZone);
  }

  // A day listed twice without a column saying who each row is: the rows are posts, calls or payments,
  // or the table mixes sources. Identical rows collapse; anything else is never read as daily numbers.
  if (!long && partIndex < 0) {
    const byDate = new Map<string, RowRecord[]>();
    for (const record of records) byDate.set(record.date, [...(byDate.get(record.date) ?? []), record]);
    const signature = (record: RowRecord) => JSON.stringify(columns.map((column) => record.cells.get(column.key)?.trim() ?? ""));
    const repeats = [...byDate.values()].filter((list) => new Set(list.map(signature)).size > 1);
    if (repeats.length) {
      const log = buildLog(context, records);
      if (log) logs.push(log);
      notUsed.push({
        item: tag(`${plural(records.length, "row")} over ${plural(byDate.size, "day")}`),
        reason: group.source === null
          ? "Some days appear more than once and nothing says which platform each row is for, so these rows weren't read as daily numbers"
          : "Some days appear more than once (one row per call, post or payment, not per day), so they weren't read as daily numbers",
      });
      return;
    }
    const seen = new Set<string>();
    context.records = records.filter((record) => {
      const key = `${record.date}|${signature(record)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const rows = context.records;

  // Nothing in the file names these rows' platform: columns only one platform has decide it,
  // but only for a single series (one row per day).
  if (group.source === null) {
    const platforms = new Set<string>();
    const deciding: string[] = [];
    for (const column of columns) {
      if (!rows.some((record) => typeof parseNumber(record.cells.get(column.key) ?? "") === "number")) continue;
      const candidates = catalog.loose.get(column.name) ?? [];
      const sources = new Set(candidates.map(sourceOf));
      if (candidates.length && sources.size === 1 && PLATFORMS.has([...sources][0])) {
        platforms.add([...sources][0]);
        deciding.push(column.header);
      }
    }
    if (platforms.size === 1 && !long) {
      const source = [...platforms][0];
      group.source = source;
      group.label = sourceName(source);
      group.decidedBy = "columns";
      group.checks.push({ ok: true, text: `Read as ${sourceName(source)}: ${listWords(deciding.slice(0, 3).map((header) => `"${header}"`))} ${deciding.length === 1 ? "is a number" : "are numbers"} only ${sourceName(source)} has. If that's wrong, untick these rows.` });
    }
  }
  const source = group.source;

  type Day = { value: number; evidence: string };
  const evidenceFor = (record: RowRecord, header: string) => long
    ? `${group.decidedBy === "platform column" ? `${group.label} row` : "Row"} ${record.rawDate}, "${header}"`
    : `${group.decidedBy === "platform column" ? `${group.label} row` : "Row"} ${record.rawDate}, column "${header}"`;
  /** One number per day from a column's cells; rows that disagree on a day leave it out. */
  const daily = (column: ColumnSpec, summable: boolean) => {
    const byDate = new Map<string, RowRecord[]>();
    for (const record of rows) {
      const raw = record.cells.get(column.key);
      if (isBlank(raw)) continue;
      byDate.set(record.date, [...(byDate.get(record.date) ?? []), record]);
    }
    const days = new Map<string, Day>();
    const conflicts: string[] = [];
    const notNumbers: Array<{ date: string; raw: string }> = [];
    const checks: TableCheck[] = [];
    for (const [date, list] of byDate) {
      const numbers = list.map((record) => ({ record, value: parseNumber(record.cells.get(column.key) ?? "") }));
      const bad = numbers.find((item) => item.value === null);
      if (bad) { notNumbers.push({ date, raw: bad.record.cells.get(column.key) ?? "" }); continue; }
      const items = numbers.filter((item): item is { record: RowRecord; value: number } => typeof item.value === "number");
      if (summable && items.some((item) => item.record.part !== null)) {
        const parts = items.filter((item) => !item.record.partIsTotal);
        const totals = items.filter((item) => item.record.partIsTotal);
        const sum = parts.reduce((total, item) => total + item.value, 0);
        if (parts.length) {
          days.set(date, { value: Math.round(sum * 100) / 100, evidence: `${plural(parts.length, "row")} for ${list[0].rawDate} added up, column "${column.header}"` });
          for (const total of totals) {
            if (Math.abs(total.value - sum) > 1e-9) checks.push({ ok: false, text: `${list[0].rawDate}: the "${total.record.part}" row says ${total.value} for "${column.header}", but the rows add up to ${sum}. The rows were used.` });
          }
        } else if (totals.length === 1) {
          days.set(date, { value: totals[0].value, evidence: evidenceFor(totals[0].record, column.header) });
        }
        continue;
      }
      const distinct = new Set(items.map((item) => item.value));
      if (distinct.size === 1) days.set(date, { value: items[0].value, evidence: evidenceFor(items[0].record, column.header) });
      else conflicts.push(date);
    }
    return { days, conflicts, notNumbers, checks };
  };
  /** Days a column gives two different numbers for: one day is left out; two or more and the column isn't used at all. */
  const settle = (column: ColumnSpec, label: string, result: ReturnType<typeof daily>) => {
    for (const item of result.notNumbers) notUsed.push({ item: tag(`${label} on ${item.date}`), reason: `"${item.raw}" is not a number` });
    group.checks.push(...result.checks);
    if (result.conflicts.length >= 2) {
      notUsed.push({ item: tag(`Column "${column.header}"`), reason: `It gives two different numbers for the same day on ${result.conflicts.length} days, so none of it was used` });
      return null;
    }
    for (const date of result.conflicts) notUsed.push({ item: tag(`${label} on ${date}`), reason: "Two different numbers for this day" });
    return result.days;
  };

  const resolved = columns.map((column) => ({ column, meaning: resolveHeader(column.name, source, catalog) }));
  const read = new Map<string, Map<string, Day>>();
  const contact = columns.find((column) => CONTACT_TAPS.includes(column.name));
  for (const { column, meaning } of resolved) {
    if (column === contact) continue;
    const cells = rows.map((record) => record.cells.get(column.key) ?? "").filter((raw) => !isBlank(raw));
    const numeric = cells.some((raw) => typeof parseNumber(raw) === "number");
    if (meaning.kind === "key") {
      const definition = catalog.byKey.get(meaning.key)!;
      if (!cells.length) { if (!group.blank.includes(meaning.key)) group.blank.push(meaning.key); continue; }
      if (definition.aggregation === "last" && isChangeHeader(column.name)) {
        notUsed.push({ item: tag(`Column "${column.header}"`), reason: "A day's change, not the running total" });
        continue;
      }
      if (read.has(meaning.key)) {
        notUsed.push({ item: tag(`Column "${column.header}"`), reason: `Another column already gives ${definition.label}` });
        continue;
      }
      const summable = partIndex >= 0 && definition.aggregation === "sum" && !PLATFORMS.has(definition.source);
      const days = settle(column, definition.label, daily(column, summable));
      if (!days) continue;
      read.set(meaning.key, days);
      group.read.push({ metricKey: meaning.key, header: column.header, days: days.size });
      continue;
    }
    if (!numeric && cells.some((raw) => raw.trim().endsWith("%"))) {
      notUsed.push({ item: tag(`Column "${column.header}"`), reason: "A rate or average; the charts work those out themselves" });
      continue;
    }
    if (!numeric) continue;
    if (meaning.kind === "ask") {
      const days = settle(column, `"${column.header}"`, daily(column, false));
      if (!days?.size) continue;
      questions.push({
        id: `${group.id}|${context.tableIndex}|${column.name}`, group: group.id, source, header: column.header, kind: "meaning",
        candidates: meaning.candidates, reason: meaning.reason, cells: [...days].map(([date, day]) => ({ date, ...day })).sort((a, b) => a.date.localeCompare(b.date)),
      });
      continue;
    }
    // Not a known number. A day's change is kept for checking totals; rates are never imported;
    // anything else with numbers is an open question for the AI agent.
    if (isChangeHeader(column.name)) {
      notUsed.push({ item: tag(`Column "${column.header}"`), reason: "A day's change, not a total these charts keep" });
      continue;
    }
    if (isRateHeader(column.name, cells)) {
      notUsed.push({ item: tag(`Column "${column.header}"`), reason: "A rate or average; the charts work those out themselves" });
      continue;
    }
    if (meaning.reason !== "Not a number these charts track") {
      notUsed.push({ item: tag(`Column "${column.header}"`), reason: meaning.reason });
      continue;
    }
    const candidates = [...catalog.byKey.values()]
      .filter((metric) => source === null ? true : metric.source === source || !PLATFORMS.has(metric.source))
      .map((metric) => metric.key);
    const days = settle(column, `"${column.header}"`, daily(column, false));
    if (!days?.size || !candidates.length) {
      if (days?.size) notUsed.push({ item: tag(`Column "${column.header}"`), reason: "Not a number these charts track" });
      continue;
    }
    questions.push({
      id: `${group.id}|${context.tableIndex}|${column.name}`, group: group.id, source, header: column.header, kind: "open",
      candidates, reason: `The reader doesn't recognise "${column.header}".`, cells: [...days].map(([date, day]) => ({ date, ...day })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  // Instagram link taps include taps on the contact buttons; a blank contact cell leaves that day unknown.
  if (contact && rows.some((record) => typeof parseNumber(record.cells.get(contact.key) ?? "") === "number")) {
    const taps = read.get("instagram.profile_link_taps");
    if (!taps) notUsed.push({ item: tag(`Column "${contact.header}"`), reason: "Counted with link taps, which this table doesn't have" });
    else {
      const extra = settle(contact, `"${contact.header}"`, daily(contact, false)) ?? new Map<string, Day>();
      for (const [date, day] of [...taps]) {
        const add = extra.get(date);
        if (!add) { taps.delete(date); continue; }
        taps.set(date, { value: day.value + add.value, evidence: `${day.evidence} + "${contact.header}"` });
      }
      const entry = group.read.find((item) => item.metricKey === "instagram.profile_link_taps");
      if (entry) entry.days = taps.size;
    }
  }

  for (const [metricKey, days] of read) {
    for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) values.push({ metricKey, date, value: day.value, evidence: day.evidence });
  }

  // A running total next to its daily change: check one against the other, never work one out from the other.
  for (const [metricKey, days] of read) {
    const definition = catalog.byKey.get(metricKey)!;
    if (definition.aggregation !== "last") continue;
    const stem = metricKey.slice(metricKey.indexOf(".") + 1);
    const change = columns.find((column) => isChangeHeader(column.name) && column.name.includes(stem));
    if (!change) continue;
    const changes = daily(change, false).days;
    let compared = 0;
    let matched = 0;
    for (const [date, day] of days) {
      const before = days.get(shiftDate(date, -1));
      const delta = changes.get(date);
      if (!before || !delta) continue;
      compared += 1;
      if (Math.abs(day.value - before.value - delta.value) < 1e-9) matched += 1;
    }
    if (compared >= 3) {
      group.checks.push(matched === compared
        ? { ok: true, text: `${definition.label} rise by exactly the "${change.header}" column on all ${compared} days.` }
        : { ok: false, text: `${definition.label} match the "${change.header}" column on only ${matched} of ${compared} days, so some totals may be estimates.` });
    }
  }
}

/** A list's columns and rows for the AI agent to describe and code to count. People's details are left out. */
function buildLog(context: GroupContext, records: RowRecord[]): TableLog | null {
  const { group, columns } = context;
  if (!records.length) return null;
  const logColumns: LogColumn[] = columns.map((column, index) => {
    const cells = records.map((record) => record.cells.get(column.key)?.trim() ?? "").filter((raw) => !isBlank(raw));
    const numeric = cells.length > 0 && cells.every((raw) => typeof parseNumber(raw) === "number");
    const counts = new Map<string, number>();
    for (const raw of cells) counts.set(raw, (counts.get(raw) ?? 0) + 1);
    // Outcomes repeat; a column where every value is different (names, companies, notes) is never handed on.
    const categorical = !numeric && counts.size <= MAX_CATEGORIES && !(cells.length >= 4 && counts.size === cells.length)
      && [...counts.keys()].every((raw) => raw.length <= 40 && !looksPersonal(raw));
    return {
      id: `c${index}`, header: column.header, numeric,
      values: categorical ? [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) : null,
    };
  }).filter((column) => column.numeric || column.values);
  if (!logColumns.length) return null;
  const keyOf = new Map(columns.map((column, index) => [`c${index}`, column.key]));
  const dates = records.map((record) => record.date).sort();
  return {
    id: `${group.id}|${context.tableIndex}`, group: group.id, source: group.source, label: group.label, rows: records.length,
    from: dates[0], to: dates[dates.length - 1], columns: logColumns,
    data: records.map((record) => ({
      date: record.date, rawDate: record.rawDate,
      cells: Object.fromEntries(logColumns.map((column) => [column.id, record.cells.get(keyOf.get(column.id)!)?.trim() ?? ""])),
    })),
  };
}

/**
 * Counts a log with rules the AI agent gave: rows per day (or an amount added
 * up per day) where a column holds one of the listed values. Days the log has
 * no rows for stay unknown. Rules that don't fit the log are refused.
 */
export function countLog(log: TableLog, rules: CountRule[], metrics: MetricDefinition[]): { values: TableValue[]; refused: TableNote[] } {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const columns = new Map(log.columns.map((column) => [column.id, column]));
  const values: TableValue[] = [];
  const refused: TableNote[] = [];
  const used = new Set<string>();
  const dates = [...new Set(log.data.map((row) => row.date))].sort();
  for (const rule of rules) {
    const metric = byKey.get(rule.metricKey);
    const refuse = (reason: string) => refused.push({ item: metric ? `${metric.label} from the ${log.label} list` : rule.metricKey, reason });
    if (!metric || metric.aggregation !== "sum") { refuse("Not a daily number a list can be counted into"); continue; }
    if (PLATFORMS.has(metric.source) && metric.source !== log.source) { refuse(log.source ? `A ${sourceName(metric.source)} number from ${log.label} rows` : "The list doesn't say which platform it's for"); continue; }
    if (used.has(rule.metricKey)) { refuse("Counted twice"); continue; }
    const filter = rule.columnId === null ? null : columns.get(rule.columnId);
    if (rule.columnId !== null && (!filter?.values || !rule.equals.length || rule.equals.some((value) => !filter.values!.some((item) => item.value === value)))) {
      refuse("The values to count aren't in the list");
      continue;
    }
    const amount = rule.amountColumnId === null ? null : columns.get(rule.amountColumnId);
    if (rule.amountColumnId !== null && !amount?.numeric) { refuse("The amount column isn't a column of numbers"); continue; }
    if (!amount && metric.unit !== "count") { refuse("Only counts can come from counting rows"); continue; }
    used.add(rule.metricKey);
    const where = filter ? ` where "${filter.header}" is ${listWords(rule.equals.map((value) => `"${value}"`), "or")}` : "";
    for (const date of dates) {
      const day = log.data.filter((row) => row.date === date);
      const matching = day.filter((row) => !filter || rule.equals.includes(row.cells[filter.id]));
      if (amount) {
        const amounts = matching.map((row) => parseNumber(row.cells[amount.id] ?? ""));
        if (amounts.some((value) => value === null)) continue;
        const total = amounts.reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
        values.push({ metricKey: metric.key, date, value: Math.round(total * 100) / 100, evidence: `"${amount.header}" added up over ${plural(matching.length, "row")} on ${day[0].rawDate}${where}` });
      } else {
        values.push({ metricKey: metric.key, date, value: matching.length, evidence: `${plural(matching.length, "row")} of ${day.length} on ${day[0].rawDate}${where}` });
      }
    }
  }
  return { values, refused };
}

/** The numbers an answered question gives. An answer must be one of the question's candidates. */
export function answerQuestions(questions: TableQuestion[], answers: ReadonlyMap<string, string | null>): TableValue[] {
  return questions.flatMap((question) => {
    const key = answers.get(question.id);
    if (!key || !question.candidates.includes(key)) return [];
    return question.cells.map((cell) => ({ metricKey: key, date: cell.date, value: cell.value, evidence: cell.evidence }));
  });
}

function readNote(values: TableValue[], groups: TableGroup[], questions: TableQuestion[], logs: TableLog[], totalsTables: number, tables: number) {
  const parts: string[] = [];
  if (values.length) {
    const bySource = groups.flatMap((group) => {
      const count = values.filter((value) => group.read.some((item) => item.metricKey === value.metricKey)).length;
      return count ? [`${group.label} ${count} across ${plural(new Set(values.filter((value) => group.read.some((item) => item.metricKey === value.metricKey)).map((value) => value.date)).size, "day")}`] : [];
    });
    parts.push(`Read ${plural(values.length, "number")} straight from the spreadsheet${bySource.length > 1 ? `: ${listWords(bySource)}` : bySource.length ? ` (${bySource[0]})` : ""}.`);
  } else if (tables) {
    parts.push(questions.length || logs.length ? "Nothing in this file could be read for certain yet." : "Found a day-by-day table, but nothing in it is a number these charts track.");
  } else {
    parts.push("This file only has totals for whole periods (like the last 7, 30 or 90 days), so there's nothing to put on a day-by-day chart. Ask Muse for the daily table, one row per day.");
  }
  if (questions.length) parts.push(`${plural(new Set(questions.map((question) => question.header)).size, "column needs", "columns need")} a decision first.`);
  if (logs.length) parts.push(`${logs.length === 1 ? "A list" : `${logs.length} lists`} with one row per call, post or payment ${logs.length === 1 ? "needs" : "need"} counting.`);
  if (totalsTables && tables) parts.push("The totals table was left out.");
  return parts.join(" ");
}

export function listWords(items: string[], joiner = "and") {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
