import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { OrganizationJSON, OrganizationMembershipJSON, UserJSON } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!signingSecret) return Response.json({ error: "Webhook is not configured" }, { status: 503 });

  let event;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return Response.json({ error: "Webhook signature is invalid" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const eventId = request.headers.get("svix-id");
    if (!eventId) return Response.json({ error: "Webhook event ID is missing" }, { status: 400 });
    const eventAt = timestamp("timestamp" in event ? Number(event.timestamp) : undefined, deliveryTimestamp(request));
    const { data: claimed, error: claimError } = await admin.rpc("claim_clerk_webhook_delivery_v2", {
      p_event_id: eventId,
      p_event_type: event.type,
    });
    if (claimError) throw claimError;
    if (claimed?.state === "completed") return Response.json({ received: true, duplicate: true });
    if (claimed?.state === "busy") return Response.json({ error: "Delivery is still being processed" }, { status: 503, headers: { "Retry-After": "60" } });
    if (claimed?.state !== "claimed" || !Number.isSafeInteger(claimed.attempt) || claimed.attempt < 1) {
      throw new Error("webhook_claim_invalid");
    }
    const attempt = claimed.attempt as number;

    try {
    if (event.type === "user.created" || event.type === "user.updated") {
      await syncUser(admin, event.data, timestamp(event.data.updated_at, eventAt));
    } else if (event.type === "user.deleted" && event.data.id) {
      const { error } = await admin.rpc("sync_clerk_profile", {
        p_id: event.data.id,
        p_full_name: null,
        p_email: null,
        p_phone: null,
        p_avatar_url: null,
        p_event_at: eventAt,
        p_deleted: true,
      });
      if (error) throw error;
    } else if (event.type === "organization.created" || event.type === "organization.updated") {
      await syncOrganization(admin, event.data, timestamp(event.data.updated_at, eventAt));
    } else if (event.type === "organization.deleted" && event.data.id) {
      const { error } = await admin.rpc("sync_clerk_organization", {
        p_clerk_organization_id: event.data.id,
        p_owner_id: null,
        p_business_name: null,
        p_clerk_slug: null,
        p_avatar_url: null,
        p_event_at: eventAt,
        p_archived: true,
      });
      if (error) throw error;
    } else if (event.type === "organizationMembership.created" || event.type === "organizationMembership.updated") {
      await syncMembership(admin, event.data, timestamp(event.data.updated_at, eventAt));
    } else if (event.type === "organizationMembership.deleted") {
      const { error } = await admin.rpc("record_clerk_deletion", {
        p_entity_kind: "membership",
        p_provider_id: event.data.id,
        p_event_at: eventAt,
      });
      if (error) throw error;
    }
    const { data: finished, error: finishError } = await admin.rpc("finish_clerk_webhook_delivery_v2", {
      p_event_id: eventId,
      p_attempt: attempt,
      p_error: null,
    });
    if (finishError) throw finishError;
    if (!finished) return Response.json({ error: "Delivery lease changed. Please retry." }, { status: 503 });
    return Response.json({ received: true });
    } catch (error) {
      await admin.rpc("finish_clerk_webhook_delivery_v2", {
        p_event_id: eventId,
        p_attempt: attempt,
        p_error: safeError(error),
      });
      throw error;
    }
  } catch (error) {
    console.error("Clerk webhook processing failed", {
      eventType: event.type,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Webhook could not be processed" }, { status: 503 });
  }
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function syncUser(admin: AdminClient, user: UserJSON, eventAt: string) {
  const primaryEmail = user.email_addresses.find((item) => item.id === user.primary_email_address_id)?.email_address
    ?? user.email_addresses[0]?.email_address
    ?? null;
  const primaryPhone = user.phone_numbers.find((item) => item.id === user.primary_phone_number_id)?.phone_number
    ?? user.phone_numbers[0]?.phone_number
    ?? null;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || primaryEmail;
  const { error } = await admin.rpc("sync_clerk_profile", {
    p_id: user.id,
    p_full_name: fullName,
    p_email: primaryEmail,
    p_phone: primaryPhone,
    p_avatar_url: user.image_url,
    p_event_at: eventAt,
    p_deleted: false,
  });
  if (error) throw error;
}

async function syncOrganization(admin: AdminClient, organization: OrganizationJSON, eventAt: string) {
  const { data, error } = await admin.rpc("sync_clerk_organization", {
    p_clerk_organization_id: organization.id,
    p_owner_id: organization.created_by ?? null,
    p_business_name: organization.name,
    p_clerk_slug: organization.slug,
    p_avatar_url: organization.image_url ?? null,
    p_event_at: eventAt,
    p_archived: false,
  });
  if (error) throw error;
  if (typeof data === "string") return data;

  const { data: existing, error: existingError } = await admin.from("organizations")
    .select("id")
    .eq("clerk_organization_id", organization.id)
    .maybeSingle();
  if (existingError) throw existingError;
  return existing?.id as string | undefined;
}

async function syncMembership(admin: AdminClient, membership: OrganizationMembershipJSON, eventAt: string) {
  const user = membership.public_user_data;
  let organizationId = await syncOrganization(
    admin,
    membership.organization,
    timestamp(membership.organization.updated_at, eventAt),
  );
  if (!organizationId) {
    const { data, error } = await admin.from("organizations")
      .select("id")
      .eq("clerk_organization_id", membership.organization.id)
      .maybeSingle();
    if (error) throw error;
    organizationId = data?.id ?? null;
  }
  if (!organizationId) return;

  const { error } = await admin.rpc("sync_clerk_membership", {
    p_organization_id: organizationId,
    p_user_id: user.user_id,
    p_role: membership.role === "org:admin" ? "owner" : "member",
    p_clerk_membership_id: membership.id,
    p_clerk_role: membership.role,
    p_event_at: eventAt,
    p_deleted: false,
  });
  if (error) throw error;
}

function deliveryTimestamp(request: Request) {
  const seconds = Number(request.headers.get("svix-timestamp"));
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000).toISOString() : new Date().toISOString();
}

function timestamp(value: number | null | undefined, fallback: string) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : fallback;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown error").replace(/[\r\n]+/g, " ").slice(0, 500);
}
