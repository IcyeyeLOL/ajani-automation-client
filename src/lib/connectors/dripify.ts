import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

/** Verified 2026-10-16: an unauthenticated call here returns Dripify's documented 401 body. */
export const DRIPIFY_API_BASE = "https://api.dripify.com/v1/open-api";
export const DRIPIFY_ACTOR = "connector:dripify";

// Dripify allows 60 requests a minute and 5,000 a day per key. One run stays
// inside a single minute's allowance, so the nightly job and a manual sync can
// overlap without starving each other; 429s still wait for Retry-After.
const REQUEST_BUDGET = 50;
const PAGE_LIMIT = 100;
const MAX_CAMPAIGN_PAGES = 5;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 15_000;
const MIN_REQUEST_MS = 1_000;
/** Time kept back from fetching so every snapshot that was read gets written. */
const WRITE_RESERVE_MS = 8_000;
const UPSERT_CHUNK = 500;
const LABEL_LENGTH = 120;

/** Exact counts only. Dripify's percentages are these counts ÷ contacted leads, rounded to one decimal. */
const statisticFields = [
  ["dripify.leads_total", "totalLeads"],
  ["dripify.leads_contacted", "contactedLeads"],
  ["dripify.leads_accepted", "acceptanceRateLeads"],
  ["dripify.leads_replied", "replyRateLeads"],
] as const;
const rateFields = ["dripify.leads_contacted", "dripify.leads_accepted", "dripify.leads_replied"] as const;
/** Lead statuses Dripify reports per campaign: a live snapshot that need not add up to the total. */
const breakdownFields = [
  ["dripify.leads_in_progress", "inProgress"],
  ["dripify.leads_finished", "finished"],
  ["dripify.leads_failed", "failed"],
] as const;
/** "Right now" counts that stop at zero when their campaign or team disappears (lifetime totals carry forward on purpose). */
const campaignNowKeys = ["dripify.leads_in_progress", "dripify.leads_remaining"] as const;
const teamNowKeys = ["dripify.unread_messages", "dripify.active_campaigns"] as const;
/** Running totals whose change since the previous sync is the new activity Dripify's dashboard shows. */
const flowFields = [
  ["dripify.leads_contacted", "dripify.new_contacted"],
  ["dripify.leads_accepted", "dripify.new_accepted"],
  ["dripify.leads_replied", "dripify.new_replies"],
] as const;

export type DripifyCampaign = { id: number; name: string; status: string };
/** Team-level inbox and campaign counts; team names are the owner's own labels. */
export type DripifyTeam = { id: number; name: string; counts: Array<readonly [string, number]> };

export type DripifySyncResult = {
  status: "synced" | "partial" | "not_configured" | "rejected";
  reason: null | "invalid_key" | "plan_without_api" | "api_disabled" | "rate_limited" | "deadline" | "listing_incomplete" | "failures";
  /** UTC day the snapshot is recorded under. */
  date: string;
  /** Launched (non-draft) campaigns found. */
  campaigns: number;
  synced: number;
  /** Campaigns not refreshed this run; their last snapshot carries forward. */
  deferred: number;
  failed: number;
  valuesWritten: number;
  /** null when labels could not be saved (display names only). */
  labelsWritten: number | null;
};

type StopReason = "deadline" | "rate_limited" | "budget";

class DripifyHttpError extends Error {
  constructor(readonly status: number) {
    super(`dripify_http_${status}`);
  }
}

class SyncStop extends Error {
  constructor(readonly reason: StopReason) {
    super(`dripify_stop_${reason}`);
  }
}

type Context = {
  apiKey: string;
  fetchDeadline: number;
  requests: number;
  pausedUntil: number;
};

