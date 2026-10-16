import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("tests must never reach the database"); } }));

import { analyticsTable, googleErrorCode, syncYouTubeMetrics, YOUTUBE_ACTOR, youtubeSettings } from "@/lib/connectors/youtube";
import type { ConnectorResult, MetricValue } from "@/lib/connectors/connector-store";

const NOW = Date.parse("2026-10-16T22:30:00Z");
const TODAY = "2026-10-16";
const CHANNEL = "UC1234567890abcdefghijkl";
const PUBLIC = { YOUTUBE_API_KEY: "AIza-fake-key", YOUTUBE_CHANNEL_ID: CHANNEL };
const OAUTH = { YOUTUBE_CLIENT_ID: "client.apps.googleusercontent.com", YOUTUBE_CLIENT_SECRET: "GOCSPX-fake", YOUTUBE_REFRESH_TOKEN: "1//fake-refresh" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const googleError = (status: number, reason: string) => json({ error: { code: status, message: `secret detail ${reason}`, errors: [{ reason }] } }, status);

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A fake Google: routes by host and path; anything unexpected fails the test. */
function fakeGoogle(routes: Record<string, Handler>) {
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

const channel = (statistics: Record<string, unknown> = { subscriberCount: "1230", viewCount: "98765", hiddenSubscriberCount: false }) =>
  () => json({ items: [{ id: CHANNEL, statistics, contentDetails: { relatedPlaylists: { uploads: "UU1234567890abcdefghijkl" } } }] });
const uploads = (dates: string[], nextPageToken?: string) =>
  () => json({ items: dates.map((date) => ({ contentDetails: { videoPublishedAt: `${date}T15:00:00Z` } })), nextPageToken });
const token = () => json({ access_token: "ya29.fake-access", expires_in: 3599, token_type: "Bearer" });

function analyticsRoute(daily: unknown[][], byType: unknown[][] | Response = []) {
  return (url: URL) => {
    if (url.searchParams.get("dimensions") === "day,creatorContentType") {
      return byType instanceof Response ? byType : json({ columnHeaders: [{ name: "day" }, { name: "creatorContentType" }, { name: "views" }], rows: byType });
    }
    return json({
      columnHeaders: ["day", "views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained", "subscribersLost"].map((name) => ({ name })),
      rows: daily,
    });
  };
}

function harness() {
  const written: MetricValue[] = [];
  const runs: ConnectorResult[] = [];
  return {
    written, runs,
    write: vi.fn(async (values: MetricValue[], actor: string) => {
      expect(actor).toBe(YOUTUBE_ACTOR);
      written.push(...values);
      return values.length;
    }),
    record: vi.fn(async (result: ConnectorResult) => { runs.push(result); }),
  };
}

const valueOf = (written: MetricValue[], metricKey: string, date = TODAY) =>
  written.find((item) => item.metricKey === metricKey && item.date === date)?.value;

describe("YouTube settings", () => {
  it("needs a key and a channel, or the Google sign-in", () => {
    expect(youtubeSettings({})).toBeNull();
    expect(youtubeSettings({ YOUTUBE_API_KEY: "k" })).toBeNull();
    expect(youtubeSettings({ YOUTUBE_API_KEY: "k", YOUTUBE_CHANNEL_ID: "https://youtube.com/@ajani" })).toBeNull();
    expect(youtubeSettings({ YOUTUBE_API_KEY: "k", YOUTUBE_CHANNEL_ID: "@ajani.ai" })?.channel).toEqual({ handle: "ajani.ai" });
    expect(youtubeSettings(PUBLIC)?.channel).toEqual({ id: CHANNEL });
    expect(youtubeSettings(OAUTH)).toMatchObject({ apiKey: null, channel: null, oauth: { refreshToken: "1//fake-refresh" } });
  });
});

describe("YouTube sync with fake data", () => {
  it("does nothing and records nothing until configured", async () => {
    const run = harness();
    const fake = fakeGoogle({});
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: {}, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "not_configured", valuesWritten: 0 });
    expect(fake.calls).toHaveLength(0);
    expect(run.record).not.toHaveBeenCalled();
  });

  it("syncs public numbers with the key in a header, and counts uploads per day with zeros for quiet days", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads(["2026-10-16", "2026-10-14", "2026-10-14", "2026-09-01"]),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });

    expect(result).toMatchObject({ status: "synced", reason: null, date: TODAY });
    expect(valueOf(run.written, "youtube.subscribers")).toBe(1230);
    expect(valueOf(run.written, "youtube.total_views")).toBe(98765);
    expect(valueOf(run.written, "youtube.videos_published", "2026-10-14")).toBe(2);
    expect(valueOf(run.written, "youtube.videos_published", "2026-10-15")).toBe(0);
    expect(run.written.filter((item) => item.metricKey === "youtube.videos_published")).toHaveLength(14);
    expect(run.written.some((item) => item.date === "2026-09-01")).toBe(false);
    // Every value is the owner's main account.
    expect(run.written.every((item) => item.dimension === undefined)).toBe(true);

    for (const call of fake.calls) {
      expect(call.url.href).not.toContain("AIza-fake-key");
      expect(call.init.headers).toMatchObject({ "x-goog-api-key": "AIza-fake-key" });
    }
    expect(fake.calls[0].url.searchParams.get("id")).toBe(CHANNEL);
    expect(run.runs).toEqual([result]);
  });

  it("looks a channel up by handle", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
    });
    await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: { YOUTUBE_API_KEY: "k", YOUTUBE_CHANNEL_ID: "@AjaniAutomation" }, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(fake.calls[0].url.searchParams.get("forHandle")).toBe("AjaniAutomation");
  });

  it("leaves a hidden subscriber count unknown instead of zero", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "youtube.googleapis.com/youtube/v3/channels": channel({ subscriberCount: "0", viewCount: "500", hiddenSubscriberCount: true }),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
    });
    await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(valueOf(run.written, "youtube.subscribers")).toBeUndefined();
    expect(valueOf(run.written, "youtube.total_views")).toBe(500);
  });

  it("records only the upload days it saw when the listing is cut short", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads(["2026-10-16", "2026-10-15"], "more"),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.status).toBe("synced");
    // The oldest day seen may continue on the unread page, so only later days are facts.
    expect(run.written.filter((item) => item.metricKey === "youtube.videos_published").map((item) => item.date)).toEqual(["2026-10-16"]);
  });

  it("syncs private analytics with the Google sign-in: watch hours, Shorts and subscribers gained or lost", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "oauth2.googleapis.com/token": token,
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
      "youtubeanalytics.googleapis.com/v2/reports": analyticsRoute(
        [["2026-10-14", 400, 90, 20, 3, 2, 5, 1], ["2026-10-15", 380, 125, 18, 1, 0, 2, 0], ["2026-10-16", 999, 1, 1, 1, 1, 1, 1], ["2026-10-13", -4, "x", 1.5, 2, 0, 0, 0]],
        [["2026-10-14", "SHORTS", 150], ["2026-10-14", "VIDEO_ON_DEMAND", 250], ["2026-10-15", "VIDEO_ON_DEMAND", 380]],
      ),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: OAUTH, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });

    expect(result).toMatchObject({ status: "synced", details: { analyticsDays: 3 } });
    expect(valueOf(run.written, "youtube.views", "2026-10-14")).toBe(400);
    expect(valueOf(run.written, "youtube.watch_hours", "2026-10-14")).toBe(1.5);
    expect(valueOf(run.written, "youtube.watch_hours", "2026-10-15")).toBe(2.08);
    expect(valueOf(run.written, "youtube.subscribers_gained", "2026-10-14")).toBe(5);
    expect(valueOf(run.written, "youtube.subscribers_lost", "2026-10-14")).toBe(1);
    expect(valueOf(run.written, "youtube.shorts_views", "2026-10-14")).toBe(150);
    expect(valueOf(run.written, "youtube.shorts_views", "2026-10-15")).toBe(0);
    // Today is never read from Analytics (it is incomplete), and malformed numbers stay unknown.
    expect(run.written.some((item) => item.date === TODAY && item.metricKey === "youtube.views")).toBe(false);
    expect(valueOf(run.written, "youtube.views", "2026-10-13")).toBeUndefined();
    expect(valueOf(run.written, "youtube.watch_hours", "2026-10-13")).toBeUndefined();
    expect(valueOf(run.written, "youtube.likes", "2026-10-13")).toBeUndefined();
    expect(valueOf(run.written, "youtube.comments", "2026-10-13")).toBe(2);

    const tokenCall = fake.calls.find((call) => call.url.hostname === "oauth2.googleapis.com");
    expect(tokenCall?.init.method).toBe("POST");
    expect(String(tokenCall?.init.body)).toContain("grant_type=refresh_token");
    expect(tokenCall?.url.search).toBe("");
    expect(fake.calls[1].url.searchParams.get("mine")).toBe("true");
    for (const call of fake.calls.slice(1)) expect(call.init.headers).toMatchObject({ authorization: "Bearer ya29.fake-access" });
  });

  it("falls back to public numbers when the Google sign-in has expired", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "oauth2.googleapis.com/token": () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: { ...PUBLIC, ...OAUTH }, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "token_expired" });
    expect(valueOf(run.written, "youtube.subscribers")).toBe(1230);
    expect(fake.calls.some((call) => call.url.hostname === "youtubeanalytics.googleapis.com")).toBe(false);
  });

  it("is rejected when the sign-in expired and there is no key to fall back on", async () => {
    const run = harness();
    const fake = fakeGoogle({ "oauth2.googleapis.com/token": () => json({ error: "invalid_grant" }, 400) });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: OAUTH, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "rejected", reason: "token_expired", valuesWritten: 0 });
    expect(run.write).not.toHaveBeenCalled();
    expect(run.runs).toHaveLength(1);
  });

  it("keeps public numbers and names the missing permission when Analytics refuses", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "oauth2.googleapis.com/token": token,
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
      "youtubeanalytics.googleapis.com/v2/reports": () => googleError(403, "insufficientPermissions"),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: OAUTH, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "permission_missing" });
    expect(valueOf(run.written, "youtube.total_views")).toBe(98765);
  });

  it("tolerates a channel that cannot be split by content type", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "oauth2.googleapis.com/token": token,
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
      "youtubeanalytics.googleapis.com/v2/reports": analyticsRoute([["2026-10-15", 10, 60, 1, 0, 0, 0, 0]], googleError(400, "badRequest")),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: OAUTH, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.status).toBe("synced");
    expect(valueOf(run.written, "youtube.views", "2026-10-15")).toBe(10);
    expect(run.written.some((item) => item.metricKey === "youtube.shorts_views")).toBe(false);
  });

  it("maps Google's refusals to reasons the owner can act on", async () => {
    const cases: Array<[Response, string, string]> = [
      [googleError(400, "keyInvalid"), "rejected", "invalid_credentials"],
      [googleError(403, "accessNotConfigured"), "rejected", "access_not_approved"],
      [googleError(403, "quotaExceeded"), "rejected", "rate_limited"],
      [googleError(403, "forbidden"), "rejected", "permission_missing"],
    ];
    for (const [response, status, reason] of cases) {
      const run = harness();
      const fake = fakeGoogle({ "youtube.googleapis.com/youtube/v3/channels": () => response.clone() });
      const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
      expect(result, reason).toMatchObject({ status, reason });
    }
    const run = harness();
    const empty = fakeGoogle({ "youtube.googleapis.com/youtube/v3/channels": () => json({ items: [] }) });
    await expect(syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: empty.fetchImpl, write: run.write, record: run.record }))
      .resolves.toMatchObject({ status: "rejected", reason: "account_not_found" });
  });

  it("reports a store refusal as save_failed instead of crashing", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": uploads([]),
    });
    const write = vi.fn(async () => { throw new Error("metric_write_failed"); });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: fake.fetchImpl, write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "save_failed", valuesWritten: 0 });
    expect(run.runs).toHaveLength(1);
  });

  it("stops cleanly near the deadline and still saves what it read", async () => {
    const run = harness();
    const fake = fakeGoogle({
      "youtube.googleapis.com/youtube/v3/channels": channel(),
      "youtube.googleapis.com/youtube/v3/playlistItems": () => json({}, 429, { "retry-after": "0" }),
    });
    const result = await syncYouTubeMetrics({ deadlineAt: Date.now() + 50_000, now: NOW, source: PUBLIC, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(valueOf(run.written, "youtube.subscribers")).toBe(1230);
  });
});

describe("YouTube parsing", () => {
  it("names report columns and treats missing rows as no data", () => {
    expect(analyticsTable({ columnHeaders: [{ name: "day" }, { name: "views" }], rows: [["2026-10-15", 3]] }).rows).toEqual([{ day: "2026-10-15", views: 3 }]);
    expect(analyticsTable({ columnHeaders: [{ name: "day" }] }).rows).toEqual([]);
    expect(() => analyticsTable({ columnHeaders: [{ nope: 1 }] })).toThrow("youtube_analytics_invalid");
  });

  it("reads Google error reasons from both error shapes", () => {
    expect(googleErrorCode({ error: "invalid_grant" })).toBe("invalid_grant");
    expect(googleErrorCode({ error: { errors: [{ reason: "quotaExceeded" }] } })).toBe("quotaExceeded");
    expect(googleErrorCode({})).toBeNull();
  });
});
