import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("tests must never reach the database"); } }));

import { INSTAGRAM_ACTOR, insightTotals, metaErrorCode, syncInstagramMetrics, tokenLineage } from "@/lib/connectors/instagram";
import type { ConnectorResult, MetricValue } from "@/lib/connectors/connector-store";
import type { CredentialStore, StoredCredential } from "@/lib/connectors/credential-vault";

const NOW = Date.parse("2026-10-16T22:30:00Z");
const TODAY = "2026-10-16";
const TOKEN = "IGAAfake-setting-token-0001";
const SOURCE = { INSTAGRAM_ACCESS_TOKEN: TOKEN };
const ACCOUNT = "17841400000000001";
const ALL = ["reach", "views", "total_interactions", "likes", "comments", "shares", "saves", "profile_links_taps"];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const metaError = (code: number, subcode?: number, status = 400) =>
  json({ error: { message: `Error validating access token: ${TOKEN}`, type: "OAuthException", code, error_subcode: subcode } }, status);

type Handler = (url: URL) => Response | Promise<Response>;

/** A fake graph.instagram.com that routes by path; anything else fails the test. */
function fakeInstagram(routes: Record<string, Handler>) {
  const calls: URL[] = [];
  const fetchImpl = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname !== "graph.instagram.com") throw new Error(`left Instagram: ${url.hostname}`);
    const route = routes[url.pathname];
    if (!route) throw new Error(`unexpected request ${url.pathname}`);
    return route(url);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const me = (body: Record<string, unknown> = { user_id: ACCOUNT, username: "ajani.ai", followers_count: 842, media_count: 51 }) => () => json(body);
/** Insights where each metric's value depends on the requested day, so per-day mapping is checked. */
const insights = (unsupported: string[] = []) => (url: URL) => {
  const requested = (url.searchParams.get("metric") ?? "").split(",");
  if (requested.some((name) => unsupported.includes(name))) return metaError(100);
  const day = new Date(Number(url.searchParams.get("since")) * 1000).getUTCDate();
  return json({ data: requested.map((name, index) => ({ name, period: "day", total_value: { value: day * 10 + index } })) });
};
// Real media IDs are unique; these are unique per timestamp and position.
const media = (timestamps: string[], next?: string) => () => json({ data: timestamps.map((timestamp, index) => ({ id: `${index}-${timestamp}`, timestamp })), paging: next ? { next } : {} });

function harness() {
  const written: MetricValue[] = [];
  const runs: ConnectorResult[] = [];
  return {
    written, runs,
    write: vi.fn(async (values: MetricValue[], actor: string) => {
      expect(actor).toBe(INSTAGRAM_ACTOR);
      written.push(...values);
      return values.length;
    }),
    record: vi.fn(async (result: ConnectorResult) => { runs.push(result); }),
  };
}

function memoryStore(initial?: StoredCredential) {
  let stored = initial ?? null;
  const saves: Array<{ token: string; expiresAt: string | null }> = [];
  const store: CredentialStore = {
    load: vi.fn(async () => stored),
    save: vi.fn(async (_connector, token, expiresAt) => {
      saves.push({ token, expiresAt });
      stored = { token, expiresAt, updatedAt: new Date(NOW).toISOString() };
    }),
  };
  return { store, saves };
}

const valueOf = (written: MetricValue[], metricKey: string, date = TODAY) =>
  written.find((item) => item.metricKey === metricKey && item.date === date)?.value;
const base = { deadlineAt: Date.now() + 50_000, now: NOW, source: SOURCE };

