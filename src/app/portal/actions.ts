"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { parseClientBuildMessage } from "@/lib/builds/conversation";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { provisionClerkWorkspace } from "@/lib/clerk/provisioning";
import { appUrl, recordBuildMessageEmail, sendBuildMessageEmail } from "@/lib/notifications/build-message";
import { portalSampleMode } from "@/lib/portal/dashboard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PortalMessageState } from "@/app/portal/message-state";

/** A client writes on one of their organization's builds; Ajani is emailed when the email can go. */
export async function sendBuildMessageAction(_state: PortalMessageState, formData: FormData): Promise<PortalMessageState> {
  if (portalSampleMode() || !hasClerkCredentials()) return { status: "error", message: "This is a preview, so nothing was sent." };
  const { userId, orgId } = await auth();
  // A form post can carry an expired sign-in that the server cannot renew.
  if (!userId) return { status: "error", message: "Your sign-in was renewing, so nothing was sent. Press send again." };
  const parsed = parseClientBuildMessage(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { body, buildId } = parsed.value;

  let messageId: string;
  try {
    const workspace = await provisionClerkWorkspace(userId, orgId ?? null);
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("post_client_build_message", {
      p_build_request_id: buildId,
      p_user_id: userId,
      p_organization_id: workspace.organizationId,
      p_body: body,
    });
    if (error) {
      if (error.message.includes("message_rate_limited")) return { status: "error", message: "You've sent a lot of messages in a few minutes. Wait a little, then send again." };
      if (error.message.includes("build_request_not_found")) return { status: "error", message: "This request could not be found in your workspace. Refresh the page." };
      throw error;
    }
    messageId = String(data);
  } catch (error) {
    console.error("Portal message failed", { buildId, message: error instanceof Error ? error.message : "unknown" });
    return { status: "error", message: "Your message could not be sent right now. It is still in the box, so try again in a moment." };
  }

  const emailed = await notifyAjani(buildId, messageId, body);
  revalidatePath(`/portal/builds/${buildId}`);
  return {
    status: "success",
    // Only claim the email when it went; the desk lists the build as waiting either way.
    message: emailed === "sent" ? "Sent. Ajani has been emailed." : "Sent and saved on this build. Ajani will see it in the control desk.",
    sentId: messageId,
  };
}

/** Best effort: the message is saved either way, and the desk lists who is waiting. */
async function notifyAjani(buildId: string, messageId: string, body: string) {
  let result: "sent" | "failed";
  try {
    const admin = createSupabaseAdminClient();
    const { data: build } = await admin.from("build_requests")
      .select("title,organizations(business_name)")
      .eq("id", buildId)
      .maybeSingle();
    const organization = build?.organizations as { business_name?: string | null } | { business_name?: string | null }[] | null | undefined;
    const client = (Array.isArray(organization) ? organization[0]?.business_name : organization?.business_name) || "A client";
    const title = typeof build?.title === "string" ? build.title : "their build";
    result = await sendBuildMessageEmail({
      to: process.env.INTERNAL_NOTIFICATION_TO ?? "",
      subject: `${client} wrote about ${title}`,
      eyebrow: "Client message",
      heading: title,
      intro: `${client} sent a message on this build.`,
      body,
      link: null,
      ctaUrl: `${appUrl()}/admin/builds/${buildId}`,
      ctaLabel: "Reply in the control desk",
      idempotencyKey: `build-message-${messageId}`,
    });
  } catch (error) {
    console.error("Portal message notification failed", { buildId, message: error instanceof Error ? error.message : "unknown" });
    result = "failed";
  }
  await recordBuildMessageEmail(messageId, result);
  return result;
}
