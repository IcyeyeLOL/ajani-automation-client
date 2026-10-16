import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getAdminAllowlist, isAdminIdentityAllowed } from "@/lib/admin/authorization";
import { hasClerkCredentials } from "@/lib/clerk/config";

export type AdminClerkResolution =
  | { status: "allowed"; userId: string }
  | { status: "signed_out" }
  | { status: "forbidden" };

/** Non-throwing identity check for JSON route handlers. */
export async function resolveAdminClerkUser(): Promise<AdminClerkResolution> {
  if (!hasClerkCredentials()) return { status: "signed_out" };

  const { userId } = await auth();
  if (!userId) return { status: "signed_out" };

  const user = await currentUser();
  const emails = user?.emailAddresses
    .filter((address) => address.verification?.status === "verified")
    .map((address) => address.emailAddress) ?? [];
  if (!isAdminIdentityAllowed({ userId, emails }, getAdminAllowlist())) return { status: "forbidden" };

  return { status: "allowed", userId };
}

export async function requireAdminClerkUser(returnTo = "/admin") {
  const resolution = await resolveAdminClerkUser();
  if (resolution.status === "signed_out") redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  if (resolution.status === "forbidden") notFound();
  return resolution.userId;
}
