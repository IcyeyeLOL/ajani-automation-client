import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("tests must never reach the database"); } }));

import { POST } from "@/app/api/metrics/ingest/route";
import { wholeCount, type ConnectorResult, type MetricValue } from "@/lib/connectors/connector-store";
import type { CredentialStore, StoredCredential } from "@/lib/connectors/credential-vault";
import { parseIngestBody } from "@/lib/connectors/ingest";
import { INSTAGRAM_ACTOR, syncInstagramMetrics, tokenLineage, type InstagramSyncOptions } from "@/lib/connectors/instagram";
import { createProviderClient, ProviderStop, providerUrl, retryAfterMs } from "@/lib/connectors/provider-http";
import { syncYouTubeMetrics, YOUTUBE_ACTOR, type YouTubeSyncOptions } from "@/lib/connectors/youtube";

/**
 * Adversarial fake-provider tests. Every request goes through an injected
 * fetchImpl, every write through an injected writer, every run log through an
 * injected recorder, and Instagram always gets an explicit credential store.
 * Tests marked BUG fail because of a defect in the code under test.
 */

const NOW = Date.parse("2026-10-16T22:30:00Z");
const TODAY = "2026-10-16";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const rawJson = (text: string, status = 200) => new Response(text, { status, headers: { "content-type": "application/json" } });

/** A calendar day that exists (V8's Date.parse rolls 2026-09-31 into October, so check by round trip). */
function realDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10) === day;
}

/**
 * A writer that applies the same per-item checks as upsert_analytics_metric_values
 * (supabase/migrations/20261016010000_analytics_metric_store.sql:527-556): any bad
 * item raises, which fails the whole batch.
 */
const NOT_COUNTS = new Set(["youtube.watch_hours"]);
function storeLike(actor: string) {
  const attempted: MetricValue[] = [];
  const saved: MetricValue[] = [];
  const runs: ConnectorResult[] = [];
  const write = vi.fn(async (values: MetricValue[], who: string) => {
    if (who !== actor) throw new Error("wrong actor");
    attempted.push(...values);
    for (const item of values) {
      if (typeof item.value !== "number" || !Number.isFinite(item.value) || item.value < 0 || item.value >= 1e15) throw new Error("metric_write_failed");
      if (!NOT_COUNTS.has(item.metricKey) && !Number.isInteger(item.value)) throw new Error("metric_write_failed");
      if (!realDay(item.date)) throw new Error("metric_write_failed");
    }
    saved.push(...values);
    return values.length;
  });
  const record = vi.fn(async (result: ConnectorResult) => { runs.push(structuredClone(result)); });
  return { attempted, saved, runs, write, record };
}

const valueOf = (list: MetricValue[], metricKey: string, date = TODAY) =>
  list.find((item) => item.metricKey === metricKey && item.date === date)?.value;
