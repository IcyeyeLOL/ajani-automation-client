import { createHash } from "node:crypto";
import { z } from "zod";
import { readLimitedJson } from "@/lib/http/read-limited-json";
import { deleteRequestDraftData } from "@/lib/request-drafts/delete-request-draft";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const deleteSchema = z.object({
  draftToken: z.string().min(32).max(128),
});
const MAX_BODY_BYTES = 4_096;

export async function DELETE(request: Request, context: RouteContext<"/api/request-drafts/[draftId]">) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  const body = await readLimitedJson(request, MAX_BODY_BYTES);
  if (body.status === "too_large") {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  if (body.status === "invalid") {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: "The draft capability is invalid." }, { status: 400 });

  const { draftId } = await context.params;
  const tokenHash = createHash("sha256").update(parsed.data.draftToken, "utf8").digest("hex");

  try {
    const admin = createSupabaseAdminClient();
    const { data: draft, error } = await admin
      .from("request_drafts")
      .select("id,status,claimed_by,submitted_build_request_id")
      .eq("id", draftId)
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error || !draft || draft.claimed_by || draft.submitted_build_request_id || !["draft", "ready_to_submit"].includes(draft.status)) {
      return Response.json({ error: "The draft is unavailable." }, { status: 404 });
    }

    const deleted = await deleteRequestDraftData(admin, draft.id);
    return Response.json({ deleted: true, ...deleted });
  } catch (error) {
    console.error("Draft deletion failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "The draft could not be deleted. Please retry." }, { status: 503 });
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
