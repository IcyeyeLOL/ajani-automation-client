import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getAdminAllowlist, isAdminIdentityAllowed } from "@/lib/admin/authorization";
import { hasClerkCredentials } from "@/lib/clerk/config";

export async function requireAdminClerkUser(returnTo = "/admin") {
  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;

  if (!hasClerkCredentials()) redirect(signInUrl);

  const { userId } = await auth();
  if (!userId) redirect(signInUrl);

  const user = await currentUser();
  const emails = user?.emailAddresses.map((address) => address.emailAddress) ?? [];
  if (!isAdminIdentityAllowed({ userId, emails }, getAdminAllowlist())) notFound();

  return userId;
}
