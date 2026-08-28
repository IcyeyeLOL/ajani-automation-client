import { createHash } from "node:crypto";
import { z } from "zod";
import { generateAutomationIntake, generateAutomationShape } from "@/lib/ai/automation-workflow";
import { readLimitedJson } from "@/lib/http/read-limited-json";
import { MIN_TYPED_NOTE_CHARACTERS } from "@/lib/record/typed-note-analysis";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 32_000;
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_GENERATIONS_PER_WINDOW = 12;
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clarify"), transcript: z.string().trim().min(MIN_TYPED_NOTE_CHARACTERS).max(20_000) }),
  z.object({
    action: z.literal("shape"),
    transcript: z.string().trim().min(MIN_TYPED_NOTE_CHARACTERS).max(20_000),
    clarificationAnswers: z.array(z.object({
      question: z.string().trim().min(1).max(240),
      answer: z.string().trim().min(1).max(500),
    })).min(1).max(5),
  }),
]);

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return Response.json({ error: "The note is too large" }, { status: 413 });
  const body = await readLimitedJson(request, MAX_BODY_BYTES);
  if (body.status === "too_large") return Response.json({ error: "The note is too large" }, { status: 413 });
  if (body.status === "invalid") return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: "Add a complete note and confirmed answers" }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const { data: allowed, error } = await admin.rpc("consume_public_request_allowance", {
      p_fingerprint: requestFingerprint(request),
      p_limit: MAX_GENERATIONS_PER_WINDOW,
      p_window_seconds: Math.floor(WINDOW_MS / 1_000),
    });
    if (error) throw error;
    if (!allowed) return Response.json({ error: "Too many AI requests. Please wait a few minutes and retry." }, { status: 429 });
  } catch (error) {
    console.error("[automation-brief] rate_limit_failed", {
      message: error instanceof Error ? error.message : "unknown_rate_limit_error",
    });
    return Response.json({ error: "AI analysis is temporarily unavailable." }, { status: 503 });
  }

  const result = parsed.data.action === "clarify"
    ? await generateAutomationIntake(parsed.data.transcript)
    : await generateAutomationShape(parsed.data.transcript, parsed.data.clarificationAnswers);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const salt = process.env.REQUEST_RATE_LIMIT_SECRET || process.env.AJANI_ADMIN_SESSION_SECRET;
  if (!salt && process.env.NODE_ENV === "production") throw new Error("request_rate_limit_secret_missing");
  return createHash("sha256").update(`${address}:${salt}`).digest("hex");
}
