import "server-only";

import { cookies } from "next/headers";

/**
 * "Sample data" mode: the control desk renders made-up numbers so every chart
 * can be seen filled in. The cookie only changes what is rendered; while it is
 * set, every write action refuses before touching the database.
 */
export const SAMPLE_MODE_COOKIE = "ajani_admin_sample";
const SAMPLE_MODE_SECONDS = 8 * 60 * 60;

export async function isSampleMode() {
  return (await cookies()).get(SAMPLE_MODE_COOKIE)?.value === "1";
}

export async function setSampleModeCookie() {
  (await cookies()).set(SAMPLE_MODE_COOKIE, "1", {
    httpOnly: true,
    maxAge: SAMPLE_MODE_SECONDS,
    path: "/admin",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSampleModeCookie() {
  (await cookies()).set(SAMPLE_MODE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/admin",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
