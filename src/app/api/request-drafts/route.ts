import { createHash, randomBytes, randomUUID } from "node:crypto";
import { publicRequestFingerprint } from "@/lib/http/request-quota";
import { after } from "next/server";
import { extractRequestDemand } from "@/lib/ai/request-demand";
import { createLegalAcceptanceEnvelope } from "@/lib/legal/handoff-acceptance";
import { isCurrentHandoffPolicyVersion } from "@/lib/legal/policy-versions";
import { recordRequestSaveDiagnostic } from "@/lib/operations/request-save-diagnostics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  websiteRequestDraftSchema,
  type WebsiteRequestDraftInput,
} from "@/lib/validation/website-request-draft";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 100_000;
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 8;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  const bodyResult = await readLimitedJson(request);
  if (bodyResult.status === "too_large") return Response.json({ error: "Request body is too large" }, { status: 413 });
  if (bodyResult.status === "invalid") return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const parsed = websiteRequestDraftSchema.safeParse(
    bodyResult.value && typeof bodyResult.value === "object" && "draft" in bodyResult.value
      ? bodyResult.value.draft
      : null,
  );
  if (!parsed.success) {
    return Response.json({ error: "Check the request details and retry." }, { status: 400 });
  }
  if (!isCurrentHandoffPolicyVersion(parsed.data.legalAcceptanceVersions)) {
    return Response.json(
      { error: "The legal terms changed while this page was open. Refresh the page, review them, and retry." },
      { status: 409 },
    );
  }

  let saveStage = "initialize";
  try {
    saveStage = "create_admin_client";
    const admin = createSupabaseAdminClient();
    saveStage = "consume_rate_limit";
    const allowed = await consumePublicRequestAllowance(admin, publicRequestFingerprint(request, "request-draft-save"));
    if (!allowed) {
      recordRequestSaveDiagnostic({ status: "rate_limited", stage: saveStage, errorCode: "request_limit_exceeded" });
      return Response.json({ error: "Too many requests. Please wait a few minutes and retry." }, { status: 429 });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const input = parsed.data;
    const writtenBrief = input.transcript.trim();
    const plainLanguageScope = input.systemBlocks.map((block) => `${block.title}: ${block.detail}`).join("\n");
    const readyToSubmit = writtenBrief.length > 0;
    recordRequestSaveDiagnostic({
      status: "started",
      stage: saveStage,
      hasVoice: Boolean(input.voiceMemo),
      transcriptCharacters: writtenBrief.length,
      systemBlockCount: input.systemBlocks.length,
    });
    saveStage = "insert_request_draft";
    const { data, error } = await admin
      .from("request_drafts")
      .insert({
        token_hash: tokenHash,
        status: readyToSubmit ? "ready_to_submit" : "draft",
        payload: {
          legalAcceptance: createLegalAcceptanceEnvelope(input.legalAcceptanceVersions),
          stage: 4,
          status: "draft",
          title: input.title,
          transcript: input.transcript,
          clarificationAnswer: input.clarificationAnswer,
          clarificationAnswers: input.clarificationAnswers ?? [],
          developmentBrief: input.developmentBrief ?? null,
          emailBrief: input.emailBrief ?? null,
          extractedContext: {
            source: "website_request_flow",
            captureType: input.voiceMemo ? "voice" : "written",
            writtenBrief,
          },
          systemBlocks: input.systemBlocks,
          plainLanguageScope,
          pricingTier: "guided_custom",
          quotedAmountCents: null,
          voiceMemo: {
            storagePath: null,
            status: input.voiceMemo ? "pending_upload" : "not_provided",
            fileName: input.voiceMemo ? voiceMemoFileName(input.voiceMemo.mimeType) : null,
            mimeType: input.voiceMemo?.mimeType ?? null,
            byteLength: input.voiceMemo?.byteLength ?? null,
            durationSeconds: input.voiceMemo?.durationSeconds ?? null,
            transcriptPlaceholder: input.voiceMemo ? "Voice note captured in the website request flow." : "",
          },
        },
      })
      .select("id, status, updated_at")
      .single();

    if (error) throw error;
    const transcriptFingerprint = readyToSubmit
      ? createHash("sha256").update(writtenBrief, "utf8").digest("hex")
      : null;
    const approvedHash = readyToSubmit
      ? createHash("sha256").update(JSON.stringify(input.systemBlocks), "utf8").digest("hex")
      : null;
    saveStage = "insert_ai_state";
    const { error: workflowError } = await admin.from("request_draft_ai_states").insert({
      request_draft_id: data.id,
      state: readyToSubmit ? "ready_to_submit" : "awaiting_verified_transcript",
      transcript_fingerprint: transcriptFingerprint,
      transcript_revision: readyToSubmit ? 1 : 0,
      clarification_round: clarificationRound(input),
      reflection_round: readyToSubmit ? 1 : 0,
      latest_extraction: {
        source: "customer_approved_website_flow",
        demand: null,
        clarificationAnswer: input.clarificationAnswer,
        clarificationAnswers: input.clarificationAnswers ?? [],
        developmentBrief: input.developmentBrief ?? null,
        emailBrief: input.emailBrief ?? null,
      },
      latest_scope: {
        systemBlocks: input.systemBlocks,
        plainLanguageScope,
      },
      approved_system_definition: readyToSubmit ? input.systemBlocks : [],
      approved_plain_language_scope: readyToSubmit ? plainLanguageScope : null,
      approved_revision: readyToSubmit ? 1 : null,
      approved_hash: approvedHash,
      confidence: null,
      requires_human_review: false,
    });
    if (workflowError) {
      await discardUnpublishedDraft(admin, data.id);
      throw workflowError;
    }
    let voiceMemoUpload: { path: string; token: string } | undefined;

    if (input.voiceMemo) {
      saveStage = "prepare_voice_memo";
      const fileName = voiceMemoFileName(input.voiceMemo.mimeType);
      const storagePath = `drafts/${data.id}/${randomUUID()}-${fileName}`;
      const { error: memoError } = await admin.from("voice_memos").insert({
        request_draft_id: data.id,
        storage_path: storagePath,
        status: "pending_upload",
        duration_seconds: input.voiceMemo.durationSeconds,
        original_filename: fileName,
        mime_type: input.voiceMemo.mimeType,
        byte_length: input.voiceMemo.byteLength,
      });
      if (memoError) {
        await discardUnpublishedDraft(admin, data.id);
        throw memoError;
      }

      const { data: signedUpload, error: signedUploadError } = await admin.storage
        .from("voice-memos")
        .createSignedUploadUrl(storagePath);
      if (signedUploadError) {
        await discardUnpublishedDraft(admin, data.id);
        throw signedUploadError;
      }
      voiceMemoUpload = { path: storagePath, token: signedUpload.token };
    }

    if (readyToSubmit && transcriptFingerprint) {
      scheduleRequestDemandAnalysis({
        draftId: data.id,
        transcriptFingerprint,
        input: {
          title: input.title,
          transcript: input.transcript,
          clarificationAnswers: input.clarificationAnswers,
          developmentBrief: input.developmentBrief,
          systemBlocks: input.systemBlocks,
        },
        latestExtraction: {
          source: "customer_approved_website_flow",
          clarificationAnswer: input.clarificationAnswer,
          clarificationAnswers: input.clarificationAnswers ?? [],
          developmentBrief: input.developmentBrief ?? null,
          emailBrief: input.emailBrief ?? null,
        },
      });
    }

    saveStage = "complete";
    recordRequestSaveDiagnostic({ status: "succeeded", stage: saveStage, hasVoice: Boolean(input.voiceMemo) });
    return Response.json({ draft: data, draftToken: token, voiceMemoUpload }, { status: 201 });
  } catch (error) {
    const errorCode = requestSaveErrorCode(error);
    console.error("[request-drafts] save_failed", JSON.stringify({
      stage: saveStage,
      errorCode,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    recordRequestSaveDiagnostic({ status: "failed", stage: saveStage, errorCode });
    return Response.json({
      error: "Your request could not be saved. Please retry.",
      ...(process.env.NODE_ENV === "development" ? { diagnostic: { stage: saveStage, errorCode } } : {}),
    }, { status: 503 });
  }
}

type RequestDemandInput = Pick<
  WebsiteRequestDraftInput,
  "title" | "transcript" | "clarificationAnswers" | "developmentBrief" | "systemBlocks"
>;

type RequestDemandAnalysisJob = {
  draftId: string;
  transcriptFingerprint: string;
  input: RequestDemandInput;
  latestExtraction: Record<string, unknown>;
};

type RequestDemandAnalysisDependencies = {
  schedule?: (task: () => void | Promise<void>) => void;
  persist?: (job: RequestDemandAnalysisJob) => Promise<void>;
};

export function scheduleRequestDemandAnalysis(
  job: RequestDemandAnalysisJob,
  dependencies: RequestDemandAnalysisDependencies = {},
) {
  const schedule = dependencies.schedule ?? after;
  const persist = dependencies.persist ?? persistRequestDemandAnalysis;
  try {
    schedule(async () => {
      try {
        await persist(job);
      } catch (error) {
        // The customer-approved request is already durable. Aggregate demand
        // classification is enrichment and must never invalidate that save.
        console.error("Post-response request demand extraction failed", {
          draftId: job.draftId,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  } catch (error) {
    // Some non-Next runtimes cannot register after-work. Saving the request is
    // still the source-of-truth outcome, so scheduling remains best-effort.
    console.error("Post-response request demand extraction could not be scheduled", {
      draftId: job.draftId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function persistRequestDemandAnalysis(job: RequestDemandAnalysisJob) {
  const demandResult = await extractRequestDemand(job.input);
  const admin = createSupabaseAdminClient();
  const { error: runError } = await admin.from("request_draft_ai_runs").insert({
    request_draft_id: job.draftId,
    task: "extraction",
    input_fingerprint: job.transcriptFingerprint,
    idempotency_key: `${job.draftId}:request-demand:${job.transcriptFingerprint}`,
    provider: demandResult.extraction.provider,
    model: demandResult.extraction.model,
    prompt_version: demandResult.extraction.promptVersion,
    status: demandResult.extraction.method === "ai" ? "succeeded" : "skipped",
    attempt: demandResult.extraction.method === "ai" ? 1 : 0,
    max_attempts: 2,
    route_reasons: demandResult.routeReasons,
    token_usage: demandResult.tokenUsage,
    latency_ms: demandResult.latencyMs,
    result: demandResult.extraction,
    completed_at: new Date().toISOString(),
  });
  if (runError && runError.code !== "23505") throw runError;

  const { error: stateError } = await admin.rpc("persist_request_demand_analysis", {
    p_draft_id: job.draftId,
    p_transcript_fingerprint: job.transcriptFingerprint,
    p_latest_extraction: {
      ...job.latestExtraction,
      demand: demandResult.extraction,
    },
    p_confidence: demandResult.extraction.confidence,
  });
  if (stateError) throw stateError;
}

type DraftCleanupClient = Pick<ReturnType<typeof createSupabaseAdminClient>, "rpc" | "from">;

/**
 * Compensates a save that failed before its capability was returned. The RPC
 * also removes the draft's cohort contribution so failed saves never count as
 * saved briefs; before that migration is applied, fall back to a plain delete.
 */
export async function discardUnpublishedDraft(admin: DraftCleanupClient, draftId: string) {
  const { error } = await admin.rpc("discard_unpublished_request_draft", { p_draft_id: draftId });
  if (!error) return;
  await admin.from("request_drafts").delete().eq("id", draftId);
}

type AllowanceClient = Pick<ReturnType<typeof createSupabaseAdminClient>, "rpc">;

export async function consumePublicRequestAllowance(admin: AllowanceClient, fingerprint: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await admin.rpc("consume_public_request_allowance", {
      p_fingerprint: fingerprint,
      p_limit: MAX_REQUESTS_PER_WINDOW,
      p_window_seconds: Math.floor(WINDOW_MS / 1_000),
    });
    if (!error) return Boolean(data);
    lastError = error;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw lastError;
}

export function clarificationRound(
  input: Pick<WebsiteRequestDraftInput, "clarificationAnswer"> &
    Partial<Pick<WebsiteRequestDraftInput, "clarificationAnswers">>,
) {
  // A generated batch can contain up to five questions, but it is still one
  // workflow clarification round. The database intentionally caps rounds at 2.
  return (input.clarificationAnswers?.length ?? 0) > 0 || Boolean(input.clarificationAnswer?.trim()) ? 1 : 0;
}

function requestSaveErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown_error";
  const value = error as { code?: unknown; name?: unknown };
  if (typeof value.code === "string") return value.code;
  if (typeof value.name === "string") return value.name;
  return "unclassified_error";
}

function voiceMemoFileName(mimeType: string) {
  const extension = mimeType === "audio/mp4"
    ? "m4a"
    : mimeType === "audio/mpeg"
      ? "mp3"
      : mimeType === "audio/ogg"
        ? "ogg"
        : mimeType === "audio/wav"
          ? "wav"
          : "webm";
  return `voice-note.${extension}`;
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}


export async function readLimitedJson(request: Request): Promise<
  | { status: "ok"; value: unknown }
  | { status: "invalid" }
  | { status: "too_large" }
> {
  if (!request.body) return { status: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return { status: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { status: "invalid" };
  }
}