export async function syncDripifyMetrics({ deadlineAt, now = Date.now() }: { deadlineAt: number; now?: number }): Promise<DripifySyncResult> {
  const date = new Date(now).toISOString().slice(0, 10);
  const result: DripifySyncResult = {
    status: "synced", reason: null, date, campaigns: 0, synced: 0, deferred: 0, failed: 0, valuesWritten: 0, labelsWritten: 0,
  };
  const apiKey = process.env.DRIPIFY_API_KEY?.trim();
  if (!apiKey) return { ...result, status: "not_configured", labelsWritten: null };

  const context: Context = { apiKey, fetchDeadline: deadlineAt - WRITE_RESERVE_MS, requests: 0, pausedUntil: 0 };
  let listing: { campaigns: DripifyCampaign[]; complete: boolean; stop: StopReason | null };
  try {
    listing = await listLaunchedCampaigns(context);
  } catch (error) {
    const reason = rejectionReason(error);
    if (reason) return { ...result, status: "rejected", reason, labelsWritten: null };
    throw error;
  }

  // One request for the inbox and active-campaign counts Dripify keeps per team.
  const teams = listing.stop ? { teams: [], complete: false, stop: null } : await readTeams(context);
  const slots = Math.max(0, REQUEST_BUDGET - context.requests);
  const selected = campaignsForRun(listing.campaigns, slots, Math.floor(Date.parse(date) / 86_400_000));
  const snapshots: Snapshot[] = [];
  // Shared by the concurrent readers below.
  const run: { stop: StopReason | null; rejected: DripifySyncResult["reason"]; gone: number } = { stop: listing.stop ?? teams.stop, rejected: null, gone: 0 };

  await eachWithConcurrency(selected, CONCURRENCY, async (campaign) => {
    if (run.stop || run.rejected) return;
    try {
      const payload = await request(context, `/campaigns/${campaign.id}/statistics`);
      const counts = statisticCounts(payload, campaign.id);
      if (counts) snapshots.push({ campaign, counts: [...counts, ...statusCounts(payload, counts)] });
      else result.failed += 1;
    } catch (error) {
      if (error instanceof SyncStop) run.stop ??= error.reason;
      // Deleted between listing and statistics: nothing new to record.
      else if (error instanceof DripifyHttpError && error.status === 404) run.gone += 1;
      else {
        const reason = rejectionReason(error);
        if (reason) run.rejected ??= reason;
        else result.failed += 1;
      }
    }
  });

  result.campaigns = listing.campaigns.length;
  result.synced = snapshots.length;
  result.deferred = Math.max(0, listing.campaigns.length - snapshots.length - result.failed - run.gone);
  // Only a complete listing can show that a campaign or team is gone.
  const listed = {
    campaigns: listing.complete ? new Set(listing.campaigns.map((campaign) => dripifyDimension(campaign.id))) : null,
    teams: teams.complete ? new Set(teams.teams.map((team) => dripifyTeamDimension(team.id))) : null,
  };
  if (snapshots.length || teams.teams.length || listed.campaigns || listed.teams) {
    await saveSnapshots(snapshots, teams.teams, listed, date, deadlineAt, result);
  }

  if (run.rejected) return { ...result, status: "rejected", reason: run.rejected };
  // The request budget is a deliberate cap: deferred campaigns rotate in on
  // later days. A deadline, rate limit or failed read is a real gap.
  const reason = run.stop === "deadline" || run.stop === "rate_limited" ? run.stop
    : !listing.complete ? "listing_incomplete"
      : result.failed > 0 ? "failures" : null;
  return reason ? { ...result, status: "partial", reason } : result;
}

type Snapshot = { campaign: DripifyCampaign; counts: Array<readonly [string, number]> };

type Listed = { campaigns: Set<string> | null; teams: Set<string> | null };

