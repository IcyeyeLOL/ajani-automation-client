"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState, type ReactNode } from "react";
import { authPageUrl } from "@/lib/clerk/redirect";

const HOPS_KEY = "ajani_signed_in_hops";
const HOP_WINDOW_MS = 60_000;
const MAX_HOPS = 2;

/**
 * The tab's hop times, kept in sessionStorage and in window.name, which also
 * survives same-site page loads. Both are read and merged: storage can be
 * refused outright, or allow reads but refuse writes (when it is full), and
 * either way the count must keep growing.
 */
function readHops(): number[] {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(HOPS_KEY);
  } catch {
    // Storage refused: window.name still has the count.
  }
  const named = window.name.startsWith(`${HOPS_KEY}=`) ? window.name.slice(HOPS_KEY.length + 1) : null;
  const times = [stored, named].flatMap((raw) => {
    try {
      const hops: unknown = JSON.parse(raw ?? "[]");
      return Array.isArray(hops) ? hops.filter((time): time is number => typeof time === "number") : [];
    } catch {
      return [];
    }
  });
  return [...new Set(times)].sort((a, b) => a - b);
}

function writeHops(hops: number[]) {
  try {
    window.sessionStorage.setItem(HOPS_KEY, JSON.stringify(hops));
  } catch {
    // Storage refused: window.name below still keeps the count.
  }
  window.name = `${HOPS_KEY}=${JSON.stringify(hops)}`;
}

/** Counts this hop and says whether the last minute already had too many. */
function tooManyHops() {
  const now = Date.now();
  const hops = readHops().filter((time) => typeof time === "number" && now - time < HOP_WINDOW_MS);
  // A second run within a second is the same visit (React runs effects twice in development).
  if (hops.length && now - hops[hops.length - 1] < 1_000) return false;
  if (hops.length >= MAX_HOPS) return true;
  writeHops([...hops, now]);
  return false;
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
      writeHops([]);
      void signOut({ redirectUrl: authPageUrl("/sign-in", to) });
    }} type="button">SIGN OUT AND SIGN IN AGAIN →</button>
  </div>;
}
