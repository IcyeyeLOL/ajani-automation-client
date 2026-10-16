import "server-only";

import {
  createProviderClient, ProviderHttpError, ProviderStop, type ProviderClient,
} from "@/lib/connectors/provider-http";
import {
  countPerDay, env, isCalendarDay, recordConnectorRun, shiftDay, STORE_MAX, utcDay, utcDayOf, wholeCount, writeValues,
  type ConnectorReason, type ConnectorResult, type MetricValue, type MetricWriter, type RunRecorder,
} from "@/lib/connectors/connector-store";

/**
 * YouTube, verified against Google's docs on 2026-10-16.
 *
 * Two levels, each switched on by its own settings:
 * - Public stats (YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID): Data API v3 channels.list
 *   and the uploads playlist. Subscribers (YouTube rounds them to three significant
 *   figures), all-time views and videos published per day. 1 quota unit per call.
 * - Private analytics (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN):
 *   the Analytics API, OAuth only. Daily views, watch hours, likes, comments, shares,
 *   subscribers gained and lost, and Shorts views. YouTube finishes a day 48-72 hours
 *   later, so every run re-reads the last week and replaces it.
 * Impressions and click-through rate are not in either API (they are in the
 * separate Reporting API's daily CSV files) and are not read here.
 */
const DATA_API = "https://youtube.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const HOSTS = ["youtube.googleapis.com", "youtubeanalytics.googleapis.com", "oauth2.googleapis.com"] as const;

export const YOUTUBE_ACTOR = "connector:youtube";
export const YOUTUBE_SETTINGS = {
  publicStats: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"],
  analytics: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
} as const;

const REQUEST_BUDGET = 16;
const WRITE_RESERVE_MS = 6_000;
/** Days of analytics re-read each run, ending yesterday. */
export const ANALYTICS_DAYS = 7;
/** Days of uploads counted each run, ending today. */
export const UPLOAD_DAYS = 14;
const UPLOAD_PAGES = 4;

type Settings = {
  apiKey: string | null;
  channel: { id: string } | { handle: string } | null;
  oauth: { clientId: string; clientSecret: string; refreshToken: string } | null;
};

export function youtubeSettings(source: Record<string, string | undefined> = process.env): Settings | null {
  const apiKey = env("YOUTUBE_API_KEY", source);
  const channelSetting = env("YOUTUBE_CHANNEL_ID", source);
  const clientId = env("YOUTUBE_CLIENT_ID", source);
  const clientSecret = env("YOUTUBE_CLIENT_SECRET", source);
  const refreshToken = env("YOUTUBE_REFRESH_TOKEN", source);
  const oauth = clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
  const channel = parseChannel(channelSetting);
  if (!oauth && !(apiKey && channel)) return null;
  return { apiKey, channel, oauth };
}

/** A UC… channel ID or an @handle; anything else (a URL, a display name) is not used. */
function parseChannel(value: string | null): Settings["channel"] {
  if (value && /^UC[A-Za-z0-9_-]{22}$/.test(value)) return { id: value };
  if (value && /^@?[A-Za-z0-9._-]{3,30}$/.test(value)) return { handle: value.replace(/^@/, "") };
  return null;
}

export function youtubeChannelValid(value: string | null) {
  return parseChannel(value) !== null;
}

export type YouTubeSyncOptions = {
  deadlineAt: number;
  now?: number;
  source?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  write?: MetricWriter;
  record?: RunRecorder;
};

