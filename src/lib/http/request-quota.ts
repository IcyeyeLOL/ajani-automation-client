import { createHash } from "node:crypto";

/** Distinct budgets prevent successful AI work from consuming the final save allowance. */
export function publicRequestFingerprint(request: Request, operation: "automation-brief" | "request-draft-save") {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const salt = process.env.REQUEST_RATE_LIMIT_SECRET || process.env.AJANI_ADMIN_SESSION_SECRET;
  if (!salt && process.env.NODE_ENV === "production") throw new Error("request_rate_limit_secret_missing");
  return createHash("sha256").update(`${operation}:${address}:${salt || "development"}`).digest("hex");
}