async function saveSnapshots(snapshots: Snapshot[], teams: DripifyTeam[], listed: Listed, date: string, deadlineAt: number, result: DripifySyncResult) {
  const admin = createSupabaseAdminClient();
  const previous = await previousTotals(admin, date, deadlineAt);
  // The history reader and the newer metrics ship in one migration. Without it,
  // only the original counts are written, so deploying code before the schema
  // never makes the store refuse the whole batch.
  const extended = previous !== null;
  const core = new Set<string>(statisticFields.map(([metricKey]) => metricKey));
  const values = [
    ...snapshots.flatMap(({ campaign, counts }) => {
      const dimension = dripifyDimension(campaign.id);
      const stored = extended ? counts : counts.filter(([metricKey]) => core.has(metricKey));
      return [...stored, ...newActivity(counts, dimension, previous)].map(([metricKey, value]) => ({ metricKey, date, dimension, value }));
    }),
    ...(extended ? teams : []).flatMap((team) => team.counts.map(([metricKey, value]) => ({ metricKey, date, dimension: dripifyTeamDimension(team.id), value }))),
    ...(previous ? [
      ...retiredCounts(previous, listed.campaigns, campaignNowKeys, "dripify:"),
      ...retiredCounts(previous, listed.teams, teamNowKeys, "dripify-team:"),
    ] : []).map(([metricKey, dimension]) => ({ metricKey, date, dimension, value: 0 })),
  ];
  if (!values.length) return;
  for (const chunk of chunked(values, UPSERT_CHUNK)) {
    const { data, error } = await withinDeadline(admin.rpc("upsert_analytics_metric_values", {
      p_values: chunk, p_origin: "connector", p_actor: DRIPIFY_ACTOR,
    }), deadlineAt);
    if (error) throw error;
    result.valuesWritten += Number(data) || 0;
  }

  const labels = [
    ...snapshots.flatMap(({ campaign }) => {
      const label = campaignLabel(campaign.name);
      return label ? [{ dimension: dripifyDimension(campaign.id), label }] : [];
    }),
    ...(extended ? teams : []).flatMap((team) => {
      const label = campaignLabel(team.name);
      return label && team.counts.length ? [{ dimension: dripifyTeamDimension(team.id), label }] : [];
    }),
  ];
  if (!labels.length) return;
  try {
    const { data, error } = await withinDeadline(admin.rpc("upsert_analytics_dimension_labels", { p_labels: labels, p_actor: DRIPIFY_ACTOR }), deadlineAt);
    if (error) throw error;
    result.labelsWritten = Number(data) || 0;
  } catch (error) {
    // Labels are display names only; the counts above are already saved.
    console.error("Dripify campaign names could not be saved", { message: error instanceof Error ? error.message : "Unknown error" });
    result.labelsWritten = null;
  }
}

/** Plain-language outcome for the control desk. Never includes provider error text. */
export function dripifySyncMessage(result: DripifySyncResult): { status: "success" | "error"; message: string } {
  if (result.status === "not_configured") {
    return { status: "error", message: "Dripify is not connected yet. Add DRIPIFY_API_KEY in Vercel's environment variables, redeploy, then sync again." };
  }
  if (result.status === "rejected") {
    const message = result.reason === "invalid_key"
      ? "Dripify did not accept the API key. Create a new key in Dripify under Settings → API & Integrations, then update DRIPIFY_API_KEY in Vercel."
      : result.reason === "plan_without_api"
        ? "Your Dripify plan does not include API access. Upgrade to a plan with the Open API, then sync again."
        : "Dripify's API is switched off for this account. Turn it on under Settings → API & Integrations in Dripify, then sync again.";
    return { status: "error", message };
  }
  const campaigns = `${result.synced} of ${result.campaigns} campaign${result.campaigns === 1 ? "" : "s"}`;
  if (result.status === "partial") {
    const why = result.reason === "rate_limited" ? "Dripify asked us to slow down"
      : result.reason === "deadline" ? "Dripify was slow to respond" : "some campaigns could not be read";
    return { status: "error", message: `Synced ${campaigns}; ${why}. The rest keep their last numbers until the next sync.` };
  }
  if (!result.campaigns) return { status: "success", message: "Connected. Dripify has no launched campaigns yet." };
  return {
    status: "success",
    message: `Synced ${campaigns} for ${result.date} (UTC).${result.deferred ? " The others rotate in on the next nightly syncs." : ""}`,
  };
}

/** Stable account key: campaign names change, IDs do not. */
export function dripifyDimension(campaignId: number) {
  return `dripify:${campaignId}`;
}

export function dripifyTeamDimension(teamId: number) {
  return `dripify-team:${teamId}`;
}

/**
 * Each campaign's and team's latest values before today, keyed "metric|account":
 * the running totals new activity starts from, and the "right now" counts that
 * show which accounts were still live. null when they cannot be read (for
 * example before the migration), in which case new activity is left unknown
 * for this run rather than guessed and only the original counts are written.
 */
async function previousTotals(admin: ReturnType<typeof createSupabaseAdminClient>, date: string, deadlineAt: number) {
  try {
    const { data, error } = await withinDeadline(admin.rpc("load_analytics_latest_values", {
      p_keys: [...flowFields.map(([total]) => total), ...campaignNowKeys, ...teamNowKeys], p_before: date,
    }), deadlineAt);
    if (error) throw error;
    const totals = new Map<string, number>();
    for (const row of Array.isArray(data) ? data : []) {
      const item = row as Record<string, unknown>;
      const value = Number(item.value);
      if (typeof item.metric_key === "string" && typeof item.dimension_key === "string" && Number.isSafeInteger(value) && value >= 0) {
        totals.set(`${item.metric_key}|${item.dimension_key}`, value);
      }
    }
    return totals;
  } catch {
    console.error("Dripify previous totals could not be read; new activity is skipped this run");
    return null;
  }
}

