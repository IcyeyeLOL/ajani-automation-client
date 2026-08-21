import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { hasClerkCredentials } from "@/lib/clerk/config";

export async function requireAdminClerkUser(returnTo = "/admin") {
  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;

  if (!hasClerkCredentials()) redirect(signInUrl);

  const { userId } = await auth();
  if (!userId) redirect(signInUrl);

  return userId;
}