describe("Instagram sync with fake data", () => {
  it("does nothing until a token is set", async () => {
    const run = harness();
    const fake = fakeInstagram({});
    const result = await syncInstagramMetrics({ ...base, source: {}, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.status).toBe("not_configured");
    expect(fake.calls).toHaveLength(0);
  });

  it("syncs followers, three days of insights and posts per day; warns when renewal is off", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: insights(),
      [`/v25.0/${ACCOUNT}/media`]: media(["2026-10-16T09:00:00+0000", "2026-10-14T23:59:00+0000", "2026-10-14T01:00:00+0000", "2026-09-20T10:00:00+0000"]),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });

    expect(result).toMatchObject({ status: "synced", reason: "vault_missing", details: { insightDays: 3 } });
    expect(valueOf(run.written, "instagram.followers")).toBe(842);
    // Each day carries its own numbers (day-of-month × 10 + metric position).
    expect(valueOf(run.written, "instagram.reach", "2026-10-13")).toBe(130);
    expect(valueOf(run.written, "instagram.reach", "2026-10-15")).toBe(150);
    expect(valueOf(run.written, "instagram.views", "2026-10-15")).toBe(151);
    expect(valueOf(run.written, "instagram.interactions", "2026-10-15")).toBe(152);
    expect(valueOf(run.written, "instagram.profile_link_taps", "2026-10-15")).toBe(157);
    expect(run.written.some((item) => item.metricKey === "instagram.reach" && item.date === TODAY)).toBe(false);
    expect(valueOf(run.written, "instagram.posts_published", "2026-10-14")).toBe(2);
    expect(valueOf(run.written, "instagram.posts_published", "2026-10-15")).toBe(0);
    expect(run.written.filter((item) => item.metricKey === "instagram.posts_published")).toHaveLength(14);

    // Each insight request covers exactly one UTC day.
    const windows = fake.calls.filter((url) => url.pathname.endsWith("/insights")).map((url) => [url.searchParams.get("since"), url.searchParams.get("until")]);
    expect(windows).toEqual([
      [String(Date.parse("2026-10-13T00:00:00Z") / 1000), String(Date.parse("2026-10-14T00:00:00Z") / 1000)],
      [String(Date.parse("2026-10-14T00:00:00Z") / 1000), String(Date.parse("2026-10-15T00:00:00Z") / 1000)],
      [String(Date.parse("2026-10-15T00:00:00Z") / 1000), String(Date.parse("2026-10-16T00:00:00Z") / 1000)],
    ]);
    expect(fake.calls.some((url) => url.pathname === "/refresh_access_token")).toBe(false);
    expect(run.runs).toEqual([result]);
  });

  it("reads metrics one by one when one is unsupported, then skips it on later days", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: insights(["profile_links_taps"]),
      [`/v25.0/${ACCOUNT}/media`]: media([]),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.status).toBe("synced");
    expect(run.written.some((item) => item.metricKey === "instagram.profile_link_taps")).toBe(false);
    expect(valueOf(run.written, "instagram.saves", "2026-10-15")).toBeDefined();
    // Day 1: one combined + eight single requests. Days 2 and 3: one request each.
    expect(fake.calls.filter((url) => url.pathname.endsWith("/insights"))).toHaveLength(11);
  });

  it("stays within its request budget when insights are refused outright, so posts still sync in full", async () => {
    const run = harness();
    let page = 0;
    const fake = fakeInstagram({
      "/refresh_access_token": () => json({ access_token: "IGAArenewed-token-0000000002", expires_in: 5_184_000 }),
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: () => metaError(100),
      [`/v25.0/${ACCOUNT}/media`]: () => {
        page += 1;
        return page === 1
          ? media(["2026-10-16T09:00:00+0000"], `https://graph.instagram.com/v25.0/${ACCOUNT}/media?after=p2`)()
          : media(["2026-10-01T09:00:00+0000"])();
      },
    });
    const result = await syncInstagramMetrics({ ...base, credentials: memoryStore().store, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.status).toBe("synced");
    // Day 1: one combined + eight single tries. Days 2 and 3: one combined try each.
    expect(fake.calls.filter((url) => url.pathname.endsWith("/insights"))).toHaveLength(11);
    expect(run.written.filter((item) => item.metricKey === "instagram.posts_published")).toHaveLength(14);
  });

  it("keeps an empty insight answer unknown instead of zero", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me({ user_id: ACCOUNT, followers_count: "not-a-number" }),
      [`/v25.0/${ACCOUNT}/insights`]: () => json({ data: [] }),
      [`/v25.0/${ACCOUNT}/media`]: media([]),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.details.insightDays).toBe(0);
    expect(run.written.filter((item) => item.metricKey !== "instagram.posts_published")).toEqual([]);
  });

  it("follows paging only on Instagram's host and records only seen days when a link points elsewhere", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: insights(),
      [`/v25.0/${ACCOUNT}/media`]: media(["2026-10-16T09:00:00+0000"], `https://attacker.test/v25.0/${ACCOUNT}/media?access_token=${TOKEN}`),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "failures" });
    expect(fake.calls.every((url) => url.hostname === "graph.instagram.com")).toBe(true);
    // Today may continue on the unread page, so it stays unknown.
    expect(run.written.filter((item) => item.metricKey === "instagram.posts_published")).toEqual([]);
  });

  it("keeps fully read days when a later page fails", async () => {
    const run = harness();
    let page = 0;
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: insights(),
      [`/v25.0/${ACCOUNT}/media`]: () => {
        page += 1;
        return page === 1
          ? media(["2026-10-16T09:00:00+0000", "2026-10-14T09:00:00+0000"], `https://graph.instagram.com/v25.0/${ACCOUNT}/media?after=abc`)()
          : json({ error: { code: 1, message: "unknown" } }, 500);
      },
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "failures" });
    expect(run.written.filter((item) => item.metricKey === "instagram.posts_published").map((item) => [item.date, item.value]))
      .toEqual([["2026-10-15", 0], ["2026-10-16", 1]]);
  });

  it("treats a media answer without its list as a failed read, never as zero posts", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: insights(),
      [`/v25.0/${ACCOUNT}/media`]: () => json({}),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "failures" });
    expect(run.written.some((item) => item.metricKey === "instagram.posts_published")).toBe(false);
  });

  it("follows a same-host next page and stops once it reaches older posts", async () => {
    const run = harness();
    let page = 0;
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: insights(),
      [`/v25.0/${ACCOUNT}/media`]: () => {
        page += 1;
        return page === 1
          ? media(["2026-10-16T09:00:00+0000"], `https://graph.instagram.com/v25.0/${ACCOUNT}/media?after=abc&access_token=${TOKEN}`)()
          : media(["2026-10-10T09:00:00+0000", "2026-09-01T09:00:00+0000"], `https://graph.instagram.com/v25.0/${ACCOUNT}/media?after=def`)();
      },
    });
    await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(page).toBe(2);
    expect(valueOf(run.written, "instagram.posts_published", "2026-10-10")).toBe(1);
    expect(run.written.filter((item) => item.metricKey === "instagram.posts_published")).toHaveLength(14);
  });

  it("maps Meta's errors to reasons and never keeps provider text", async () => {
    const cases: Array<[Response, string]> = [
      [metaError(190, 463), "token_expired"],
      [metaError(190), "invalid_credentials"],
      [metaError(10), "permission_missing"],
      [metaError(200), "permission_missing"],
    ];
    for (const [response, reason] of cases) {
      const run = harness();
      const fake = fakeInstagram({ "/v25.0/me": () => response.clone() });
      const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
      expect(result, reason).toMatchObject({ status: "rejected", reason, valuesWritten: 0 });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(run.write).not.toHaveBeenCalled();
    }
    const run = harness();
    const unknown = fakeInstagram({ "/v25.0/me": me({ username: "no-id" }) });
    await expect(syncInstagramMetrics({ ...base, credentials: null, fetchImpl: unknown.fetchImpl, write: run.write, record: run.record }))
      .resolves.toMatchObject({ status: "rejected", reason: "account_not_found" });
  });

  it("rejects the whole run when insights lose permission mid-way, without saving half a picture", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: () => metaError(10, undefined, 403),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "rejected", reason: "permission_missing" });
    // Followers were read before the refusal and are still a fact.
    expect(valueOf(run.written, "instagram.followers")).toBe(842);
  });

  it("waits out Meta's rate limit codes and reports them when they persist", async () => {
    const run = harness();
    const fake = fakeInstagram({
      "/v25.0/me": me(),
      [`/v25.0/${ACCOUNT}/insights`]: () => json({ error: { code: 4, message: "Application request limit reached" } }, 400, { "retry-after": "0" }),
      [`/v25.0/${ACCOUNT}/media`]: media([]),
    });
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "rate_limited" });
    expect(valueOf(run.written, "instagram.followers")).toBe(842);
  });
});