export async function syncYouTubeMetrics(options: YouTubeSyncOptions): Promise<ConnectorResult> {
  const now = options.now ?? Date.now();
  const today = utcDay(now);
  const result: ConnectorResult = { connector: "youtube", status: "synced", reason: null, date: today, valuesWritten: 0, details: {} };
  const settings = youtubeSettings(options.source);
  if (!settings) return { ...result, status: "not_configured" };

  const client = createProviderClient({
    provider: "youtube",
    deadlineAt: options.deadlineAt - WRITE_RESERVE_MS,
    budget: REQUEST_BUDGET,
    allowedHosts: HOSTS,
    errorCode: googleErrorCode,
    isRateLimited: (status, code) => status === 403 && (code === "rateLimitExceeded" || code === "userRateLimitExceeded"),
    fetchImpl: options.fetchImpl,
  });
  const values: MetricValue[] = [];
  let reason: ConnectorReason | null = null;
  let rejected = false;

  try {
    let accessToken: string | null = null;
    if (settings.oauth) {
      try {
        accessToken = await refreshAccessToken(client, settings.oauth);
      } catch (error) {
        // A lapsed Google sign-in still leaves the public numbers when a key and channel are set.
        const rejection = rejectionReason(error);
        if (!rejection || !(settings.apiKey && settings.channel)) throw error;
        reason = rejection;
      }
    }
    const channel = await readChannel(client, settings, accessToken);
    if (!channel) return finish({ ...result, status: "rejected", reason: "account_not_found" }, options);
    values.push(...channel.values.map((item) => ({ ...item, date: today })));
    result.details.channelStats = channel.values.length;

    if (channel.uploadsPlaylist) {
      const uploads = await readUploadsPerDay(client, channel.uploadsPlaylist, settings, accessToken, today);
      values.push(...uploads.values);
      result.details.uploadDays = uploads.values.length;
      if (uploads.failure) reason ??= partialReason(uploads.failure) ?? rejectionReason(uploads.failure) ?? "failures";
    }

    if (accessToken) {
      try {
        const analytics = await readAnalytics(client, accessToken, today);
        values.push(...analytics.values);
        result.details.analyticsDays = analytics.days;
        if (analytics.failure) reason ??= partialReason(analytics.failure) ?? rejectionReason(analytics.failure) ?? "failures";
      } catch (error) {
        // Usually a sign-in without the yt-analytics.readonly scope; the public numbers above still count.
        reason ??= partialReason(error) ?? rejectionReason(error) ?? "failures";
      }
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

  const written = await writeValues(options.write, values, YOUTUBE_ACTOR, options.deadlineAt);
  if (written === null) return finish({ ...result, status: "partial", reason: "save_failed" }, options);
  result.valuesWritten = written;
  if (rejected) return finish({ ...result, status: "rejected", reason }, options);
  return finish(reason ? { ...result, status: "partial", reason } : result, options);
}

async function finish(result: ConnectorResult, options: YouTubeSyncOptions) {
  if (result.status !== "not_configured") await (options.record ?? recordConnectorRun)(result);
  return result;
}

async function refreshAccessToken(client: ProviderClient, oauth: NonNullable<Settings["oauth"]>) {
  const body = new URLSearchParams({
    client_id: oauth.clientId, client_secret: oauth.clientSecret, refresh_token: oauth.refreshToken, grant_type: "refresh_token",
  });
  const payload = record(await client.request(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  }));
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!token) throw new Error("youtube_token_missing");
  return token;
}

type ChannelRead = { values: Array<Omit<MetricValue, "date">>; uploadsPlaylist: string | null };

async function readChannel(client: ProviderClient, settings: Settings, accessToken: string | null): Promise<ChannelRead | null> {
  const url = new URL(`${DATA_API}/channels`);
  url.searchParams.set("part", "statistics,contentDetails");
  if (settings.channel && "id" in settings.channel) url.searchParams.set("id", settings.channel.id);
  else if (settings.channel && "handle" in settings.channel) url.searchParams.set("forHandle", settings.channel.handle);
  else url.searchParams.set("mine", "true");
  const payload = record(await client.request(url, { headers: authHeaders(settings, accessToken) }));
  // An empty list is an unknown channel, never a channel with no numbers.
  const first: unknown = Array.isArray(payload.items) ? payload.items[0] : undefined;
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const item = record(first);
  const statistics = record(item.statistics);
  const uploads = record(record(item.contentDetails).relatedPlaylists).uploads;
  const values: ChannelRead["values"] = [];
  // A hidden count is unknown, never zero.
  const subscribers = statistics.hiddenSubscriberCount === true ? null : wholeCount(statistics.subscriberCount);
  if (subscribers !== null) values.push({ metricKey: "youtube.subscribers", value: subscribers });
  const views = wholeCount(statistics.viewCount);
  if (views !== null) values.push({ metricKey: "youtube.total_views", value: views });
  return { values, uploadsPlaylist: typeof uploads === "string" && /^[A-Za-z0-9_-]{10,64}$/.test(uploads) ? uploads : null };
}

