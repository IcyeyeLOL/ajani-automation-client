import "server-only";

import { createHash } from "node:crypto";
import {
  createProviderClient, ProviderHttpError, ProviderStop, type ProviderClient,
} from "@/lib/connectors/provider-http";
import {
  countPerDay, env, recordConnectorRun, shiftDay, utcDay, utcDayOf, wholeCount, writeValues,
  type ConnectorReason, type ConnectorResult, type MetricValue, type MetricWriter, type RunRecorder,
} from "@/lib/connectors/connector-store";
import { databaseCredentialStore, vaultKey, type CredentialStore } from "@/lib/connectors/credential-vault";

/**
 * Instagram, via the Instagram API with Instagram Login (graph.instagram.com),
 * verified against Meta's docs on 2026-10-16. No Facebook Page and no App Review
 * are needed for the owner's own professional account: a token generated in the
 * App Dashboard (instagram_business_basic + instagram_business_manage_insights)
 * goes in INSTAGRAM_ACCESS_TOKEN.
 *
 * - Tokens last 60 days and change when refreshed. With CONNECTOR_ENCRYPTION_KEY
 *   set, the connector renews the token before it expires and keeps the new one
 *   sealed in the database. A new token pasted into the setting always wins.
 * - Insights can arrive up to 48 hours late and may be revised, so each run
 *   re-reads the last INSIGHT_DAYS days and replaces them. Missing data stays
 *   unknown. Profile views and website clicks left the API in January 2025.
 */
const API = "https://graph.instagram.com/v25.0";
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";
const HOSTS = ["graph.instagram.com"] as const;

export const INSTAGRAM_ACTOR = "connector:instagram";
export const INSTAGRAM_SETTINGS = { required: ["INSTAGRAM_ACCESS_TOKEN"], renewal: ["CONNECTOR_ENCRYPTION_KEY"] } as const;

const REQUEST_BUDGET = 30;
const WRITE_RESERVE_MS = 6_000;
export const INSIGHT_DAYS = 3;
export const POST_DAYS = 14;
const MEDIA_PAGES = 3;
/** Renew when fewer than this many days are left (renewal needs the token to be a day old). */
const RENEW_WITHIN_DAYS = 20;
const TOKEN_DAYS = 60;

const insightMetrics = [
  ["reach", "instagram.reach"],
  ["views", "instagram.views"],
  ["total_interactions", "instagram.interactions"],
  ["likes", "instagram.likes"],
  ["comments", "instagram.comments"],
  ["shares", "instagram.shares"],
  ["saves", "instagram.saves"],
  ["profile_links_taps", "instagram.profile_link_taps"],
] as const;

export type InstagramSyncOptions = {
  deadlineAt: number;
  now?: number;
  source?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  write?: MetricWriter;
  record?: RunRecorder;
  /** Defaults to the sealed database store when CONNECTOR_ENCRYPTION_KEY is set. */
  credentials?: CredentialStore | null;
};

export function instagramConfigured(source: Record<string, string | undefined> = process.env) {
  return Boolean(env("INSTAGRAM_ACCESS_TOKEN", source));
}

export async function syncInstagramMetrics(options: InstagramSyncOptions): Promise<ConnectorResult> {
  const now = options.now ?? Date.now();
  const today = utcDay(now);
  const result: ConnectorResult = { connector: "instagram", status: "synced", reason: null, date: today, valuesWritten: 0, details: {} };
  const settingToken = env("INSTAGRAM_ACCESS_TOKEN", options.source);
  if (!settingToken) return { ...result, status: "not_configured" };

  const key = vaultKey(options.source);
  const credentials = options.credentials !== undefined ? options.credentials : key ? databaseCredentialStore(key, options.deadlineAt) : null;
  const client = createProviderClient({
    provider: "instagram",
    deadlineAt: options.deadlineAt - WRITE_RESERVE_MS,
    budget: REQUEST_BUDGET,
    allowedHosts: HOSTS,
    errorCode: metaErrorCode,
    isRateLimited: (_status, code) => isMetaRateLimit(code),
    fetchImpl: options.fetchImpl,
  });

  const values: MetricValue[] = [];
  let reason: ConnectorReason | null = credentials ? null : "vault_missing";
  let rejected = false;
  try {
    const token = await currentToken(client, settingToken, credentials, now, result);
    const account = await readAccount(client, token);
    if (!account) return finish({ ...result, status: "rejected", reason: "account_not_found" }, options);
    if (account.followers !== null) values.push({ metricKey: "instagram.followers", date: today, value: account.followers });

    const insights = await readInsights(client, token, account.id, today);
    values.push(...insights.values);
    result.details.insightDays = insights.days;
    if (insights.failure) {
      // Days already read are kept either way.
      if (rejectionReason(insights.failure)) throw insights.failure;
      reason = partialReason(insights.failure) ?? "failures";
    }
    const posts = await readPostsPerDay(client, token, account.id, today);
    values.push(...posts.values);
    result.details.postDays = posts.values.length;
    if (posts.failure) {
      if (rejectionReason(posts.failure)) throw posts.failure;
      reason = partialReason(posts.failure) ?? "failures";
    }
  } catch (error) {
    const rejection = rejectionReason(error);
    if (rejection) {
      rejected = true;
      reason = rejection;
    } else {
      reason = partialReason(error) ?? "failures";
    }
  }

  const written = await writeValues(options.write, values, INSTAGRAM_ACTOR, options.deadlineAt);
  if (written === null) return finish({ ...result, status: "partial", reason: "save_failed" }, options);
  result.valuesWritten = written;
  if (rejected) return finish({ ...result, status: "rejected", reason }, options);
  // Without the vault the numbers still sync; the warning is that the token will lapse.
  return finish(reason && reason !== "vault_missing" ? { ...result, status: "partial", reason } : { ...result, reason }, options);
}

