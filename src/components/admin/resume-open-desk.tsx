"use client";

import { useEffect } from "react";

/**
 * A desk link opened from an email arrives from another site, so the browser
 * holds back the desk's strict session cookie and the server shows the unlock
 * page even when the desk is open. A request from this page is same-site and
 * carries the cookie: if the build page answers, the desk is open, so go there.
 */
export function ResumeOpenDesk({ next }: { next: string }) {
  useEffect(() => {
    const controller = new AbortController();
    fetch(next, { credentials: "same-origin", redirect: "manual", signal: controller.signal })
      .then((response) => {
        if (response.ok) window.location.replace(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [next]);
  return null;
}