describe("Instagram token renewal", () => {
  const routes = (renewed = "IGAArenewed-token-0000000002") => ({
    "/refresh_access_token": (url: URL) => {
      expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
      return json({ access_token: renewed, token_type: "bearer", expires_in: 5_184_000 });
    },
    "/v25.0/me": me(),
    [`/v25.0/${ACCOUNT}/insights`]: insights(),
    [`/v25.0/${ACCOUNT}/media`]: media([]),
  });

  it("renews a token with unknown expiry, seals the new one with its lineage, and uses it", async () => {
    const run = harness();
    const vault = memoryStore();
    const fake = fakeInstagram(routes());
    const result = await syncInstagramMetrics({ ...base, credentials: vault.store, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result).toMatchObject({ status: "synced", reason: null, details: { tokenRenewed: 1 } });
    expect(vault.saves).toHaveLength(1);
    expect(JSON.parse(vault.saves[0].token)).toEqual({ token: "IGAArenewed-token-0000000002", lineage: tokenLineage(TOKEN) });
    expect(vault.saves[0].expiresAt).toBe(new Date(NOW + 5_184_000_000).toISOString());
    expect(fake.calls.find((url) => url.pathname === "/v25.0/me")?.searchParams.get("access_token")).toBe("IGAArenewed-token-0000000002");
  });

  it("uses a stored token that is far from expiry without renewing", async () => {
    const run = harness();
    const vault = memoryStore({ token: JSON.stringify({ token: "IGAAstored-token-00000000003", lineage: tokenLineage(TOKEN) }), expiresAt: new Date(NOW + 50 * 86_400_000).toISOString(), updatedAt: "" });
    const fake = fakeInstagram(routes());
    await syncInstagramMetrics({ ...base, credentials: vault.store, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(fake.calls.some((url) => url.pathname === "/refresh_access_token")).toBe(false);
    expect(fake.calls.find((url) => url.pathname === "/v25.0/me")?.searchParams.get("access_token")).toBe("IGAAstored-token-00000000003");
  });

  it("renews a stored token inside the last 20 days", async () => {
    const run = harness();
    const vault = memoryStore({ token: JSON.stringify({ token: "IGAAstored-token-00000000003", lineage: tokenLineage(TOKEN) }), expiresAt: new Date(NOW + 10 * 86_400_000).toISOString(), updatedAt: "" });
    const fake = fakeInstagram(routes());
    await syncInstagramMetrics({ ...base, credentials: vault.store, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(fake.calls.find((url) => url.pathname === "/refresh_access_token")?.searchParams.get("access_token")).toBe("IGAAstored-token-00000000003");
    expect(vault.saves).toHaveLength(1);
  });

  it("lets a newly pasted setting token replace an older renewed one", async () => {
    const run = harness();
    const vault = memoryStore({ token: JSON.stringify({ token: "IGAAold-lineage-token-000004", lineage: tokenLineage("IGAAprevious-setting") }), expiresAt: new Date(NOW + 50 * 86_400_000).toISOString(), updatedAt: "" });
    const fake = fakeInstagram(routes());
    await syncInstagramMetrics({ ...base, credentials: vault.store, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(fake.calls.find((url) => url.pathname === "/refresh_access_token")?.searchParams.get("access_token")).toBe(TOKEN);
    expect(fake.calls.every((url) => url.searchParams.get("access_token") !== "IGAAold-lineage-token-000004")).toBe(true);
  });

  it("keeps syncing with the current token when renewal or the vault fails", async () => {
    const run = harness();
    const broken: CredentialStore = { load: vi.fn(async () => { throw new Error("credential_load_failed"); }), save: vi.fn() };
    const fake = fakeInstagram(routes());
    const result = await syncInstagramMetrics({ ...base, credentials: broken, fetchImpl: fake.fetchImpl, write: run.write, record: run.record });
    expect(result.status).toBe("synced");
    expect(fake.calls.find((url) => url.pathname === "/v25.0/me")?.searchParams.get("access_token")).toBe(TOKEN);

    const young = fakeInstagram({ ...routes(), "/refresh_access_token": () => metaError(100) });
    const vault = memoryStore();
    const second = await syncInstagramMetrics({ ...base, credentials: vault.store, fetchImpl: young.fetchImpl, write: run.write, record: run.record });
    expect(second.status).toBe("synced");
    expect(vault.saves).toHaveLength(0);

    const failingSave: CredentialStore = { load: vi.fn(async () => null), save: vi.fn(async () => { throw new Error("credential_save_failed"); }) };
    const third = fakeInstagram(routes());
    await syncInstagramMetrics({ ...base, credentials: failingSave, fetchImpl: third.fetchImpl, write: run.write, record: run.record });
    // The renewed token is still used for this run even though it could not be stored.
    expect(third.calls.find((url) => url.pathname === "/v25.0/me")?.searchParams.get("access_token")).toBe("IGAArenewed-token-0000000002");
  });

  it("reports a store refusal as save_failed", async () => {
    const run = harness();
    const fake = fakeInstagram(routes());
    const result = await syncInstagramMetrics({ ...base, credentials: null, fetchImpl: fake.fetchImpl, write: vi.fn(async () => { throw new Error("metric_write_failed"); }), record: run.record });
    expect(result).toMatchObject({ status: "partial", reason: "save_failed", valuesWritten: 0 });
  });
});

describe("Instagram parsing", () => {
  it("reads totals and error codes", () => {
    expect([...insightTotals({ data: [{ name: "reach", total_value: { value: 5 } }, { name: "views", total_value: { value: -1 } }, { name: "saves" }] })]).toEqual([["reach", 5]]);
    expect(metaErrorCode({ error: { code: 190, error_subcode: 463 } })).toBe("190_463");
    expect(metaErrorCode({ error: { code: 4 } })).toBe("4");
    expect(metaErrorCode({ error: { code: "190" } })).toBeNull();
    expect(ALL).toHaveLength(8);
  });
});
