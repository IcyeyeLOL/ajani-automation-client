import "server-only";

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { AdminActionState } from "@/app/admin/action-state";
import { requireAdminClerkUser, resolveAdminClerkUser } from "@/lib/admin/clerk";
import { ADMIN_SESSION_SECONDS, createAdminSessionToken, verifyAdminSessionToken } from "@/lib/admin/session-token";

export { createAdminSessionToken, keysMatch, verifyAdminSessionToken } from "@/lib/admin/session-token";

const COOKIE_NAME = "ajani_admin_session";
export type AdminConfiguration = {
  accessKey: string;
  sessionSecret: string;
};

export function getAdminConfiguration(): AdminConfiguration | null {
  const accessKey = process.env.AJANI_ADMIN_ACCESS_KEY;
  const sessionSecret = process.env.AJANI_ADMIN_SESSION_SECRET;
  if (!accessKey || accessKey.length < 12 || !sessionSecret || sessionSecret.length < 32) return null;
  return { accessKey, sessionSecret };
}

export async function hasAdminSession() {
  const configuration = getAdminConfiguration();
  if (!configuration) return false;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return verifyAdminSessionToken(token, configuration.sessionSecret);
}

export async function requireAdminSession() {
  const userId = await requireAdminClerkUser();
  if (!(await hasAdminSession())) redirect("/admin/login");
  return userId;
}

export type AdminActionAccess = { status: "allowed"; userId: string } | { status: "refused"; state: AdminActionState };

/**
 * Server-action variant of requireAdminSession. Clerk can't renew an expired
 * sign-in token on a form post, so a save that arrives with one gets a message
 * to press save again (the form keeps what was typed) instead of a redirect to
 * sign-in mid-form, which used to bounce between sign-in and the desk.
 */
export async function authorizeAdminAction(): Promise<AdminActionAccess> {
  const resolution = await resolveAdminClerkUser();
  if (resolution.status === "forbidden") notFound();
  if (resolution.status === "signed_out") {
    return { status: "refused", state: { status: "error", message: "Your sign-in was renewing, so nothing was saved. Press save again. If this keeps happening, reload the page." } };
  }
  if (!(await hasAdminSession())) redirect("/admin/login");
  return resolution;
}

/**
 * Route-handler variant of requireAdminSession: returns a status instead of
 * redirecting, so JSON callers get 401/404 rather than an HTML login page.
 */
export async function resolveAdminSession(): Promise<{ status: "allowed"; userId: string } | { status: "unauthorized" | "forbidden" }> {
  const resolution = await resolveAdminClerkUser();
  if (resolution.status === "forbidden") return { status: "forbidden" };
  if (resolution.status === "signed_out" || !(await hasAdminSession())) return { status: "unauthorized" };
  return resolution;
}

export async function setAdminSessionCookie(secret: string) {
  (await cookies()).set(COOKIE_NAME, createAdminSessionToken(secret), {
    httpOnly: true,
    maxAge: ADMIN_SESSION_SECONDS,
    path: "/admin",
    priority: "high",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearAdminSessionCookie() {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/admin",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export function fingerprintRequest(ip: string, userAgent: string, secret: string) {
  return createHmac("sha256", secret).update(`${ip}|${userAgent}`).digest("hex");
}
