import "server-only";

import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ProvisionedWorkspace = {
  clerkOrganizationId: string;
  organizationId: string;
  requiresActivation: boolean;
};

export async function provisionClerkWorkspace(userId: string, activeOrganizationId: string | null): Promise<ProvisionedWorkspace> {
  const clerk = await clerkClient();
  const [user, membershipPage] = await Promise.all([
    clerk.users.getUser(userId),
    activeOrganizationId
      ? clerk.organizations.getOrganizationMembershipList({ organizationId: activeOrganizationId, userId: [userId], limit: 1 })
      : clerk.users.getOrganizationMembershipList({ userId, limit: 1 }),
  ]);
  let membership = activeOrganizationId
    ? membershipPage.data.find((item) => item.organization.id === activeOrganizationId)
    : membershipPage.data[0];

  if (activeOrganizationId && !membership) throw new Error("active_organization_membership_missing");

  if (!membership) {
    const name = workspaceName(user.firstName, user.lastName);
    const slug = `ajani-${createHash("sha256").update(userId).digest("hex").slice(0, 18)}`;
    let organization;
    try {
      organization = await clerk.organizations.createOrganization({ name, slug, createdBy: userId });
    } catch {
      organization = await clerk.organizations.getOrganization({ slug });
    }
    const refreshed = await clerk.organizations.getOrganizationMembershipList({
      organizationId: organization.id,
      userId: [userId],
      limit: 1,
    });
    membership = refreshed.data.find((item) => item.organization.id === organization.id);
    if (!membership) throw new Error("organization_membership_provisioning_failed");
  }

  const email = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId)?.emailAddress
    ?? user.emailAddresses[0]?.emailAddress
    ?? null;
  const phone = user.phoneNumbers.find((item) => item.id === user.primaryPhoneNumberId)?.phoneNumber
    ?? user.phoneNumbers[0]?.phoneNumber
    ?? null;
  if (!email) throw new Error("clerk_email_required_for_handoff");
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || email || "Ajani client";
  const admin = createSupabaseAdminClient();
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    full_name: fullName,
    email,
    phone,
    avatar_url: user.imageUrl,
    clerk_updated_at: new Date().toISOString(),
    deleted_at: null,
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const organizationResult = await admin
    .from("organizations")
    .select("id")
    .eq("clerk_organization_id", membership.organization.id)
    .maybeSingle();
  if (organizationResult.error) throw organizationResult.error;
  let organization = organizationResult.data;

  if (!organization) {
    const inserted = await admin.from("organizations").insert({
      owner_id: userId,
      business_name: membership.organization.name,
      clerk_organization_id: membership.organization.id,
      clerk_slug: membership.organization.slug,
      avatar_url: membership.organization.imageUrl,
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    organization = inserted.data;
  }

  const isOwner = membership.role === "org:admin";
  const { error: membershipError } = await admin.from("organization_members").upsert({
    organization_id: organization.id,
    user_id: userId,
    role: isOwner ? "owner" : "member",
    clerk_membership_id: membership.id,
    clerk_role: membership.role,
  }, { onConflict: "organization_id,user_id" });
  if (membershipError) throw membershipError;

  return {
    clerkOrganizationId: membership.organization.id,
    organizationId: organization.id,
    requiresActivation: activeOrganizationId !== membership.organization.id,
  };
}

function workspaceName(firstName: string | null, lastName: string | null) {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name ? `${name}'s workspace` : "My Ajani workspace";
}
