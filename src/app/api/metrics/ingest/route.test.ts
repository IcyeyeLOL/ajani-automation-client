import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

import { POST } from "@/app/api/metrics/ingest/route";
import { INGEST_ACTOR, parseIngestBody } from "@/lib/connectors/ingest";

const KEY = "k".repeat(40);
const NOW = Date.parse("2026-10-16T12:00:00Z");

function post(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://ajaniflow.com/api/metrics/ingest", {
    method: "POST",
    body: text,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("AJANI_METRICS_INGEST_KEY", KEY);
  mocks.rpc.mockImplementation(async (_name: string, args: { p_values: unknown[] }) => ({ data: args.p_values.length, error: null }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  mocks.rpc.mockReset();
});

describe("private metrics endpoint", () => {
  it("reads as missing while switched off or with a key too short to be safe", async () => {
    vi.stubEnv("AJANI_METRICS_INGEST_KEY", "");
    expect((await POST(post({ values: [] }))).status).toBe(404);
    vi.stubEnv("AJANI_METRICS_INGEST_KEY", "short-key");
    const response = await POST(post({ values: [] }, { authorization: "Bearer short-key" }));
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong key before reading the body", async () => {
    expect((await POST(post({}, { authorization: "" }))).status).toBe(401);
    expect((await POST(post({}, { authorization: `Bearer ${KEY}x` }))).status).toBe(401);
    expect((await POST(post({}, { authorization: KEY }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts daily platform totals and writes them as the ingest actor", async () => {
    const response = await POST(post({ values: [
      { metricKey: "reddit.dms_sent", date: "2026-10-15", value: 12 },
      { metricKey: "reddit.dm_replies", date: "2026-10-16", value: 3 },
      { metricKey: "instagram.reach", date: "2026-10-15", value: 900 },
    ] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ written: 3 });
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("upsert_analytics_metric_values");
    // Manual origin: the store refuses connector-only metrics, and rows stay deletable.
    expect(args).toMatchObject({ p_origin: "manual", p_actor: INGEST_ACTOR });
    expect(args.p_values.every((value: Record<string, unknown>) => !("dimension" in value))).toBe(true);
  });

  it("rejects business numbers, future or ancient dates, extra fields and bad values", async () => {
    const bad = [
      { metricKey: "sales.deals_won", date: "2026-10-15", value: 1 },
      { metricKey: "revenue.cash_collected", date: "2026-10-15", value: 1 },
      { metricKey: "dripify.contacted", date: "2026-10-15", value: 1 },
      { metricKey: "outreach.touches", date: "2026-10-15", value: 1 },
      // TikTok is retired.
      { metricKey: "tiktok.views", date: "2026-10-15", value: 1 },
      { metricKey: "reddit.dms_sent", date: "2026-10-17", value: 1 },
      { metricKey: "reddit.dms_sent", date: "2026-06-01", value: 1 },
      { metricKey: "reddit.dms_sent", date: "2026-10-15", value: -1 },
      { metricKey: "reddit.dms_sent", date: "2026-10-15", value: "12" },
      { metricKey: "reddit.dms_sent", date: "2026-10-15", value: 1, recipient: "u/someone" },
      { metricKey: "reddit.dms_sent", date: "2026-10-15", dimension: "jane.doe@gmail.com", value: 1 },
      { metricKey: "reddit.dms_sent", date: "2026-10-15", dimension: "u/jane_doe", value: 1 },
      { metricKey: "reddit.dms_sent", date: "2026-09-01", value: 1 },
    ];
    for (const value of bad) {
      const response = await POST(post({ values: [value] }));
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect((await POST(post({ values: [] }))).status).toBe(400);
    expect((await POST(post({ values: Array.from({ length: 201 }, () => ({ metricKey: "reddit.dms_sent", date: "2026-10-15", value: 1 })) }))).status).toBe(400);
    expect((await POST(post({ values: [{ metricKey: "reddit.dms_sent", date: "2026-10-15", value: 1 }], source: "reddit" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns at most five issues and never echoes the submitted values", async () => {
    const response = await POST(post({ values: Array.from({ length: 9 }, (_, index) => ({ metricKey: `sales.secret_${index}`, date: "2026-10-15", value: 1 })) }));
    const body = await response.json() as { issues: string[] };
    expect(body.issues).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain("secret_");
  });

  it("requires JSON and caps the body size", async () => {
    expect((await POST(post("values=1", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post({ values: [] }, { "content-length": "999999" }))).status).toBe(413);
    expect((await POST(post(JSON.stringify({ values: [], pad: "x".repeat(70_000) })))).status).toBe(413);
    // Counted in bytes: 30,000 three-byte characters are 90 KB.
    expect((await POST(post(JSON.stringify({ values: [], pad: "€".repeat(30_000) })))).status).toBe(413);
    const chunked = new Request("https://ajaniflow.com/api/metrics/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: new ReadableStream({ start(controller) { for (let index = 0; index < 100; index += 1) controller.enqueue(new TextEncoder().encode("x".repeat(1_000))); controller.close(); } }),
      duplex: "half",
    } as RequestInit);
    expect((await POST(chunked)).status).toBe(413);
  });

  it("answers a store refusal with a generic message and no database detail", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Metric reddit.dm_reply_rate is calculated automatically", details: "internal" } });
    const response = await POST(post({ values: [{ metricKey: "reddit.dm_reply_rate", date: "2026-10-15", value: 0.5 }] }));
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).not.toContain("internal");
    expect(text).not.toContain("Metric reddit.dm_reply_rate");
  });
});

describe("ingest schema", () => {
  it("allows the last 35 days in UTC and nothing later than today", () => {
    expect(parseIngestBody({ values: [{ metricKey: "youtube.views", date: "2026-09-11", value: 1 }] }, NOW).success).toBe(true);
    expect(parseIngestBody({ values: [{ metricKey: "youtube.views", date: "2026-09-10", value: 1 }] }, NOW).success).toBe(false);
    expect(parseIngestBody({ values: [{ metricKey: "youtube.views", date: "2026-10-16", value: 1 }] }, NOW).success).toBe(true);
    expect(parseIngestBody({ values: [{ metricKey: "linkedin.followers", date: "2026-10-16", value: 3500 }] }, NOW).success).toBe(true);
  });
});
