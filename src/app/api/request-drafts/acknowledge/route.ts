import { createHash } from "node:crypto";
import { z } from "zod";
import { readLimitedJson } from "@/lib/http/read-limited-json";
import { createLegalAcceptanceEnvelope } from "@/lib/legal/handoff-acceptance";
import { isCurrentHandoffPolicyVersion } from "@/lib/legal/policy-versions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handoffPolicyVersionSchema } from "@/lib/validation/website-request-draft";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;
const acknowledgmentSchema = z.object({
  draftId: z.string().uuid(),
  draftToken: z.string().min(32).max(128),
  legalAcceptanceAcknowledged: z.literal(true),
  legalAcceptanceVersions: handoffPolicyVersionSchema,
}).strict();

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  const body = await readLimitedJson(request, MAX_BODY_BYTES);
  if (body.status === "too_large") return Response.json({ error: "Request body is too large" }, { status: 413 });
  if (body.status === "invalid") return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });

  const parsed = acknowledgmentSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: "The saved request acknowledgment is invalid." }, { status: 400 });
  if (!isCurrentHandoffPolicyVersion(parsed.data.legalAcceptanceVersions)) {
    return Response.json(
      { error: "The legal terms changed while this page was open. Refresh the page, review them, and retry." },
      { status: 409 },
    );
  }

  try {
    const admin = createSupabaseAdminClient();
    const tokenHash = createHash("sha256").update(parsed.data.draftToken, "utf8").digest("hex");
    const acceptance = createLegalAcceptanceEnvelope(parsed.data.legalAcceptanceVersions);
    const { data: acknowledgedRows, error } = await admin.rpc("acknowledge_request_draft", {
      p_draft_id: parsed.data.draftId,
      p_token_hash: tokenHash,
      p_acceptance: acceptance,
    });
    const acknowledged = Array.isArray(acknowledgedRows) ? acknowledgedRows[0] : acknowledgedRows;

    if (error || !acknowledged?.draft_id) {
      return Response.json({ error: "The saved request is unavailable." }, { status: 404 });
    }

    return Response.json({ status: "acknowledged" });
  } catch (error) {
    console.error("Draft acknowledgment failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "The saved request acknowledgment could not be recorded." }, { status: 503 });
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