/**
 * New activity since the previous sync: today's running total minus the last
 * one recorded before today. Re-syncing the same day recomputes it from the
 * same starting point. All three are written together or not at all, like the
 * lifetime counts, so the period rates never pair new acceptances with missing
 * contacts. A first sync or any total that went down (leads removed) stays
 * unknown, never zero or negative. Limitation: the store keeps a value once
 * written, so if a later same-day sync finds a total went down, the earlier
 * figure for that day stays until the next day's sync.
 */
export function newActivity(counts: Array<readonly [string, number]>, dimension: string, previous: Map<string, number> | null) {
  if (!previous) return [];
  const pairs = flowFields.map(([totalKey, flowKey]) => ({
    flowKey,
    current: counts.find(([key]) => key === totalKey)?.[1],
    before: previous.get(`${totalKey}|${dimension}`),
  }));
  if (pairs.some(({ current, before }) => current === undefined || before === undefined || current < before)) return [];
  return pairs.map(({ flowKey, current, before }) => [flowKey, (current as number) - (before as number)] as const);
}

/**
 * Zeros for "right now" counts of accounts a complete listing no longer has
 * (deleted campaigns, teams you left), so Trends stops carrying their last
 * value forward. Written once: only when the last value is above zero.
 */
export function retiredCounts(previous: Map<string, number>, listed: Set<string> | null, keys: readonly string[], prefix: string) {
  if (!listed) return [];
  return [...previous].flatMap(([entry, value]) => {
    const separator = entry.indexOf("|");
    const metricKey = entry.slice(0, separator);
    const dimension = entry.slice(separator + 1);
    return keys.includes(metricKey) && dimension.startsWith(prefix) && !listed.has(dimension) && value > 0 ? [[metricKey, dimension] as const] : [];
  });
}

/**
 * Active campaigns first, then paused or finished ones (replies keep arriving
 * after a sequence ends). When there are more than one run may read, the start
 * rotates by day so every campaign is refreshed in turn.
 */
export function campaignsForRun(campaigns: DripifyCampaign[], slots: number, dayIndex: number) {
  const active = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const rest = campaigns.filter((campaign) => campaign.status !== "ACTIVE");
  return [
    ...rotated(active, dayIndex * slots),
    ...rotated(rest, dayIndex * Math.max(1, slots - active.length)),
  ].slice(0, slots);
}

/**
 * Reads one statistics payload. The three counts the rates are built from
 * (contacted, accepted, replied) are stored together or not at all: a partial
 * snapshot would pair a new numerator with a stale, carried-forward
 * denominator. Leads loaded is stored when valid. Missing or malformed counts
 * are never recorded as zero.
 */
export function statisticCounts(payload: unknown, campaignId: number) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.campaignId !== campaignId) return null;
  const counts = statisticFields.flatMap(([metricKey, field]) => {
    const value = record[field];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [[metricKey, value] as const] : [];
  });
  return rateFields.every((metricKey) => counts.some(([key]) => key === metricKey)) ? counts : null;
}

/**
 * Leads not yet contacted (Dripify's progress bar) and the live lead statuses,
 * from the same statistics payload. Each is stored only when present and whole.
 */
export function statusCounts(payload: unknown, counts: Array<readonly [string, number]>) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const breakdown = record.leadStatusBreakdown && typeof record.leadStatusBreakdown === "object" ? record.leadStatusBreakdown as Record<string, unknown> : {};
  const statuses = breakdownFields.flatMap(([metricKey, field]) => {
    const value = breakdown[field];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [[metricKey, value] as const] : [];
  });
  const total = counts.find(([key]) => key === "dripify.leads_total")?.[1];
  const contacted = counts.find(([key]) => key === "dripify.leads_contacted")?.[1];
  const remaining = total !== undefined && contacted !== undefined && total >= contacted ? [["dripify.leads_remaining", total - contacted] as const] : [];
  return [...remaining, ...statuses];
}

export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 5_000;
  const seconds = Number(value);
  if (value.trim() && Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : 5_000;
}

