"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState, type ReactNode } from "react";
import { authPageUrl } from "@/lib/clerk/redirect";

const HOPS_KEY = "ajani_signed_in_hops";
const HOP_WINDOW_MS = 60_000;
const MAX_HOPS = 2;

/** Counts this hop and says whether the last minute already had too many. */
function tooManyHops() {
  try {
    const now = Date.now();
    const hops = (JSON.parse(window.sessionStorage.getItem(HOPS_KEY) ?? "[]") as number[]).filter((time) => now - time < HOP_WINDOW_MS);
    // A second run within a second is the same visit (React runs effects twice in development).
    if (hops.length && now - hops[hops.length - 1] < 1_000) return false;
    if (hops.length >= MAX_HOPS) return true;
    window.sessionStorage.setItem(HOPS_KEY, JSON.stringify([...hops, now]));
    return false;
  } catch {
    // Without storage there is no count, so the page loads once and the browser stops any loop.
    return false;
  }
}

/**
 * Sign-in and sign-up for someone who is already signed in. Clerk's own form
 * would send them on with an in-app navigation, which can't renew an expired
 * sign-in token, so the next page read them as signed out and sent them back
 * here: a loop. A full page load lets the server renew the token. After two of
 * those in a minute something else is wrong, so it stops and offers a clean
 * sign-in instead of looping.
 */
export function SignedInRedirect({ to, children }: { to: string; children: ReactNode }) {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (!tooManyHops()) {
      window.location.replace(to);
      return;
    }
    // The hop count lives outside React, so its answer arrives like any other outside event.
    const timer = window.setTimeout(() => setStuck(true), 0);
    return () => window.clearTimeout(timer);
  }, [isLoaded, isSignedIn, to]);

  if (!isLoaded || !isSignedIn) return children;
  if (!stuck) return <p className="auth-config-card" role="status"><b>RESTORING YOUR SESSION</b></p>;
  return <div className="auth-config-card" role="alert">
    <b>WE COULDN&apos;T RESTORE YOUR SESSION</b>
    <p>Sign out and sign in again to continue.</p>
    <button onClick={() => {
      try { window.sessionStorage.removeItem(HOPS_KEY); } catch { /* storage is optional */ }
      void signOut({ redirectUrl: authPageUrl("/sign-in", to) });
    }} type="button">SIGN OUT AND SIGN IN AGAIN →</button>
  </div>;
}
