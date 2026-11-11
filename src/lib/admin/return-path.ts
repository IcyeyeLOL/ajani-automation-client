/**
 * Where the desk may send someone after it unlocks: the client builds list or
 * one build, nothing else, so a crafted ?next= can never point anywhere else.
 */
export function adminReturnPath(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  return /^\/admin\/builds(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(candidate) ? candidate : null;
}

/** The desk link for one build, for emails: through the unlock page, which returns to it. */
export function adminBuildLink(appUrl: string, buildId: string) {
  return `${appUrl}/admin/login?next=${encodeURIComponent(`/admin/builds/${buildId}`)}`;
}
