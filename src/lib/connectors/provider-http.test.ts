import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProviderClient, ProviderHttpError, ProviderStop, providerUrl, readCapped, retryAfterMs } from "@/lib/connectors/provider-http";

const HOSTS = ["api.example.test"];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof createProviderClient>[0]> = {}) {
  return createProviderClient({
    provider: "fake", deadlineAt: Date.now() + 30_000, budget: 10, allowedHosts: HOSTS,
    errorCode: (body) => {
      const error = (body as { error?: { code?: unknown } }).error;
      return typeof error?.code === "string" ? error.code : null;
    },
    fetchImpl, ...overrides,
  });
}

describe("provider URLs", () => {
  it("accepts only HTTPS on the provider's own hosts, without credentials in the URL", () => {
    expect(providerUrl("https://api.example.test/v1/me", HOSTS).hostname).toBe("api.example.test");
    expect(() => providerUrl("http://api.example.test/v1/me", HOSTS)).toThrow("provider_url_not_allowed");
    expect(() => providerUrl("https://api.example.test.evil.test/v1", HOSTS)).toThrow("provider_url_not_allowed");
    expect(() => providerUrl("https://evil.test/?next=https://api.example.test", HOSTS)).toThrow("provider_url_not_allowed");
    expect(() => providerUrl("https://user:secret@api.example.test/", HOSTS)).toThrow("provider_url_not_allowed");
    expect(() => providerUrl("not a url", HOSTS)).toThrow("provider_url_invalid");
  });

  it("never sends a request to a host outside the list", async () => {
    const fetchImpl = vi.fn();
    await expect(client(fetchImpl).request("https://attacker.test/collect?token=abc")).rejects.toThrow("provider_url_not_allowed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("provider requests", () => {
  it("refuses redirects, skips caches and sends JSON accept headers", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    await expect(client(fetchImpl).request("https://api.example.test/v1/me", { headers: { authorization: "Bearer t" } })).resolves.toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init.headers).toMatchObject({ accept: "application/json", authorization: "Bearer t" });
  });

  it("waits out a 429 using Retry-After, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: "slow_down" } }, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const http = client(fetchImpl);
    await expect(http.request("https://api.example.test/a")).resolves.toEqual({ ok: 1 });
    expect(http.requests).toBe(2);
  });

  it("stops with rate_limited after repeated 429s or a wait longer than allowed", async () => {
    const always = vi.fn(async () => json({}, 429, { "retry-after": "0" }));
    await expect(client(always).request("https://api.example.test/a")).rejects.toEqual(new ProviderStop("rate_limited"));
    expect(always).toHaveBeenCalledTimes(3);
    const long = vi.fn(async () => json({}, 429, { "retry-after": "3600" }));
    await expect(client(long).request("https://api.example.test/a")).rejects.toEqual(new ProviderStop("rate_limited"));
    expect(long).toHaveBeenCalledTimes(1);
  });

  it("treats provider-specific rate-limit codes like a 429", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: "rateLimitExceeded" } }, 403, { "retry-after": "0" }));
    const http = client(fetchImpl, { isRateLimited: (status, code) => status === 403 && code === "rateLimitExceeded" });
    await expect(http.request("https://api.example.test/a")).rejects.toEqual(new ProviderStop("rate_limited"));
  });

  it("retries one server error and reports the status and code, never the body text", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: "backendError", message: "token=SECRET123 leaked" } }, 503))
      .mockResolvedValueOnce(json({ error: { code: "notFound", message: "Channel SECRET123 not found" } }, 404));
    const error = await client(fetchImpl).request("https://api.example.test/a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 404, code: "notFound" });
    expect(String((error as Error).message)).not.toContain("SECRET123");
  });

  it("drops error codes that look like free text", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: "Invalid OAuth access token abc123" } }, 400));
    await expect(client(fetchImpl).request("https://api.example.test/a")).rejects.toMatchObject({ status: 400, code: null });
  });

  it("enforces the request budget and the deadline", async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const http = client(fetchImpl, { budget: 2 });
    await http.request("https://api.example.test/1");
    await http.request("https://api.example.test/2");
    await expect(http.request("https://api.example.test/3")).rejects.toEqual(new ProviderStop("budget"));
    await expect(client(fetchImpl, { deadlineAt: Date.now() + 500 }).request("https://api.example.test/a")).rejects.toEqual(new ProviderStop("deadline"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("turns network failures into a generic error without the URL", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed https://api.example.test/a?access_token=SECRET"); });
    const error = await client(fetchImpl).request("https://api.example.test/a?access_token=SECRET").catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("fake_network_error");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects bodies over the size cap, declared or streamed, and non-JSON bodies", async () => {
    const declared = vi.fn(async () => new Response("{}", { headers: { "content-length": "999999" } }));
    await expect(client(declared, { maxResponseBytes: 100 }).request("https://api.example.test/a")).rejects.toThrow("fake_response_too_large");
    const streamed = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { for (let index = 0; index < 50; index += 1) controller.enqueue(new TextEncoder().encode("x".repeat(10))); controller.close(); },
    })));
    await expect(client(streamed, { maxResponseBytes: 100 }).request("https://api.example.test/a")).rejects.toThrow("fake_response_too_large");
    const html = vi.fn(async () => new Response("<html>login</html>"));
    await expect(client(html).request("https://api.example.test/a")).rejects.toThrow("fake_response_not_json");
  });
});

describe("helpers", () => {
  it("reads Retry-After as seconds or a date, with a safe default", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(retryAfterMs("2", now)).toBe(2000);
    expect(retryAfterMs("Fri, 16 Oct 2026 12:00:10 GMT", now)).toBe(10_000);
    expect(retryAfterMs(null, now)).toBe(5000);
    expect(retryAfterMs("soon", now)).toBe(5000);
  });

  it("reads small bodies in full and stops at the cap", async () => {
    expect(await readCapped(new Response("hello"), 10)).toBe("hello");
    expect(await readCapped(new Response("hello world"), 5)).toBeNull();
    expect(await readCapped(new Response(null), 5)).toBe("");
  });
});