async function listLaunchedCampaigns(context: Context) {
  const campaigns: DripifyCampaign[] = [];
  const seenIds = new Set<number>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page += 1) {
    let payload: unknown;
    try {
      payload = await request(context, `/campaigns?limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    } catch (error) {
      if (error instanceof SyncStop) return { campaigns, complete: false, stop: error.reason };
      throw error;
    }
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (!Array.isArray(body.items)) throw new Error("dripify_campaign_page_invalid");
    for (const item of body.items) {
      const campaign = parseCampaign(item);
      if (campaign && campaign.status !== "DRAFT" && !seenIds.has(campaign.id)) {
        seenIds.add(campaign.id);
        campaigns.push(campaign);
      }
    }
    const next = typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null;
    if (!next) return { campaigns, complete: true, stop: null };
    if (seenCursors.has(next)) throw new Error("dripify_cursor_repeated");
    seenCursors.add(next);
    cursor = next;
  }
  return { campaigns, complete: false, stop: null };
}

/** First page of teams (a solo account has one). Team counts are supplementary: any failure skips them. */
async function readTeams(context: Context): Promise<{ teams: DripifyTeam[]; complete: boolean; stop: StopReason | null }> {
  try {
    const payload = await request(context, `/teams?limit=${PAGE_LIMIT}`);
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (!Array.isArray(body.items)) return { teams: [], complete: false, stop: null };
    const teams = body.items.flatMap((item) => { const team = parseTeam(item); return team ? [team] : []; });
    return { teams, complete: !(typeof body.nextCursor === "string" && body.nextCursor), stop: null };
  } catch (error) {
    return { teams: [], complete: false, stop: error instanceof SyncStop && error.reason !== "budget" ? error.reason : null };
  }
}

export function parseTeam(value: unknown): DripifyTeam | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id <= 0) return null;
  const statistics = record.statistics && typeof record.statistics === "object" ? record.statistics as Record<string, unknown> : {};
  const counts = ([["dripify.unread_messages", "unreadMessagesCount"], ["dripify.active_campaigns", "activeCampaignsCount"]] as const).flatMap(([metricKey, field]) => {
    const count = statistics[field];
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? [[metricKey, count] as const] : [];
  });
  return { id: record.id, name: typeof record.name === "string" ? record.name : "", counts };
}

function parseCampaign(value: unknown): DripifyCampaign | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  // IDs are int64; anything JavaScript cannot hold exactly is skipped, not rounded.
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id <= 0) return null;
  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : "",
    status: typeof record.status === "string" ? record.status : "",
  };
}

async function request(context: Context, path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const pause = context.pausedUntil - Date.now();
    if (pause > 0) await sleep(pause);
    if (context.requests >= REQUEST_BUDGET) throw new SyncStop("budget");
    const remaining = context.fetchDeadline - Date.now();
    if (remaining < MIN_REQUEST_MS) throw new SyncStop("deadline");
    context.requests += 1;

    let response: Response;
    try {
      response = await fetch(`${DRIPIFY_API_BASE}${path}`, {
        headers: { accept: "application/json", "x-api-key": context.apiKey },
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        cache: "no-store",
      });
    } catch (error) {
      if (attempt === 0 && Date.now() + MIN_REQUEST_MS < context.fetchDeadline) continue;
      throw error;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const wait = response.status === 429 ? retryAfterMs(response.headers.get("retry-after")) : 1_000 * (attempt + 1);
      if (wait <= MAX_RETRY_WAIT_MS && Date.now() + wait + MIN_REQUEST_MS < context.fetchDeadline) {
        await response.body?.cancel();
        // A 429 applies to the whole key, so every worker waits it out.
        if (response.status === 429) context.pausedUntil = Math.max(context.pausedUntil, Date.now() + wait);
        else await sleep(wait);
        continue;
      }
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new SyncStop("rate_limited");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DripifyHttpError(response.status);
    }
    return response.json();
  }
}

function rejectionReason(error: unknown): DripifySyncResult["reason"] {
  if (!(error instanceof DripifyHttpError)) return null;
  // Per Dripify's docs, 403 means the plan excludes the Open API and 404 on a
  // listing means the Open API is turned off for the account.
  return error.status === 401 ? "invalid_key" : error.status === 403 ? "plan_without_api" : error.status === 404 ? "api_disabled" : null;
}

function campaignLabel(name: string) {
  const label = name.replace(/[\s\p{Cc}]+/gu, " ").trim();
  return label ? label.slice(0, LABEL_LENGTH).trim() : "";
}

async function eachWithConcurrency<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

function rotated<T>(items: T[], offset: number) {
  if (!items.length) return items;
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function chunked<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
