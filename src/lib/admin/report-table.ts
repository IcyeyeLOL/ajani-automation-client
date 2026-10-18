import type { MetricDefinition } from "@/lib/admin/metric-types";

/**
 * Reads a spreadsheet with one row per day (the table the Muse prompt asks for,
 * or a platform's daily export) without AI. Each column is matched to a metric
 * by its header, so the numbers are exact and the read costs nothing. A column
 * it can't match with certainty is reported, never guessed.
 *
 * Values come back in the units people type: counts, hours, dollars.
 */
export type TableValue = { metricKey: string; date: string; value: number; evidence: string };
export type TableNote = { item: string; reason: string };
export type TableRead = {
  values: TableValue[];
  notUsed: TableNote[];
  /** Headers that name a number but not which platform it belongs to. */
  unresolved: string[];
  note: string;
};

const PLATFORM_WORDS: Record<string, string[]> = {
  instagram: ["instagram", "ig", "insta"],
  youtube: ["youtube", "yt"],
  tiktok: ["tiktok"],
  linkedin: ["linkedin"],
  reddit: ["reddit"],
};

/** Header names people and exports use, beyond each metric's key and label. */
const EXTRA_ALIASES: Record<string, string[]> = {
  "instagram.reach": ["accounts_reached"],
  "instagram.interactions": ["content_interactions", "total_interactions"],
  "instagram.profile_link_taps": ["link_taps", "external_link_taps", "website_taps", "link_clicks"],
  "instagram.posts_published": ["posts", "posts_and_reels"],
  "youtube.videos_published": ["videos", "uploads"],
  "youtube.watch_hours": ["watch_time_hours", "watch_time"],
  "tiktok.videos_published": ["videos", "posts"],
  "linkedin.posts_published": ["posts"],
  "reddit.posts_published": ["posts"],
  "reddit.dms_sent": ["dms"],
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

const CONTACT_TAPS = ["contact_taps", "contact_button_taps"];
const WINDOW_HEADERS = ["window", "period", "range", "timeframe", "time_period", "date_range"];
const BLANK = new Set(["", "-", "—", "–", "n/a", "na", "null", "none", "blank"]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function aliasesFor(metric: MetricDefinition) {
  const total = TOTAL_ONLY_ALIASES[metric.key];
  if (total) return total;
  const suffix = metric.key.slice(metric.key.indexOf(".") + 1);
  const label = normalizeHeader(metric.label).replace(new RegExp(`^${metric.source}_`), "");
  return [...new Set([suffix, label, ...(EXTRA_ALIASES[metric.key] ?? [])])];
}

/** Header → metric keys it could mean. Prefixed headers ("instagram_reach") are exact. */
function headerIndex(metrics: MetricDefinition[]) {
  const exact = new Map<string, string>();
  const loose = new Map<string, Set<string>>();
  for (const metric of metrics) {
    for (const alias of aliasesFor(metric)) {
      exact.set(`${metric.source}_${alias}`, metric.key);
      for (const word of PLATFORM_WORDS[metric.source] ?? []) exact.set(`${word}_${alias}`, metric.key);
      loose.set(alias, (loose.get(alias) ?? new Set()).add(metric.key));
    }
  }
  return { exact, loose };
}

function platformsIn(text: string) {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/));
  return Object.entries(PLATFORM_WORDS).filter(([, names]) => names.some((name) => words.has(name))).map(([platform]) => platform);
}

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
function parseDate(raw: string, order: DateOrder): string | null {
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
function dateOrder(cells: string[]): DateOrder {
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
function parseNumber(raw: string): number | null | "blank" {
  const value = raw.trim().toLowerCase();
  if (BLANK.has(value)) return "blank";
  const plain = value.replace(/^\$/, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(plain)) return Number(plain.replace(/,/g, ""));
  if (/^-?\d+(\.\d+)?$/.test(plain)) return Number(plain);
  return null;
}

type Column = { index: number; header: string; key: string | null; contact: boolean; candidates: string[] };

/**
 * Finds every daily table (a header row with a date column and at least one
 * known number) and every totals table, and reads them. Returns null when the
 * text has no table the charts can use, so the AI reader takes over.
 */
export function readDailyTable(text: string, fileName: string, metrics: MetricDefinition[]): TableRead | null {
  const rows = parseTable(text);
  const { exact, loose } = headerIndex(metrics);
  const labels = new Map(metrics.map((metric) => [metric.key, metric.label]));
  const sourceOf = new Map(metrics.map((metric) => [metric.key, metric.source]));
  const fileHints = platformsIn(fileName);
  const values: TableValue[] = [];
  const notUsed: TableNote[] = [];
  const unresolved = new Set<string>();
  let dailyTables = 0;
  let totalsTables = 0;

  const classify = (header: string): Column => {
    const name = normalizeHeader(header);
    if (CONTACT_TAPS.includes(name)) return { index: 0, header, key: null, contact: true, candidates: [] };
    const known = exact.get(name);
    if (known) return { index: 0, header, key: known, contact: false, candidates: [] };
    const candidates = [...(loose.get(name) ?? [])];
    return { index: 0, header, key: candidates.length === 1 ? candidates[0] : null, contact: false, candidates: candidates.length > 1 ? candidates : [] };
  };

  for (let start = 0; start < rows.length; start += 1) {
    const header = rows[start];
    const names = header.map(normalizeHeader);
    const dateIndex = names.findIndex((name) => name === "date" || name === "day" || name.startsWith("date_"));
    const windowIndex = names.findIndex((name) => WINDOW_HEADERS.includes(name));
    if (dateIndex < 0 && windowIndex < 0) continue;
    const columns = header.map((cell, index) => ({ ...classify(cell), index }))
      .filter((column) => column.index !== dateIndex && column.index !== windowIndex && normalizeHeader(column.header));
    if (!columns.some((column) => column.key || column.candidates.length || column.contact)) continue;

    // The block runs until a blank row or the next header.
    let end = start + 1;
    while (end < rows.length && rows[end].some((cell) => cell.trim()) && !rows[end].map(normalizeHeader).some((name) => name === "date" || WINDOW_HEADERS.includes(name))) end += 1;
    const body = rows.slice(start + 1, end);
    const title = rows.slice(Math.max(0, start - 3), start).map((row) => row.join(" ")).join(" ");

    if (dateIndex < 0) {
      totalsTables += 1;
      for (const row of body) {
        const window = row[windowIndex]?.trim();
        if (window) notUsed.push({ item: `Totals for ${window}`, reason: "A total for a whole period; it can't be split into days" });
      }
      start = end - 1;
      continue;
    }

    // Which platform unprefixed headers ("followers", "comments") are about.
    const hinted = [...new Set([...platformsIn(title), ...fileHints])];
    const certain = [...new Set(columns.flatMap((column) => column.key ? [sourceOf.get(column.key) ?? ""] : []).filter((source) => PLATFORM_WORDS[source]))];
    const platform = hinted.length === 1 ? hinted[0] : hinted.length === 0 && certain.length === 1 ? certain[0] : null;
    for (const column of columns) {
      if (column.key || !column.candidates.length) continue;
      const pick = platform ? column.candidates.find((key) => sourceOf.get(key) === platform) : undefined;
      if (pick) column.key = pick;
      else unresolved.add(column.header);
    }
    const linkTaps = columns.find((column) => column.key === "instagram.profile_link_taps");
    const contact = columns.find((column) => column.contact);
    for (const column of columns) {
      if (!column.key && !column.contact && !column.candidates.length) notUsed.push({ item: `Column "${column.header}"`, reason: "Not a number these charts track" });
      if (column.contact && !linkTaps) notUsed.push({ item: `Column "${column.header}"`, reason: "Counted with link taps, which this table doesn't have" });
    }

    const order = dateOrder(body.map((row) => row[dateIndex] ?? ""));
    dailyTables += 1;
    for (const row of body) {
      const rawDate = row[dateIndex] ?? "";
      const date = parseDate(rawDate, order);
      if (!date) {
        if (/total|sum|average|avg/i.test(rawDate)) notUsed.push({ item: `Row "${rawDate}"`, reason: "A total or average row, not a day" });
        else if (rawDate.trim()) notUsed.push({ item: `Row "${rawDate}"`, reason: "The date could not be read" });
        continue;
      }
      for (const column of columns) {
        if (!column.key) continue;
        const parsed = parseNumber(row[column.index] ?? "");
        if (parsed === "blank") continue;
        if (parsed === null) {
          notUsed.push({ item: `${labels.get(column.key)} on ${date}`, reason: `"${row[column.index]}" is not a number` });
          continue;
        }
        let value = parsed;
        let evidence = `Row ${rawDate.trim()}, column "${column.header}"`;
        if (column === linkTaps && contact) {
          // Instagram link taps include the contact buttons; a blank contact cell leaves the day unknown.
          const extra = parseNumber(row[contact.index] ?? "");
          if (typeof extra !== "number") continue;
          value += extra;
          evidence = `Row ${rawDate.trim()}, columns "${column.header}" + "${contact.header}"`;
        }
        values.push({ metricKey: column.key, date, value, evidence });
      }
    }
    start = end - 1;
  }

  if (!dailyTables && !totalsTables) return null;
  const days = new Set(values.map((value) => value.date)).size;
  const parts = !dailyTables
    ? ["This file only has totals for whole periods (like the last 7, 30 or 90 days), so there's nothing to put on a day-by-day chart. Ask Muse for the daily table, one row per day."]
    : [
      values.length
        ? `Read ${values.length} ${values.length === 1 ? "number" : "numbers"} across ${days} ${days === 1 ? "day" : "days"} straight from the spreadsheet, column by column.`
        : "Found a day-by-day table, but its cells were blank or not numbers.",
      unresolved.size ? "Some columns don't say which platform they're for; put the platform in the file name, for example instagram-daily.csv." : "",
      totalsTables ? "The totals table was left out." : "",
    ];
  const note = parts.filter(Boolean).join(" ");
  return { values, notUsed: notUsed.slice(0, 40), unresolved: [...unresolved], note };
}
