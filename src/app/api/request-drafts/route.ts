import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { websiteRequestDraftSchema } from "@/lib/validation/website-request-draft";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 100_000;
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const recentRequests = new Map<string, number[]>();

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  const fingerprint = requestFingerprint(request);
  if (!consumeRequestAllowance(fingerprint)) {
    return Response.json({ error: "Too many requests. Please wait a few minutes and retry." }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = websiteRequestDraftSchema.safeParse(
    body && typeof body === "object" && "draft" in body ? body.draft : null,
  );
  if (!parsed.success) {
    return Response.json({ error: "Check the request details and retry." }, { status: 400 });
  }

  try {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const input = parsed.data;
    const { data, error } = await createSupabaseAdminClient()
      .from("request_drafts")
      .insert({
        token_hash: tokenHash,
        status: "draft",
        payload: {
          stage: 4,
          status: "draft",
          title: input.title,
          transcript: input.transcript,
          clarificationAnswer: input.clarificationAnswer,
          extractedContext: {
            source: "website_request_flow",
            captureType: input.voiceMemo ? "voice" : "written",
          },
          systemBlocks: input.systemBlocks,
          plainLanguageScope: input.systemBlocks.map((block) => `${block.title}: ${block.detail}`).join("\n"),
          pricingTier: "guided_custom",
          quotedAmountCents: null,
          voiceMemo: {
            storagePath: null,
            status: "pending_upload",
            fileName: null,
            mimeType: null,
            byteLength: input.voiceMemo?.byteLength ?? null,
            durationSeconds: input.voiceMemo?.durationSeconds ?? null,
            transcriptPlaceholder: input.voiceMemo ? "Voice note captured in the website request flow." : "",
          },
        },
      })
      .select("id, status, updated_at")
      .single();

    if (error) throw error;
    return Response.json({ draft: data, draftToken: token }, { status: 201 });
  } catch (error) {
    console.error("Website request draft save failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Your request could not be saved. Please retry." }, { status: 503 });
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const salt = process.env.AJANI_ADMIN_SESSION_SECRET || "ajani-request-draft";
  return createHash("sha256").update(`${address}:${salt}`).digest("hex");
}

function consumeRequestAllowance(fingerprint: string) {
  const now = Date.now();
  const active = (recentRequests.get(fingerprint) || []).filter((time) => now - time < WINDOW_MS);
  if (active.length >= MAX_REQUESTS_PER_WINDOW) return false;
  active.push(now);
  recentRequests.set(fingerprint, active);
  return true;
}
