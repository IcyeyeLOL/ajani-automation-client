/**
 * Clerk's session token lasts a minute and the browser renews it in the
 * background. A tab that sat hidden (or a laptop that slept) can hold an
 * expired one, and the server can only renew it on a full page load: a form
 * post, a refresh or a fetch with an expired token reads as signed out. So the
 * desk renews the token itself before it talks to the server.
 */

type ClerkSession = { getToken: (options?: { skipCache?: boolean }) => Promise<string | null> };
type ClerkWindow = Window & { Clerk?: { session?: ClerkSession | null } };

/**
 * Renews the sign-in token and writes it to the cookie the server reads. True
 * when there is nothing to renew (no Clerk on the page, e.g. local sign-in-free
 * mode) or the renewal worked; false when it failed (offline, signed out).
 */
export async function renewSignIn(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const clerk = (window as ClerkWindow).Clerk;
  if (!clerk) return true;
  if (!clerk.session) return false;
  try {
    return Boolean(await clerk.session.getToken({ skipCache: true }));
  } catch {
    return false;
  }
}

/** A form action that renews the sign-in first; the server still decides. */
export function withRenewedSignIn<State, Payload>(action: (state: State, payload: Payload) => Promise<State>) {
  return async (state: State, payload: Payload) => {
    await renewSignIn();
    return action(state, payload);
  };
}

/** fetch for the desk's own routes: a 401 renews the sign-in and tries once more. */
export async function adminFetch(input: string, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status !== 401 || init?.signal?.aborted || !(await renewSignIn())) return response;
  return fetch(input, init);
}