async function finish(result: ConnectorResult, options: InstagramSyncOptions) {
  await (options.record ?? recordConnectorRun)(result);
  return result;
}

/** Ties a stored, renewed token to the setting it grew from, without storing the setting itself. */
export function tokenLineage(settingToken: string) {
  return createHash("sha256").update(`instagram:${settingToken}`).digest("base64url").slice(0, 22);
}

async function currentToken(client: ProviderClient, settingToken: string, credentials: CredentialStore | null, now: number, result: ConnectorResult) {
  if (!credentials) return settingToken;
  const lineage = tokenLineage(settingToken);
  let token = settingToken;
  let expiresAt: number | null = null;
  try {
    const stored = await credentials.load("instagram");
    const parsed = stored ? parseSealedToken(stored.token) : null;
    // A token pasted into the setting after the last renewal replaces the renewed one.
    if (stored && parsed && parsed.lineage === lineage) {
      token = parsed.token;
      expiresAt = stored.expiresAt ? Date.parse(stored.expiresAt) : null;
    }
  } catch {
    // The vault is a convenience; the setting still works this run.
    return settingToken;
  }
  if (expiresAt !== null && expiresAt - now > RENEW_WITHIN_DAYS * 86_400_000) return token;

  try {
    const url = new URL(REFRESH_URL);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    const payload = record(await client.request(url));
    const renewed = typeof payload.access_token === "string" && payload.access_token.length >= 20 ? payload.access_token : null;
    // Meta issues 60-day tokens; a longer claim is capped so renewal is never skipped.
    const reported = wholeCount(payload.expires_in);
    const seconds = reported === null ? null : Math.min(reported, TOKEN_DAYS * 86_400);
    if (!renewed) return token;
    try {
      await credentials.save("instagram", JSON.stringify({ token: renewed, lineage }), seconds ? new Date(now + seconds * 1000).toISOString() : null);
      result.details.tokenRenewed = 1;
    } catch {
      // The renewed token still works for this run; the next run renews again.
    }
    return renewed;
  } catch (error) {
    // A token under a day old cannot be renewed yet; an expired one fails the reads below with a clear reason.
    if (error instanceof ProviderStop) throw error;
    return token;
  }
}

function parseSealedToken(value: string) {
  try {
    const parsed = JSON.parse(value) as { token?: unknown; lineage?: unknown };
    return typeof parsed.token === "string" && typeof parsed.lineage === "string" ? { token: parsed.token, lineage: parsed.lineage } : null;
  } catch {
    return null;
  }
}

function withToken(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${API}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("access_token", token);
  return url;
}

async function readAccount(client: ProviderClient, token: string) {
  const payload = record(await client.request(withToken("/me", token, { fields: "user_id,username,followers_count,media_count" })));
  // Meta documents both a flat object and {data:[...]}.
  const body = Array.isArray(payload.data) ? record(payload.data[0]) : payload;
  // IDs exceed 2^53; a JSON number may already be rounded to another account's ID.
  const exact = (value: unknown) => typeof value === "string" ? value
    : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
  const id = exact(body.user_id) || exact(body.id);
  if (!/^\d{5,30}$/.test(id)) return null;
  return { id, followers: wholeCount(body.followers_count) };
}

/**
 * One request per UTC day (total_value sums the requested window). A failure
 * returns the days already read with the error, so they are still saved.
 */
