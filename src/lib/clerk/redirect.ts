export const DEFAULT_AUTH_REDIRECT = "/portal";

const allowedRedirects = new Set([
  "/portal",
  "/portal/builds",
  "/record",
  "/admin",
  "/admin/login",
]);

export function resolveAuthRedirect(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !allowedRedirects.has(candidate)) return DEFAULT_AUTH_REDIRECT;
  return candidate;
}

export function authPageUrl(path: "/sign-in" | "/sign-up", redirectTo: string) {
  const safeRedirect = resolveAuthRedirect(redirectTo);
  return safeRedirect === DEFAULT_AUTH_REDIRECT
    ? path
    : `${path}?redirect_url=${encodeURIComponent(safeRedirect)}`;
}
