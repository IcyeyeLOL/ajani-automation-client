import "server-only";

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdminClerkUser } from "@/lib/admin/clerk";
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