/**
 * Videos published per UTC day over the last UPLOAD_DAYS, from the uploads
 * playlist (newest first). Public videos only without sign-in. A page that
 * fails keeps the days already read in full (see countPerDay).
 */
async function readUploadsPerDay(client: ProviderClient, playlistId: string, settings: Settings, accessToken: string | null, today: string) {
  const firstDay = shiftDay(today, -(UPLOAD_DAYS - 1));
  const seen: string[] = [];
  let pageToken: string | null = null;
  const tokens = new Set<string>();
  // Each video counts once, even if a misbehaving listing repeats a page.
  const counted = new Set<string>();
  let complete = false;
  let failure: unknown = null;
  for (let page = 0; page < UPLOAD_PAGES; page += 1) {
    const url = new URL(`${DATA_API}/playlistItems`);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let payload: Record<string, unknown>;
    try {
      payload = record(await client.request(url, { headers: authHeaders(settings, accessToken) }));
    } catch (error) {
      failure = error;
      break;
    }
    if (!Array.isArray(payload.items)) {
      failure = new Error("youtube_listing_invalid");
      break;
    }
    let reachedOlder = false;
    for (const item of payload.items) {
      const details = record(record(item).contentDetails);
      const identity = typeof details.videoId === "string" ? details.videoId : JSON.stringify(item);
      if (counted.has(identity)) continue;
      counted.add(identity);
      // An unreadable date is skipped; it never ends the listing early.
      const day = utcDayOf(details.videoPublishedAt);
      if (!day) continue;
      seen.push(day);
      if (day < firstDay) reachedOlder = true;
    }
    const next = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null;
    if (reachedOlder || !next) {
      complete = true;
      break;
    }
    // A page token seen before would count the same uploads again.
    if (tokens.has(next)) {
      failure = new Error("youtube_listing_loop");
      break;
    }
    tokens.add(next);
    pageToken = next;
  }
  return { values: countPerDay("youtube.videos_published", firstDay, today, seen, complete), failure };
}

const analyticsMetrics = [
  ["views", "youtube.views"],
  ["estimatedMinutesWatched", "youtube.watch_hours"],
  ["likes", "youtube.likes"],
  ["comments", "youtube.comments"],
  ["shares", "youtube.shares"],
  ["subscribersGained", "youtube.subscribers_gained"],
  ["subscribersLost", "youtube.subscribers_lost"],
] as const;