async function readInsights(client: ProviderClient, token: string, accountId: string, today: string) {
  const values: MetricValue[] = [];
  let days = 0;
  try {
  // Metrics the account cannot report, learned on the first day so later days stay one request each.
  let supported: string[] = insightMetrics.map(([name]) => name);
  for (let offset = INSIGHT_DAYS; offset >= 1; offset -= 1) {
    const day = shiftDay(today, -offset);
    const window = {
      period: "day",
      metric_type: "total_value",
      since: String(Date.parse(`${day}T00:00:00Z`) / 1000),
      until: String(Date.parse(`${shiftDay(day, 1)}T00:00:00Z`) / 1000),
    };
    if (!supported.length) break;
    let found: Map<string, number>;
    try {
      found = insightTotals(await client.request(withToken(`/${accountId}/insights`, token, { ...window, metric: supported.join(",") })));
    } catch (error) {
      // One unsupported metric fails the whole request; read them one by one instead.
      if (!(error instanceof ProviderHttpError && error.status === 400 && !rejectionReason(error))) throw error;
      found = new Map();
      const accepted: string[] = [];
      for (const name of supported) {
        try {
          for (const [metric, value] of insightTotals(await client.request(withToken(`/${accountId}/insights`, token, { ...window, metric: name })))) found.set(metric, value);
          accepted.push(name);
        } catch (inner) {
          if (!(inner instanceof ProviderHttpError && inner.status === 400 && !rejectionReason(inner))) throw inner;
        }
      }
      // Only a day that answered for some metrics says which ones the account lacks;
      // a day refused outright (not yet available) leaves the list as it was.
      if (accepted.length) supported = accepted;
    }
    if (found.size) days += 1;
    for (const [name, metricKey] of insightMetrics) {
      const value = found.get(name);
      if (value !== undefined) values.push({ metricKey, date: day, value });
    }
  }
  } catch (error) {
    return { values, days, failure: error as unknown };
  }
  return { values, days, failure: null as unknown };
}

/** {data:[{name, total_value:{value}}]} into name → value. An empty data set is unknown, not zero. */
export function insightTotals(payload: unknown) {
  const totals = new Map<string, number>();
  const data = record(payload).data;
  for (const item of Array.isArray(data) ? data : []) {
    const entry = record(item);
    const value = wholeCount(record(entry.total_value).value);
    if (typeof entry.name === "string" && value !== null) totals.set(entry.name, value);
  }
  return totals;
}

/**
 * Posts per UTC day over the last POST_DAYS (newest first). A page that fails
 * keeps the days already read in full (see countPerDay).
 */
async function readPostsPerDay(client: ProviderClient, token: string, accountId: string, today: string) {
  const firstDay = shiftDay(today, -(POST_DAYS - 1));
  const seen: string[] = [];
  let next: string | URL | null = withToken(`/${accountId}/media`, token, { fields: "timestamp", limit: "50" });
  const visited = new Set<string>();
  // Each post counts once, even if a misbehaving listing repeats a page.
  const counted = new Set<string>();
  let complete = false;
  let failure: unknown = null;
  for (let page = 0; page < MEDIA_PAGES && next; page += 1) {
    // A page seen before would count the same posts again.
    if (visited.has(String(next))) {
      failure = new Error("instagram_listing_loop");
      break;
    }
    visited.add(String(next));
    let payload: Record<string, unknown>;
    try {
      // The client only follows links on Instagram's own host.
      payload = record(await client.request(next));
    } catch (error) {
      failure = error;
      break;
    }
    if (!Array.isArray(payload.data)) {
      failure = new Error("instagram_listing_invalid");
      break;
    }
    let reachedOlder = false;
    for (const item of payload.data) {
      const identity = typeof record(item).id === "string" ? String(record(item).id) : JSON.stringify(item);
      if (counted.has(identity)) continue;
      counted.add(identity);
      // An unreadable timestamp is skipped; it never ends the listing early.
      const day = utcDayOf(record(item).timestamp);
      if (!day) continue;
      seen.push(day);
      if (day < firstDay) reachedOlder = true;
    }
    const link = record(payload.paging).next;
    next = !reachedOlder && typeof link === "string" && link ? link : null;
    if (!next) complete = true;
  }
  return { values: countPerDay("instagram.posts_published", firstDay, today, seen, complete), failure };
}

export function metaErrorCode(body: unknown) {
  const error = record(record(body).error);
  const code = typeof error.code === "number" ? error.code : null;
  if (code === null) return null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  return subcode ? `${code}_${subcode}` : String(code);
}

function isMetaRateLimit(code: string | null) {
  const main = code?.split("_")[0];
  return main === "4" || main === "17" || main === "32" || main === "613" || main === "80002";
}

function rejectionReason(error: unknown): ConnectorReason | null {
  if (!(error instanceof ProviderHttpError)) return null;
  const main = error.code?.split("_")[0] ?? null;
  if (main === "190") return error.code === "190_463" ? "token_expired" : "invalid_credentials";
  if (main === "10" || (main !== null && Number(main) >= 200 && Number(main) <= 299)) return "permission_missing";
  if (error.status === 401) return "invalid_credentials";
  if (error.status === 403) return "permission_missing";
  return null;
}

function partialReason(error: unknown): ConnectorReason | null {
  if (error instanceof ProviderStop) return error.reason === "rate_limited" ? "rate_limited" : "deadline";
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
