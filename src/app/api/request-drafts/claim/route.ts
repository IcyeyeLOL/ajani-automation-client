import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { z } from "zod";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { provisionClerkWorkspace } from "@/lib/clerk/provisioning";
import { readLimitedJson } from "@/lib/http/read-limited-json";
import { processBuildRequestNotifications } from "@/lib/notifications/build-request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const claimSchema = z.object({
  draftId: z.string().uuid(),
  draftToken: z.string().min(32).max(128),
});
const MAX_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (!hasClerkCredentials()) return Response.json({ error: "Account access is unavailable." }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  const { userId, orgId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = await readLimitedJson(request, MAX_BODY_BYTES);
  if (body.status === "too_large") {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  if (body.status === "invalid") {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = claimSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: "The saved request capability is invalid." }, { status: 400 });

  try {
    const admin = createSupabaseAdminClient();
    const tokenHash = createHash("sha256").update(parsed.data.draftToken, "utf8").digest("hex");
    const { data: availableDraft, error: availabilityError } = await admin
      .from("request_drafts")
      .select("id,expires_at,submitted_build_request_id")
      .eq("id", parsed.data.draftId)
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (availabilityError
      || !availableDraft
      || Date.parse(availableDraft.expires_at) <= Date.now()
      || availableDraft.submitted_build_request_id) {
      return Response.json({ error: "The saved request is unavailable." }, { status: 404 });
    }

    const workspace = await provisionClerkWorkspace(userId, orgId ?? null);
    if (workspace.requiresActivation) {
      return Response.json({
        status: "organization_activation_required",
        organizationId: workspace.clerkOrganizationId,
      });
    }

    const { data: claimedRows, error: claimError } = await admin.rpc("claim_request_draft", {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_organization_id: workspace.organizationId,
    });
    if (claimError) return Response.json({ error: "The saved request could not be claimed." }, { status: 409 });

    const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
    if (!claimed || claimed.id !== parsed.data.draftId) {
      return Response.json({ error: "The saved request is unavailable." }, { status: 404 });
    }

    if (claimed.status !== "ready_to_submit") {
      return Response.json({ status: "claimed", draftId: claimed.id });
    }

    const { data: submittedRows, error: submitError } = await admin.rpc("submit_request_draft", {
      p_draft_id: claimed.id,
      p_user_id: userId,
      p_organization_id: workspace.organizationId,
    });
    if (submitError) return Response.json({ error: "The request is claimed but not ready to submit yet." }, { status: 409 });

    const submitted = Array.isArray(submittedRows) ? submittedRows[0] : submittedRows;
    if (submitted?.build_request_id) {
      try {
        const buildRequestId = submitted.build_request_id;
        after(async () => {
          try {
            await processBuildRequestNotifications({ buildRequestId, limit: 1 });
          } catch (error) {
            // The database job is durable and the scheduled worker will retry it.
            console.error("Post-response build request notification failed", {
              buildRequestId,
              message: error instanceof Error ? error.message : "Unknown error",
            });
          }
        });
      } catch (error) {
        // Scheduling is also best-effort. The durable cron job remains the source
        // of recovery, so a submitted request must still receive confirmation.
        console.error("Post-response build request notification could not be scheduled", {
          buildRequestId: submitted.build_request_id,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    console.info("[request-drafts/claim] submitted", {
      draftId: claimed.id,
      buildRequestId: submitted?.build_request_id ?? null,
      organizationId: workspace.organizationId,
    });
    return Response.json({ status: "submitted", buildRequest: submitted });
  } catch (error) {
    console.error("Draft claim failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "The saved request could not be connected to your account." }, { status: 503 });
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