async function readAnalytics(client: ProviderClient, accessToken: string, today: string) {
  const endDate = shiftDay(today, -1);
  const startDate = shiftDay(today, -ANALYTICS_DAYS);
  const headers = { authorization: `Bearer ${accessToken}` };
  const daily = analyticsTable(await client.request(analyticsUrl(startDate, endDate, analyticsMetrics.map(([name]) => name), "day"), { headers }));
  const values: MetricValue[] = [];
  const days = new Set<string>();
  // A day reported twice is ambiguous: neither row is trusted.
  const rowsPerDay = new Map<unknown, number>();
  for (const row of daily.rows) rowsPerDay.set(row.day, (rowsPerDay.get(row.day) ?? 0) + 1);
  for (const row of daily.rows) {
    const day = row.day;
    if (!isCalendarDay(day) || day < startDate || day > endDate || rowsPerDay.get(day) !== 1) continue;
    days.add(day);
    for (const [name, metricKey] of analyticsMetrics) {
      const raw = row[name];
      if (name === "estimatedMinutesWatched") {
        const hours = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.round((raw / 60) * 100) / 100 : null;
        if (hours !== null && hours < STORE_MAX) values.push({ metricKey, date: day, value: hours });
        continue;
      }
      const count = wholeCount(raw);
      if (count !== null) values.push({ metricKey, date: day, value: count });
    }
  }

  // Shorts are a split of the same views; a channel without Shorts simply has no SHORTS rows.
  // A failed split never costs the daily numbers above.
  let failure: unknown = null;
  try {
    const byType = analyticsTable(await client.request(analyticsUrl(startDate, endDate, ["views"], "day,creatorContentType"), { headers }));
    const shorts = new Map<string, number>();
    const unreadable = new Set<string>();
    for (const row of byType.rows) {
      if (typeof row.day !== "string" || !days.has(row.day)) continue;
      // A day the split covers is a fact: no SHORTS row means no Shorts views.
      if (!shorts.has(row.day)) shorts.set(row.day, 0);
      if (row.creatorContentType !== "SHORTS") continue;
      const count = wholeCount(row.views);
      if (count === null) unreadable.add(row.day);
      else shorts.set(row.day, (shorts.get(row.day) ?? 0) + count);
    }
    for (const [day, count] of shorts) if (!unreadable.has(day) && count < STORE_MAX) values.push({ metricKey: "youtube.shorts_views", date: day, value: count });
  } catch (error) {
    if (!(error instanceof ProviderHttpError && error.status === 400)) failure = error;
  }
  return { values, days: days.size, failure };
}

function analyticsUrl(startDate: string, endDate: string, metrics: string[], dimensions: string) {
  const url = new URL(ANALYTICS_API);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("metrics", metrics.join(","));
  url.searchParams.set("dimensions", dimensions);
  url.searchParams.set("sort", "day");
  return url;
}

/** columnHeaders + rows into named rows. A missing `rows` means no data, not zeros. */
export function analyticsTable(payload: unknown) {
  const body = record(payload);
  const headers = Array.isArray(body.columnHeaders) ? body.columnHeaders.map((header) => record(header).name) : [];
  if (!headers.every((name) => typeof name === "string")) throw new Error("youtube_analytics_invalid");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  return {
    rows: rows.filter(Array.isArray).map((row) => Object.fromEntries((headers as string[]).map((name, index) => [name, (row as unknown[])[index]]))),
  };
}

function authHeaders(settings: Settings, accessToken: string | null): Record<string, string> {
  // Keys go in a header, never the URL, so they cannot end up in a log line.
  if (accessToken) return { authorization: `Bearer ${accessToken}` };
  return settings.apiKey ? { "x-goog-api-key": settings.apiKey } : {};
}

export function googleErrorCode(body: unknown) {
  const error = record(body).error;
  if (typeof error === "string") return error; // OAuth token endpoint: "invalid_grant", "invalid_client"
  const errors = record(error).errors;
  const reason = Array.isArray(errors) ? record(errors[0]).reason : null;
  return typeof reason === "string" ? reason : null;
}

function rejectionReason(error: unknown): ConnectorReason | null {
  if (!(error instanceof ProviderHttpError)) return null;
  if (error.code === "invalid_grant") return "token_expired";
  if (error.code === "invalid_client" || error.code === "unauthorized_client") return "invalid_credentials";
  if (error.code === "quotaExceeded" || error.code === "dailyLimitExceeded") return "rate_limited";
  if (error.status === 401 || error.code === "keyInvalid" || error.code === "keyExpired" || (error.status === 400 && error.code === "badRequest")) return "invalid_credentials";
  if (error.status === 403) return error.code === "accessNotConfigured" ? "access_not_approved" : "permission_missing";
  if (error.status === 404) return "account_not_found";
  return null;
}

function partialReason(error: unknown): ConnectorReason | null {
  if (error instanceof ProviderStop) return error.reason === "rate_limited" ? "rate_limited" : "deadline";
  if (error instanceof ProviderHttpError && (error.code === "quotaExceeded" || error.code === "dailyLimitExceeded")) return "rate_limited";
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