const duplicatePairs = (list: MetricValue[]) => {
  const seen = new Map<string, number>();
  for (const item of list) {
    const key = `${item.metricKey}|${item.date}|${(item.dimension ?? "").trim().toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
};

/** A fetch that only settles when the client's abort signal fires, like a real fetch to a server that never answers. */
const neverAnswers = vi.fn((_input: URL | string, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
  const signal = init.signal;
  if (!signal) return;
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
}));

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const CHANNEL = "UC1234567890abcdefghijkl";
const UPLOADS = "UU1234567890abcdefghijkl";
const YT_KEY = "AIzaFAKE-adversarial-key-0001";
const YT_SECRET = "GOCSPX-adversarial-client-secret";
const YT_REFRESH = "1//adversarial-refresh-token";
const YT_ACCESS = "ya29.adversarial-access-token";
const PUBLIC = { YOUTUBE_API_KEY: YT_KEY, YOUTUBE_CHANNEL_ID: CHANNEL };
const OAUTH = { YOUTUBE_CLIENT_ID: "adversarial.apps.googleusercontent.com", YOUTUBE_CLIENT_SECRET: YT_SECRET, YOUTUBE_REFRESH_TOKEN: YT_REFRESH };
const YT_SECRETS = [YT_KEY, YT_SECRET, YT_REFRESH, YT_ACCESS];

type GoogleHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function fakeGoogle(routes: Record<string, GoogleHandler>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const route = routes[`${url.hostname}${url.pathname}`];
    if (!route) throw new Error(`unexpected request ${url.hostname}${url.pathname}`);
    return route(url, init);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const channelOk = (statistics: Record<string, unknown> = { subscriberCount: "1230", viewCount: "98765", hiddenSubscriberCount: false }): GoogleHandler =>
  () => json({ items: [{ id: CHANNEL, statistics, contentDetails: { relatedPlaylists: { uploads: UPLOADS } } }] });
const uploadsPage = (stamps: unknown[], nextPageToken?: string) =>
  json({ items: stamps.map((videoPublishedAt) => ({ contentDetails: { videoPublishedAt } })), nextPageToken });
const tokenOk: GoogleHandler = () => json({ access_token: YT_ACCESS, expires_in: 3599, token_type: "Bearer" });
const DAILY = ["day", "views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained", "subscribersLost"];
const dailyTable = (rows: unknown, headers = DAILY) => json({ columnHeaders: headers.map((name) => ({ name })), ...(rows === undefined ? {} : { rows }) });
const typeTable = (rows: unknown) => json({ columnHeaders: [{ name: "day" }, { name: "creatorContentType" }, { name: "views" }], ...(rows === undefined ? {} : { rows }) });
const analytics = (daily: () => Response, byType: () => Response = () => typeTable([])): GoogleHandler =>
  (url) => (url.searchParams.get("dimensions") === "day,creatorContentType" ? byType() : daily());

function youtubeRoutes(overrides: Partial<Record<"token" | "channel" | "uploads" | "analytics", GoogleHandler>> = {}) {
  return {
    "oauth2.googleapis.com/token": overrides.token ?? tokenOk,
    "youtube.googleapis.com/youtube/v3/channels": overrides.channel ?? channelOk(),
    "youtube.googleapis.com/youtube/v3/playlistItems": overrides.uploads ?? (() => uploadsPage([])),
    "youtubeanalytics.googleapis.com/v2/reports": overrides.analytics ?? analytics(() => dailyTable([])),
  };
}

async function runYouTube(routes: Record<string, GoogleHandler>, source: Record<string, string> = PUBLIC, extra: Partial<YouTubeSyncOptions> = {}) {
  const store = storeLike(YOUTUBE_ACTOR);
  const fake = fakeGoogle(routes);
  const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source, fetchImpl: fake.fetchImpl, write: store.write, record: store.record, ...extra });
  return { result, calls: fake.calls, ...store };
}

describe("YouTube under adversarial fake data", () => {
  // Regression (found and fixed 2026-10-16): readAnalytics rethrows any non-400 error from the Shorts split request, so the daily table it already parsed is thrown away.
  it("keeps the daily Analytics numbers when only the Shorts split request is rate-limited", async () => {
    const run = await runYouTube(youtubeRoutes({
      analytics: analytics(
        () => dailyTable([["2026-10-14", 400, 90, 20, 3, 2, 5, 1]]),
        () => json({ error: { code: 429, message: "slow down", errors: [{ reason: "rateLimitExceeded" }] } }, 429, { "retry-after": "0" }),
      ),
    }), OAUTH);
    expect(run.result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(valueOf(run.saved, "youtube.views", "2026-10-14")).toBe(400);
  });

  // Regression (found and fixed 2026-10-16): wholeCount accepts safe integers up to 2^53, but the store refuses values >= 1e15, so one huge count fails the whole batch (save_failed) and every fact is lost.
  it("skips an Analytics count the store would refuse instead of losing the whole run", async () => {
    const run = await runYouTube(youtubeRoutes({
      analytics: analytics(() => dailyTable([["2026-10-14", 2_000_000_000_000_000, 90, 20, 3, 2, 5, 1], ["2026-10-15", 10, 60, 1, 0, 0, 0, 0]])),
    }), { ...PUBLIC, ...OAUTH });
    expect(run.result.reason).not.toBe("save_failed");
    expect(valueOf(run.saved, "youtube.subscribers")).toBe(1230);
    expect(valueOf(run.saved, "youtube.views", "2026-10-15")).toBe(10);
  });

  // Regression (found and fixed 2026-10-16): estimatedMinutesWatched has no upper bound; 1e300 minutes becomes ~1.7e298 hours, which the store refuses, failing the whole save.
  it("skips absurd watch time instead of losing the whole run", async () => {
    const run = await runYouTube(youtubeRoutes({
      analytics: analytics(() => dailyTable([["2026-10-14", 400, 1e300, 20, 3, 2, 5, 1]])),
    }), { ...PUBLIC, ...OAUTH });
    expect(run.result.reason).not.toBe("save_failed");
    expect(valueOf(run.saved, "youtube.views", "2026-10-14")).toBe(400);
    expect(valueOf(run.attempted, "youtube.watch_hours", "2026-10-14")).toBeUndefined();
  });

  // Regression (found and fixed 2026-10-16): the Analytics day check is a shape regex plus a string range, so a day that does not exist (2026-09-31) inside the window is written and the store refuses the batch.
  it("skips an Analytics row dated on a day that does not exist", async () => {
    const run = await runYouTube(youtubeRoutes({
      analytics: analytics(() => dailyTable([["2026-09-31", 5, 60, 1, 0, 0, 0, 0], ["2026-09-30", 7, 60, 1, 0, 0, 0, 0]])),
    }), { ...PUBLIC, ...OAUTH }, { now: Date.parse("2026-10-03T12:00:00Z") });
    expect(run.attempted.some((item) => item.date === "2026-09-31")).toBe(false);
    expect(run.result.reason).not.toBe("save_failed");
    expect(valueOf(run.saved, "youtube.views", "2026-09-30")).toBe(7);
  });

  // Regression (found and fixed 2026-10-16): a repeated day row is pushed twice, so the same metric/date reaches the store twice and the stored value depends on row order.
  it("writes each Analytics metric/date once even when the report repeats a day", async () => {
    const run = await runYouTube(youtubeRoutes({
      analytics: analytics(() => dailyTable([["2026-10-14", 400, 90, 20, 3, 2, 5, 1], ["2026-10-14", 999, 30, 1, 1, 1, 1, 1]])),
    }), OAUTH);
    expect(duplicatePairs(run.attempted)).toEqual([]);
  });

  // Regression (found and fixed 2026-10-16): a nextPageToken that never advances re-reads the same page; the same videos are counted once per page (up to 4x).
  it("does not count the same uploads again when the page token loops", async () => {
    const run = await runYouTube(youtubeRoutes({
      uploads: () => uploadsPage(["2026-10-16T15:00:00Z", "2026-10-15T15:00:00Z", "2026-10-14T15:00:00Z"], "SAME_TOKEN"),
    }));
    expect([undefined, 1]).toContain(valueOf(run.attempted, "youtube.videos_published", "2026-10-16"));
    expect([undefined, 1]).toContain(valueOf(run.attempted, "youtube.videos_published", "2026-10-15"));
  });

  // Regression (found and fixed 2026-10-16): videoPublishedAt.slice(0, 10) takes the local calendar date of an offset timestamp, not its UTC day.
  it("counts uploads on their UTC day when the timestamp carries an offset", async () => {
    const run = await runYouTube(youtubeRoutes({
      // 2026-10-16T20:00Z and 2026-10-16T03:00Z, then an old video that ends the listing.
      uploads: () => uploadsPage(["2026-10-17T01:00:00+05:00", "2026-10-15T22:00:00-05:00", "2026-09-01T00:00:00Z"]),
    }));
    expect(valueOf(run.attempted, "youtube.videos_published", "2026-10-16")).toBe(2);
    expect(valueOf(run.attempted, "youtube.videos_published", "2026-10-15")).toBe(0);
  });

  // Regression (found and fixed 2026-10-16): "2026-00-00T…" passes the shape check, sorts before the window, and marks the listing complete, so days on the unread page are written as 0.
  it("does not treat an invalid publish date as the end of the listing", async () => {
    const run = await runYouTube(youtubeRoutes({
      uploads: (url) => (url.searchParams.get("pageToken") === "P2"
        ? uploadsPage(["2026-10-12T15:00:00Z", "2026-09-01T00:00:00Z"])
        : uploadsPage(["2026-10-16T15:00:00Z", "2026-00-00T00:00:00Z"], "P2")),
    }));
    expect(valueOf(run.attempted, "youtube.videos_published", "2026-10-12")).not.toBe(0);
  });

  // Regression (found and fixed 2026-10-16): a body that stalls after the headers times out inside readCapped, outside the fetch try/catch, so the run reports "failures" instead of "deadline".
  it("reports a body that stalls until the deadline as a deadline", async () => {
    const stalled = vi.fn(async (_input: URL | string, init: RequestInit = {}) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{\"items\":["));
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const store = storeLike(YOUTUBE_ACTOR);
    const started = Date.now();
    const result = await syncYouTubeMetrics({
      deadlineAt: Date.now() + 6_000 + 1_500, now: NOW, source: PUBLIC,
      fetchImpl: stalled as unknown as typeof fetch, write: store.write, record: store.record,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ status: "partial", reason: "deadline" });
  }, 15_000);

  it("stops within the deadline when the provider never answers", async () => {
    const store = storeLike(YOUTUBE_ACTOR);
    const started = Date.now();
    const result = await syncYouTubeMetrics({
      deadlineAt: Date.now() + 6_000 + 1_500, now: NOW, source: PUBLIC,
      fetchImpl: neverAnswers as unknown as typeof fetch, write: store.write, record: store.record,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ status: "partial", reason: "deadline", valuesWritten: 0 });
    expect(store.runs).toEqual([result]);
  }, 15_000);

  it("never stores malformed public counts", async () => {
    const malformed: unknown[] = ["1e21", "12.5", "-3", " 42", "42 ", "0x10", "", "١٢", 2 ** 60, 12.5, -3, null, true, [], {}, "9999999999999999"];
    for (const bad of malformed) {
      const run = await runYouTube(youtubeRoutes({ channel: channelOk({ subscriberCount: bad, viewCount: bad, hiddenSubscriberCount: false }) }));
      expect(valueOf(run.attempted, "youtube.subscribers"), JSON.stringify(bad)).toBeUndefined();
      expect(valueOf(run.attempted, "youtube.total_views"), JSON.stringify(bad)).toBeUndefined();
      expect(run.result.status, JSON.stringify(bad)).toBe("synced");
    }
    const hidden = await runYouTube(youtubeRoutes({ channel: channelOk({ subscriberCount: "0", viewCount: "10", hiddenSubscriberCount: true }) }));
    expect(valueOf(hidden.attempted, "youtube.subscribers")).toBeUndefined();
  });

  it("maps Analytics columns by name when Google reorders, adds or drops columns", async () => {
    const headers = ["likes", "extraMetric", "views", "day", "estimatedMinutesWatched"];
    const run = await runYouTube(youtubeRoutes({
      analytics: analytics(() => dailyTable([[20, "?", 400, "2026-10-14", 90], [5, "?", 50, "2026-10-15"]], headers)),
    }), OAUTH);
    expect(valueOf(run.saved, "youtube.likes", "2026-10-14")).toBe(20);
    expect(valueOf(run.saved, "youtube.views", "2026-10-14")).toBe(400);
    expect(valueOf(run.saved, "youtube.watch_hours", "2026-10-14")).toBe(1.5);
    // A short row and a missing column are unknown, never zero.
    expect(valueOf(run.saved, "youtube.watch_hours", "2026-10-15")).toBeUndefined();
    expect(valueOf(run.saved, "youtube.comments", "2026-10-14")).toBeUndefined();
    expect(valueOf(run.saved, "youtube.shares", "2026-10-14")).toBeUndefined();
  });

  it("treats rows: null as no data and ignores split rows for days the daily table lacks", async () => {
    const empty = await runYouTube(youtubeRoutes({ analytics: analytics(() => dailyTable(null), () => typeTable(null)) }), OAUTH);
    expect(empty.result.status).toBe("synced");
    expect(empty.attempted.filter((item) => item.metricKey !== "youtube.subscribers" && item.metricKey !== "youtube.total_views" && item.metricKey !== "youtube.videos_published")).toEqual([]);

    const orphan = await runYouTube(youtubeRoutes({
      analytics: analytics(
        () => dailyTable([["2026-10-14", 400, 90, 20, 3, 2, 5, 1]]),
        () => typeTable([["2026-10-12", "SHORTS", 77], ["2026-10-16", "SHORTS", 5], ["2026-10-14", "SHORTS", 150], ["2026-10-14", "SHORTS", "x"]]),
      ),
    }), OAUTH);
    const shorts = orphan.attempted.filter((item) => item.metricKey === "youtube.shorts_views");
    expect(shorts.some((item) => item.date === "2026-10-12" || item.date === TODAY)).toBe(false);
    // One unreadable SHORTS row makes the day's Shorts total unknown.
    expect(valueOf(orphan.attempted, "youtube.shorts_views", "2026-10-14")).toBeUndefined();
  });

  it("finds no channel, without throwing, when items holds non-objects", async () => {
    for (const items of [[null], ["UC"], [[{ statistics: { viewCount: "1" } }]], "not-a-list", [42]]) {
      const run = await runYouTube(youtubeRoutes({ channel: () => json({ items }) }));
      expect(run.result, JSON.stringify(items)).toMatchObject({ status: "rejected", reason: "account_not_found", valuesWritten: 0 });
      expect(run.attempted).toEqual([]);
    }
  });

  it("keeps UTC day boundaries at exactly midnight and one millisecond before", async () => {
    for (const [now, today, first, end] of [
      [Date.parse("2026-10-16T00:00:00.000Z"), "2026-10-16", "2026-10-03", "2026-10-15"],
      [Date.parse("2026-10-16T23:59:59.999Z"), "2026-10-16", "2026-10-03", "2026-10-15"],
    ] as const) {
      const run = await runYouTube(youtubeRoutes({
        uploads: () => uploadsPage([`${today}T00:00:00Z`, `${first}T00:00:00Z`, "2026-10-02T23:59:59Z"]),
        analytics: analytics(() => dailyTable([[today, 9, 60, 1, 1, 1, 1, 1], [end, 4, 60, 1, 1, 1, 1, 1]])),
      }), { ...PUBLIC, ...OAUTH }, { now });
      const reports = run.calls.filter((call) => call.url.hostname === "youtubeanalytics.googleapis.com");
      expect(reports[0].url.searchParams.get("endDate")).toBe(end);
      expect(reports[0].url.searchParams.get("startDate")).toBe("2026-10-09");
      expect(run.attempted.some((item) => item.date === today && item.metricKey === "youtube.views")).toBe(false);
      const uploads = run.attempted.filter((item) => item.metricKey === "youtube.videos_published");
      expect(uploads.map((item) => item.date)[0]).toBe(first);
      expect(uploads).toHaveLength(14);
      expect(valueOf(uploads, "youtube.videos_published", today)).toBe(1);
      expect(valueOf(uploads, "youtube.videos_published", first)).toBe(1);
      expect(run.result.date).toBe(today);
    }
  });

  it("never follows a redirect and never leaves Google's hosts", async () => {
    const run = await runYouTube(youtubeRoutes({
      channel: () => new Response(null, { status: 302, headers: { location: "https://evil.test/collect" } }),
    }));
    expect(run.calls.every((call) => call.init.redirect === "error")).toBe(true);
    expect(run.calls.every((call) => ["youtube.googleapis.com", "youtubeanalytics.googleapis.com", "oauth2.googleapis.com"].includes(call.url.hostname))).toBe(true);
    expect(run.result.status).not.toBe("synced");
  });

  it("keeps every secret out of the result and the run log, whatever Google echoes", async () => {
    const echo = (status: number, reason: string) => () => json({ error: { code: status, message: `${YT_KEY} ${YT_ACCESS} ${YT_SECRET}`, errors: [{ reason, message: YT_REFRESH }] } }, status);
    const scenarios: Array<Record<string, GoogleHandler>> = [
      youtubeRoutes({ token: echo(400, "invalid_grant") }),
      youtubeRoutes({ token: () => json({ error: YT_KEY.replace(/-/g, "_") }, 400) }),
      youtubeRoutes({ channel: echo(400, YT_KEY) }),
      youtubeRoutes({ uploads: echo(403, YT_ACCESS) }),
      youtubeRoutes({ analytics: echo(403, "insufficientPermissions") }),
      youtubeRoutes({ analytics: analytics(() => dailyTable([]), echo(500, "backendError")) }),
    ];
    for (const routes of scenarios) {
      const run = await runYouTube(routes, { ...PUBLIC, ...OAUTH });
      const text = JSON.stringify([run.result, run.runs]);
      for (const secret of YT_SECRETS) expect(text).not.toContain(secret);
    }
  });

  it("gives up at once on a huge Retry-After and stays bounded on a 429 storm", async () => {
    const huge = await runYouTube(youtubeRoutes({ channel: () => json({}, 429, { "retry-after": "99999999999" }) }));
    expect(huge.result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(huge.calls).toHaveLength(1);

    const negative = await runYouTube(youtubeRoutes({ channel: () => json({}, 429, { "retry-after": "-5" }) }));
    expect(negative.result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(negative.calls).toHaveLength(3);

    const storm = await runYouTube(youtubeRoutes({
      token: () => json({}, 429, { "retry-after": "0" }),
      channel: () => json({}, 429, { "retry-after": "0" }),
    }), { ...PUBLIC, ...OAUTH });
    expect(storm.calls.length).toBeLessThanOrEqual(16);
    expect(storm.result.status).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

const IG_TOKEN = "IGAAadversarial-setting-token-0001";
const IG_SOURCE = { INSTAGRAM_ACCESS_TOKEN: IG_TOKEN };
const ACCOUNT = "17841400000000001";
const RENEWED = "IGAAadversarial-renewed-token-0002";
const metaError = (code: number, subcode?: number, status = 400, headers: Record<string, string> = {}) =>
  json({ error: { message: `Error validating access token: ${IG_TOKEN}`, type: "OAuthException", code, error_subcode: subcode } }, status, headers);
const sinceDay = (url: URL) => new Date(Number(url.searchParams.get("since")) * 1000).toISOString().slice(0, 10);

type IgHandler = (url: URL) => Response | Promise<Response>;
const meOk: IgHandler = () => json({ user_id: ACCOUNT, username: "ajani.ai", followers_count: 842, media_count: 51 });
/** Each metric's value encodes its day and position: day-of-month × 10 + index. */
const insightsOk: IgHandler = (url) => {
  const requested = (url.searchParams.get("metric") ?? "").split(",");
  const day = new Date(Number(url.searchParams.get("since")) * 1000).getUTCDate();
  return json({ data: requested.map((name, index) => ({ name, period: "day", total_value: { value: day * 10 + index } })) });
};
const mediaPage = (stamps: unknown[], next?: string) =>
  // Real media IDs are unique; these are unique per timestamp and position, so a repeated page repeats its IDs.
  json({ data: stamps.map((timestamp, index) => ({ id: `${index}-${String(timestamp)}`, timestamp })), paging: next ? { next } : {} });
const refreshOk: IgHandler = () => json({ access_token: RENEWED, token_type: "bearer", expires_in: 5_184_000 });

function instagramRoutes(overrides: Partial<Record<"refresh" | "me" | "insights" | "media", IgHandler>> = {}): IgHandler {
  return (url) => {
    if (url.pathname === "/refresh_access_token") return (overrides.refresh ?? refreshOk)(url);
    if (url.pathname === "/v25.0/me") return (overrides.me ?? meOk)(url);
    if (url.pathname === `/v25.0/${ACCOUNT}/insights`) return (overrides.insights ?? insightsOk)(url);
    if (url.pathname === `/v25.0/${ACCOUNT}/media`) return (overrides.media ?? (() => mediaPage([])))(url);
    return metaError(100);
  };
}

function fakeInstagram(handler: IgHandler) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.hostname !== "graph.instagram.com") throw new Error(`left Instagram: ${url.hostname}`);
    return handler(url);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function memoryStore(initial: StoredCredential | null = null): { store: CredentialStore; saves: Array<{ token: string; expiresAt: string | null }> } {
  let stored = initial;
  const saves: Array<{ token: string; expiresAt: string | null }> = [];
  return {
    saves,
    store: {
      load: vi.fn(async () => stored),
      save: vi.fn(async (_connector, token: string, expiresAt: string | null) => {
        saves.push({ token, expiresAt });
        stored = { token, expiresAt, updatedAt: new Date(NOW).toISOString() };
      }),
    },
  };
}

async function runInstagram(handler: IgHandler, extra: Partial<InstagramSyncOptions> = {}) {
  const store = storeLike(INSTAGRAM_ACTOR);
  const fake = fakeInstagram(handler);
  const result = await syncInstagramMetrics({
    deadlineAt: Date.now() + 50_000, now: NOW, source: IG_SOURCE, credentials: null,
    fetchImpl: fake.fetchImpl, write: store.write, record: store.record, ...extra,
  });
  return { result, calls: fake.calls, ...store };
}

describe("Instagram under adversarial fake data", () => {
  // Regression (found and fixed 2026-10-16): readInsights keeps values in a local array and throws on a later day's failure, so days already read are discarded.
  it("keeps insight days already read when a later day is rate-limited", async () => {
    const run = await runInstagram(instagramRoutes({
      insights: (url) => (sinceDay(url) === "2026-10-15" ? json({ error: { code: 4, message: "limit" } }, 429, { "retry-after": "0" }) : insightsOk(url)),
    }));
    expect(run.result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(valueOf(run.saved, "instagram.reach", "2026-10-13")).toBe(130);
    expect(valueOf(run.saved, "instagram.reach", "2026-10-14")).toBe(140);
  });

  // Regression (found and fixed 2026-10-16): a 400 for one day's window marks every metric "unsupported", so the remaining days are never requested and the run still reports synced.
  it("still reads later days when the first day's window is refused", async () => {
    const run = await runInstagram(instagramRoutes({
      insights: (url) => (sinceDay(url) === "2026-10-13" ? metaError(100) : insightsOk(url)),
    }));
    expect(valueOf(run.saved, "instagram.reach", "2026-10-15")).toBe(150);
    expect(valueOf(run.saved, "instagram.reach", "2026-10-14")).toBe(140);
  });

  // Regression (found and fixed 2026-10-16): wholeCount accepts 5e15 (a safe integer) but the store refuses >= 1e15, so one huge insight fails the whole save.
  it("skips an insight value the store would refuse instead of losing the whole run", async () => {
    const run = await runInstagram(instagramRoutes({
      insights: (url) => json({ data: [{ name: "reach", total_value: { value: 5_000_000_000_000_000 } }, { name: "views", total_value: { value: sinceDay(url) === "2026-10-15" ? 77 : 1 } }] }),
    }));
    expect(run.result.reason).not.toBe("save_failed");
    expect(valueOf(run.saved, "instagram.followers")).toBe(842);
    expect(valueOf(run.saved, "instagram.views", "2026-10-15")).toBe(77);
  });

  // Regression (found and fixed 2026-10-16): a paging.next that loops to the same page is followed until MEDIA_PAGES, and the same posts are counted once per page (3x).
  it("does not count the same posts again when paging.next loops", async () => {
    const page = () => mediaPage(["2026-10-16T09:00:00+0000", "2026-10-15T09:00:00+0000", "2026-10-14T09:00:00+0000"],
      `https://graph.instagram.com/v25.0/${ACCOUNT}/media?fields=timestamp&limit=50&after=SAME&access_token=${IG_TOKEN}`);
    const run = await runInstagram(instagramRoutes({ media: page }));
    expect([undefined, 1]).toContain(valueOf(run.attempted, "instagram.posts_published", "2026-10-16"));
    expect([undefined, 1]).toContain(valueOf(run.attempted, "instagram.posts_published", "2026-10-15"));
  });

  // Regression (found and fixed 2026-10-16): Date.parse is lenient ("garbage 3" parses as 2001-03-01), so a malformed timestamp reads as an old post, ends the listing, and unread days are written as 0.
  it("does not treat a malformed timestamp as the end of the listing", async () => {
    let pages = 0;
    const run = await runInstagram(instagramRoutes({
      media: (url) => {
        pages += 1;
        return url.searchParams.get("after") === "P2"
          ? mediaPage(["2026-10-12T09:00:00+0000", "2026-09-01T09:00:00+0000"])
          : mediaPage(["2026-10-16T09:00:00+0000", "garbage 3"], `https://graph.instagram.com/v25.0/${ACCOUNT}/media?after=P2`);
      },
    }));
    expect(valueOf(run.attempted, "instagram.posts_published", "2026-10-12")).not.toBe(0);
    expect(pages).toBe(2);
  });

  // Regression (found and fixed 2026-10-16): readAccount accepts a numeric user_id; Instagram IDs exceed 2^53, so JSON.parse rounds 17841400000000001 to …000 and every read targets another account.
  it("never reads a different account because a numeric ID lost precision", async () => {
    const run = await runInstagram((url) => (url.pathname === "/v25.0/me"
      ? rawJson(`{"user_id":${ACCOUNT},"username":"ajani.ai","followers_count":842}`)
      : instagramRoutes()(url)));
    const accountCalls = run.calls.filter((call) => /^\/v25\.0\/\d+\//.test(call.url.pathname));
    expect(accountCalls.every((call) => call.url.pathname.startsWith(`/v25.0/${ACCOUNT}/`))).toBe(true);
  });

  // Regression (found and fixed 2026-10-16): providerUrl checks hostname only, so a paging link on another port of graph.instagram.com is followed with the token in it.
  it("does not follow a paging link to another port", async () => {
    const run = await runInstagram(instagramRoutes({
      media: (url) => (url.port
        ? mediaPage(["2026-10-01T09:00:00+0000"])
        : mediaPage(["2026-10-16T09:00:00+0000"], `https://graph.instagram.com:8443/v25.0/${ACCOUNT}/media?after=x&access_token=${IG_TOKEN}`)),
    }));
    expect(run.calls.filter((call) => call.url.port !== "")).toEqual([]);
  });

  // Regression (found and fixed 2026-10-16): expires_in is trusted up to 2^53 seconds; 1e12 s stores an expiry ~31,700 years out, so the token is never renewed again and lapses after 60 days.
  it("does not store an impossible token expiry", async () => {
    const vault = memoryStore();
    await runInstagram(instagramRoutes({ refresh: () => json({ access_token: RENEWED, token_type: "bearer", expires_in: 1e12 }) }), { credentials: vault.store });
    const expiresAt = vault.saves[0]?.expiresAt ?? null;
    if (expiresAt !== null) expect(Date.parse(expiresAt) - NOW).toBeLessThanOrEqual(90 * 86_400_000);
  });

  it("puts posts on their UTC day whether Meta writes +0000, Z or another offset, at both ends of a day", async () => {
    for (const now of [Date.parse("2026-10-16T00:00:00.000Z"), Date.parse("2026-10-16T23:59:59.999Z")]) {
      const run = await runInstagram(instagramRoutes({
        media: () => mediaPage([
          "2026-10-17T00:00:00+0000", // tomorrow (clock skew): outside the window
          "2026-10-15T23:30:00-0100", // 2026-10-16T00:30Z
          "2026-10-16T00:00:00Z",
          "2026-10-15T23:59:59+0000",
          "2026-10-03T00:00:00+0000",
          "2026-10-02T23:59:59+0000",
        ]),
      }), { now });
      const posts = run.attempted.filter((item) => item.metricKey === "instagram.posts_published");
      expect(posts).toHaveLength(14);
      expect(valueOf(posts, "instagram.posts_published", "2026-10-16")).toBe(2);
      expect(valueOf(posts, "instagram.posts_published", "2026-10-15")).toBe(1);
      expect(valueOf(posts, "instagram.posts_published", "2026-10-03")).toBe(1);
      expect(posts.some((item) => item.date === "2026-10-02" || item.date === "2026-10-17")).toBe(false);
      const windows = run.calls.filter((call) => call.url.pathname.endsWith("/insights")).map((call) => sinceDay(call.url));
      expect(windows).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
    }
  });

  it("keeps odd insight answers from becoming duplicates, zeros or garbage", async () => {
    const run = await runInstagram(instagramRoutes({
      insights: () => json({ data: [
        { name: "reach", total_value: { value: 5 } },
        { name: "reach", total_value: { value: 6 } },
        { name: "follower_count", total_value: { value: 9 } },
        { name: "views", total_value: { value: 1.5 } },
        { name: "likes", total_value: { value: -1 } },
        { name: "comments", total_value: { value: "1e3" } },
        { name: "shares", total_value: {} },
        { name: "saves", total_value: { value: null } },
        { name: "total_interactions", values: [{ value: 3 }] },
        "not-an-object",
        null,
      ] }),
    }));
    expect(duplicatePairs(run.attempted)).toEqual([]);
    for (const key of ["instagram.views", "instagram.likes", "instagram.comments", "instagram.shares", "instagram.saves", "instagram.interactions"]) {
      expect(run.attempted.some((item) => item.metricKey === key), key).toBe(false);
    }
    expect(run.attempted.every((item) => item.metricKey.startsWith("instagram."))).toBe(true);
    expect(run.result.status).toBe("synced");
  });

  it("never follows paging links off Instagram's HTTPS host, and keeps only certain days", async () => {
    for (const link of [
      `http://graph.instagram.com/v25.0/${ACCOUNT}/media?after=x&access_token=${IG_TOKEN}`,
      `https://graph.instagram.com.evil.test/v25.0/${ACCOUNT}/media?access_token=${IG_TOKEN}`,
      `https://evil.test@graph.instagram.com.evil.test/?access_token=${IG_TOKEN}`,
      `https://user:pw@graph.instagram.com/v25.0/${ACCOUNT}/media`,
      `/v25.0/${ACCOUNT}/media?after=x`,
      `javascript:alert(1)`,
    ]) {
      const run = await runInstagram(instagramRoutes({ media: () => mediaPage(["2026-10-16T09:00:00+0000", "2026-10-14T09:00:00+0000"], link) }));
      expect(run.calls.every((call) => call.url.protocol === "https:" && call.url.hostname === "graph.instagram.com" && !call.url.username), link).toBe(true);
      expect(run.result, link).toMatchObject({ status: "partial", reason: "failures" });
      expect(run.attempted.filter((item) => item.metricKey === "instagram.posts_published").map((item) => [item.date, item.value]), link)
        .toEqual([["2026-10-15", 0], ["2026-10-16", 1]]);
    }
  });

  it("survives a garbage, expired or foreign credential store and never leaks a token", async () => {
    const lineage = tokenLineage(IG_TOKEN);
    const STORED = "IGAAadversarial-stored-token-0003";
    const cases: Array<[string, StoredCredential | null, string]> = [
      ["not JSON", { token: "not json", expiresAt: "garbage", updatedAt: "" }, IG_TOKEN],
      ["token not a string", { token: JSON.stringify({ token: 42, lineage }), expiresAt: null, updatedAt: "" }, IG_TOKEN],
      ["JSON null", { token: "null", expiresAt: null, updatedAt: "" }, IG_TOKEN],
      ["other lineage, far expiry", { token: JSON.stringify({ token: STORED, lineage: tokenLineage("IGAAsomeone-else") }), expiresAt: new Date(NOW + 50 * 86_400_000).toISOString(), updatedAt: "" }, IG_TOKEN],
      ["expired, same lineage", { token: JSON.stringify({ token: STORED, lineage }), expiresAt: new Date(NOW - 86_400_000).toISOString(), updatedAt: "" }, STORED],
      ["garbage expiry, same lineage", { token: JSON.stringify({ token: STORED, lineage }), expiresAt: "soon", updatedAt: "" }, STORED],
    ];
    for (const [label, stored, refreshedWith] of cases) {
      const vault = memoryStore(stored);
      const run = await runInstagram(instagramRoutes(), { credentials: vault.store });
      expect(run.result.status, label).toBe("synced");
      expect(run.calls.find((call) => call.url.pathname === "/refresh_access_token")?.url.searchParams.get("access_token"), label).toBe(refreshedWith);
      const text = JSON.stringify([run.result, run.runs]);
      for (const secret of [IG_TOKEN, STORED, RENEWED]) expect(text, label).not.toContain(secret);
    }
    const throwing: CredentialStore = { load: vi.fn(async () => { throw new Error(`vault down ${IG_TOKEN}`); }), save: vi.fn() };
    const broken = await runInstagram(instagramRoutes(), { credentials: throwing });
    expect(broken.result.status).toBe("synced");
    expect(JSON.stringify([broken.result, broken.runs])).not.toContain(IG_TOKEN);
  });

  it("keeps Meta's error text, and the token in it, out of every outcome", async () => {
    const scenarios: IgHandler[] = [
      instagramRoutes({ me: () => metaError(190, 463) }),
      instagramRoutes({ insights: () => metaError(10, undefined, 403) }),
      instagramRoutes({ media: () => metaError(1, undefined, 500) }),
      instagramRoutes({ me: () => metaError(4, undefined, 400, { "retry-after": "0" }) }),
      instagramRoutes({ me: () => new Response(`<html>${IG_TOKEN}</html>`, { status: 200 }) }),
    ];
    for (const handler of scenarios) {
      const run = await runInstagram(handler);
      expect(JSON.stringify([run.result, run.runs])).not.toContain(IG_TOKEN);
      expect(run.runs).toHaveLength(1);
    }
  });

  it("stays within its request budget during a 429 storm", async () => {
    const run = await runInstagram(() => json({ error: { code: 4, message: "limit" } }, 429, { "retry-after": "0" }), { credentials: memoryStore().store });
    expect(run.result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(run.calls.length).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// Shared HTTP client and store helpers
// ---------------------------------------------------------------------------

describe("provider client and helpers under attack", () => {
  // Regression (found and fixed 2026-10-16): providerUrl compares url.hostname only, so any port on an allowed hostname is accepted.
  it("refuses a non-default port on an allowed host", () => {
    expect(() => providerUrl("https://graph.instagram.com:8443/v25.0/me", ["graph.instagram.com"])).toThrow("provider_url_not_allowed");
  });

  // Regression (found and fixed 2026-10-16): wholeCount's contract is "a whole, non-negative number the store accepts", but it returns values the store refuses (>= 1e15).
  it("wholeCount returns only numbers the store accepts", () => {
    expect(wholeCount(1e15)).toBeNull();
    expect(wholeCount(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("wholeCount refuses every other malformed shape", () => {
    for (const bad of ["1e21", "12.5", "-3", " 42", "42\n", "0x10", "", "١٢", "４２", 2 ** 60, 12.5, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, true, {}, [], "9999999999999999"]) {
      expect(wholeCount(bad), String(bad)).toBeNull();
    }
    expect(wholeCount("0")).toBe(0);
    expect(wholeCount(0)).toBe(0);
  });

  it("refuses look-alike hosts, other schemes and credentials in the URL", () => {
    const hosts = ["graph.instagram.com"];
    for (const bad of [
      "https://graph.instagram.com./v25.0/me",
      "https://graph.instagram.com%2eevil.test/",
      "https://graph.instagram.com.evil.test/",
      "https://evil.test/https://graph.instagram.com/",
      "http://graph.instagram.com/",
      "wss://graph.instagram.com/",
      "https://a:b@graph.instagram.com/",
      "https://[::1]/",
    ]) expect(() => providerUrl(bad, hosts), bad).toThrow();
    expect(providerUrl("https://GRAPH.Instagram.COM/v25.0/me", hosts).hostname).toBe("graph.instagram.com");
  });

  it("reads Retry-After defensively", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(retryAfterMs("-5", now)).toBeGreaterThanOrEqual(0);
    expect(retryAfterMs("1e400", now)).toBe(5_000);
    expect(retryAfterMs("Infinity", now)).toBe(5_000);
    expect(retryAfterMs("Thu, 01 Jan 1970 00:00:00 GMT", now)).toBe(0);
  });

  it("stops reading an endless body without a content-length at the cap", async () => {
    let pulls = 0;
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(64 * 1024).fill(32)); },
    })));
    const http = createProviderClient({ provider: "fake", deadlineAt: Date.now() + 30_000, budget: 3, allowedHosts: ["api.example.test"], fetchImpl: fetchImpl as unknown as typeof fetch, maxResponseBytes: 1_000_000 });
    await expect(http.request("https://api.example.test/a")).rejects.toThrow("fake_response_too_large");
    expect(pulls).toBeLessThan(40);
  });

  it("stops at the request budget during a 429 storm", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429, { "retry-after": "0" }));
    const http = createProviderClient({ provider: "fake", deadlineAt: Date.now() + 30_000, budget: 2, allowedHosts: ["api.example.test"], fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(http.request("https://api.example.test/a")).rejects.toEqual(new ProviderStop("budget"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Ingest endpoint
// ---------------------------------------------------------------------------

describe("ingest endpoint under attack", () => {
  const KEY = "adversarial-ingest-key-".padEnd(48, "x");
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const post = (body: unknown) => POST(new Request("https://ajaniflow.com/api/metrics/ingest", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
  }));

  beforeEach(() => {
    vi.stubEnv("AJANI_METRICS_INGEST_KEY", KEY);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Regression (found and fixed 2026-10-16): the schema accepts the same metric/date twice in one body; the store then applies both in an unspecified order.
  it("refuses a body that repeats a metric/date pair", async () => {
    const date = yesterday();
    const values = [{ metricKey: "reddit.dms_sent", date, value: 1 }, { metricKey: "reddit.dms_sent", date, value: 5 }];
    expect.soft(parseIngestBody({ values }).success).toBe(false);
    expect.soft((await post({ values })).status).toBe(400);
  });

  // Regression (found and fixed 2026-10-16): zod's strict object does not flag an own "__proto__" key, so a body with an unknown field is accepted.
  it("refuses an extra __proto__ field like any other unknown field", () => {
    const date = yesterday();
    const inner = JSON.parse(`{"values":[{"metricKey":"reddit.dms_sent","date":"${date}","value":1,"__proto__":{"value":999}}]}`);
    const outer = JSON.parse(`{"values":[{"metricKey":"reddit.dms_sent","date":"${date}","value":1}],"__proto__":{"admin":true}}`);
    expect.soft(parseIngestBody(inner).success).toBe(false);
    expect.soft(parseIngestBody(outer).success).toBe(false);
  });

  // Regression (found and fixed 2026-10-16): zod's unrecognized_keys message quotes the submitted field name and the route returns it in "issues".
  it("does not echo submitted field names in errors", async () => {
    const response = await post({ values: [{ metricKey: "reddit.dms_sent", date: yesterday(), value: 1, "jane.doe@example.com": 1 }] });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("jane.doe@example.com");
  });

  it("never lets a __proto__ key pollute prototypes or override a value", () => {
    const date = yesterday();
    const parsed = parseIngestBody(JSON.parse(`{"values":[{"metricKey":"reddit.dms_sent","date":"${date}","value":1,"__proto__":{"value":999,"polluted":true}}],"__proto__":{"polluted":true}}`));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (parsed.success) expect(parsed.data.values[0]).toEqual({ metricKey: "reddit.dms_sent", date, value: 1 });
  });

  it("refuses unicode digits, huge or non-numeric values, account names, unknown keys and out-of-range dates", () => {
    const date = yesterday();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const old = new Date(Date.now() - 36 * 86_400_000).toISOString().slice(0, 10);
    const ok = { metricKey: "reddit.dms_sent", date, value: 1 };
    const bad: unknown[] = [
      { ...ok, date: "２０２６-10-15" },
      { ...ok, date: date.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit))) },
      { ...ok, date: `${date}T00:00:00Z` },
      { ...ok, date: tomorrow },
      { ...ok, date: old },
      { ...ok, date: "2026-09-31" },
      { ...ok, value: 1e15 },
      { ...ok, value: 100_000_000_000_001 },
      { ...ok, value: "12" },
      { ...ok, value: "１２" },
      { ...ok, value: -0.0001 },
      { ...ok, value: null },
      { ...ok, value: true },
      { ...ok, dimension: "" },
      { ...ok, dimension: "u/jane_doe" },
      { ...ok, constructor: 1 },
      { ...ok, metricKey: "Reddit.dms_sent" },
      { ...ok, metricKey: "reddit.dms_sent " },
      { ...ok, metricKey: "reddit.dms.sent" },
      { ...ok, metricKey: "sales.deals_won" },
      { ...ok, metricKey: "dripify.contacted" },
      { ...ok, metricKey: "youtube" },
    ];
    for (const value of bad) expect(parseIngestBody({ values: [value] }).success, JSON.stringify(value)).toBe(false);
    expect(parseIngestBody({ values: { 0: ok } }).success).toBe(false);
    expect(parseIngestBody({ values: [ok], constructor: {} }).success).toBe(false);
    expect(parseIngestBody({ values: [{ ...ok, value: 100_000_000_000_000 }, { ...ok, date: today, value: 0 }] }).success).toBe(true);
  });

  it("never echoes a submitted value in an error", async () => {
    const response = await post({ values: [
      { metricKey: "sales.secretvalue_abc", date: yesterday(), value: 1 },
      { metricKey: "reddit.dms_sent", date: "1999-01-01", value: 1 },
      { metricKey: "reddit.dms_sent", date: yesterday(), value: "secret-string-value" },
      { metricKey: "reddit.dms_sent", date: yesterday(), value: 123456789.987 },
    ] });
    expect(response.status).toBe(400);
    const text = await response.text();
    for (const secret of ["secretvalue_abc", "1999-01-01", "secret-string-value", "123456789.987"]) expect(text).not.toContain(secret);
  });
});
