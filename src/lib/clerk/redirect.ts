export const DEFAULT_AUTH_REDIRECT = "/portal";

const SITE_ORIGIN = "https://ajaniflow.com";
const siteHosts = new Set(["ajaniflow.com", "www.ajaniflow.com"]);
const exactDestinations = new Set(["/record", "/admin", "/admin/login"]);

/**
 * Where to send someone after they sign in or up. Accepts a path on this site,
 * or a full ajaniflow.com address (Clerk sends those), and returns only the
 * path and query so the browser can never be pointed at another site.
 */
export function resolveAuthRedirect(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (candidate && sameSiteDestination(candidate)) || DEFAULT_AUTH_REDIRECT;
}

function sameSiteDestination(candidate: string) {
  // Browsers read "\" as "/" and drop tabs and line breaks, so "/\evil.com"
  // or "/<tab>/evil.com" would become a link to another site.
  if (candidate.length > 2_048 || /[\\\u0000-\u001f\u007f]/.test(candidate)) return null;
  const isPath = candidate.startsWith("/") && !candidate.startsWith("//");
  if (!isPath && !/^https?:\/\//i.test(candidate)) return null;

  let url: URL;
  try {
    url = new URL(candidate, SITE_ORIGIN);
  } catch {
    return null;
  }
  if (!siteHosts.has(url.hostname)) return null;

  // The parser has already resolved "." and ".." segments, including encoded ones.
  const path = url.pathname;
  const allowed = path === DEFAULT_AUTH_REDIRECT || path.startsWith(`${DEFAULT_AUTH_REDIRECT}/`) || exactDestinations.has(path);
  return allowed ? `${path}${url.search}` : null;
}

export function authPageUrl(path: "/sign-in" | "/sign-up", redirectTo: string) {
  const safeRedirect = resolveAuthRedirect(redirectTo);
  return safeRedirect === DEFAULT_AUTH_REDIRECT
    ? path
    : `${path}?redirect_url=${encodeURIComponent(safeRedirect)}`;
}
