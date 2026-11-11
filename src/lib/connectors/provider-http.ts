import "server-only";

/**
 * One HTTP client per connector run. It enforces what every provider call
 * needs: HTTPS to the provider's own hosts only (a pagination link can never
 * carry a token elsewhere), a request budget, a deadline, a size cap, and
 * Retry-After on 429. Errors carry the status and a short provider code,
 * never URLs, tokens or provider message text.
 */
export class ProviderHttpError extends Error {
  constructor(readonly provider: string, readonly status: number, readonly code: string | null) {
    super(`${provider}_http_${status}${code ? `_${code}` : ""}`);
  }
}

export type ProviderStopReason = "deadline" | "rate_limited" | "budget";

export class ProviderStop extends Error {
  constructor(readonly reason: ProviderStopReason) {
    super(`provider_stop_${reason}`);
  }
}

export type ProviderClientOptions = {
  provider: string;
  /** Requests must finish before this; callers keep their own write time back. */
  deadlineAt: number;
  budget: number;
  allowedHosts: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Reads a provider error code (a number or short token) from an error body. Never message text. */
  errorCode?: (body: unknown) => string | null;
  /** Some providers send 400/403 for rate limits; this reports whether a response is one. */
  isRateLimited?: (status: number, code: string | null) => boolean;
  fetchImpl?: typeof fetch;
};

export type ProviderRequest = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
};

const MIN_REQUEST_MS = 1_000;
const MAX_RETRY_WAIT_MS = 15_000;

export function createProviderClient(options: ProviderClientOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxResponseBytes ?? 2_000_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const state = { requests: 0, pausedUntil: 0 };

  async function request(target: string | URL, init: ProviderRequest = {}): Promise<unknown> {
    const url = providerUrl(target, options.allowedHosts);
    for (let attempt = 0; ; attempt += 1) {
      const pause = state.pausedUntil - Date.now();
      if (pause > 0) await sleep(pause);
      if (state.requests >= options.budget) throw new ProviderStop("budget");
      const remaining = options.deadlineAt - Date.now();
      if (remaining < MIN_REQUEST_MS) throw new ProviderStop("deadline");
      state.requests += 1;

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: init.method ?? "GET",
          headers: { accept: "application/json", ...init.headers },
          body: init.body,
          // Providers never redirect API calls; following one could leak a header token.
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
          cache: "no-store",
        });
      } catch (error) {
        if (attempt === 0 && Date.now() + MIN_REQUEST_MS < options.deadlineAt) continue;
        throw error instanceof Error && error.name === "TimeoutError" ? new ProviderStop("deadline") : new Error(`${options.provider}_network_error`);
      }

      if (!response.ok) {
        const code = await errorCodeOf(response, options.errorCode);
        const rateLimited = response.status === 429 || Boolean(options.isRateLimited?.(response.status, code));
        if ((rateLimited || response.status >= 500) && attempt < 2) {
          const wait = rateLimited ? retryAfterMs(response.headers.get("retry-after")) : 1_000 * (attempt + 1);
          if (wait <= MAX_RETRY_WAIT_MS && Date.now() + wait + MIN_REQUEST_MS < options.deadlineAt) {
            // A rate limit applies to the whole credential, so every caller waits it out.
            if (rateLimited) state.pausedUntil = Math.max(state.pausedUntil, Date.now() + wait);
            else await sleep(wait);
            continue;
          }
        }
        if (rateLimited) throw new ProviderStop("rate_limited");
        throw new ProviderHttpError(options.provider, response.status, code);
      }
      try {
        return await readJson(response, maxBytes, options.provider);
      } catch (error) {
        // The request's timeout also covers the body; a body that stalls is the deadline, not bad data.
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ProviderStop("deadline");
        throw error;
      }
    }
  }

  return {
    request,
    get requests() { return state.requests; },
  };
}

export type ProviderClient = ReturnType<typeof createProviderClient>;

/** Only HTTPS URLs on the provider's own hosts, with no credentials embedded in the URL. */
export function providerUrl(target: string | URL, allowedHosts: readonly string[]) {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error("provider_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "" || !allowedHosts.includes(url.hostname)) {
    throw new Error("provider_url_not_allowed");
  }
  return url;
}

export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 5_000;
  const seconds = Number(value);
  if (value.trim() && Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : 5_000;
}

const MAX_ERROR_BYTES = 20_000;

async function errorCodeOf(response: Response, read?: (body: unknown) => string | null) {
  try {
    if (!read) {
      await response.body?.cancel();
      return null;
    }
    const text = await readCapped(response, MAX_ERROR_BYTES);
    if (!text) return null;
    const code = read(JSON.parse(text));
    // Codes are identifiers, never free text that could echo a token back.
    return code && /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

async function readJson(response: Response, maxBytes: number, provider: string) {
  const text = await readCapped(response, maxBytes);
  if (text === null) throw new Error(`${provider}_response_too_large`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${provider}_response_not_json`);
  }
}

/** The body as text, or null once it passes maxBytes (declared or streamed); stops reading at the cap. */
export async function readCapped(response: Pick<Response, "headers" | "body">, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (response.headers.has("content-length") && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
