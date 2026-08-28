"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { claimSavedWebsiteRequestDraft, clearSavedWebsiteRequestCapability } from "@/lib/request-drafts/client";

export function PendingRequestResumer() {
  const { setActive } = useClerk();
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedReference, setSubmittedReference] = useState<string | null>(null);

  const resume = useCallback(async () => {
    if (started.current) return;
    if (!sessionStorage.getItem("ajani_request_draft_id") || !sessionStorage.getItem("ajani_request_draft_token")) return;
    started.current = true;
    setError(null);
    setMessage("Connecting your saved request to this workspace…");

    try {
      let result = await claimSavedWebsiteRequestDraft();
      if (result.status === "organization_activation_required" && result.organizationId) {
        await setActive({ organization: result.organizationId });
        result = await claimSavedWebsiteRequestDraft();
      }
      if (result.status !== "submitted" && result.status !== "claimed") {
        throw new Error(result.error || "Your saved request could not be resumed.");
      }

      if (result.status === "submitted") {
        clearSavedWebsiteRequestCapability();
        setMessage(null);
        setSubmittedReference(result.buildRequest?.build_request_id?.slice(0, 8).toUpperCase() ?? "RECEIVED");
      } else {
        setMessage("Your request is attached to this workspace. Ajani is preparing it for submission now.");
      }
      router.refresh();
    } catch (reason) {
      setMessage(null);
      setError(reason instanceof Error ? reason.message : "Your saved request could not be resumed.");
      started.current = false;
    }
  }, [router, setActive]);

  useEffect(() => {
    const timer = window.setTimeout(() => void resume(), 0);
    return () => window.clearTimeout(timer);
  }, [resume]);

  if (submittedReference) return <section aria-labelledby="portal-handoff-title" className="portal-handoff-screen" role="status">
    <div className="portal-handoff-card">
      <i aria-hidden="true">✓</i>
      <p>SUBMISSION CONFIRMED</p>
      <h2 id="portal-handoff-title">Your request is with Ajani.</h2>
      <span>Your approved workflow and authenticated email are now in the build desk.</span>
      <dl><div><dt>Reference</dt><dd>{submittedReference}</dd></div><div><dt>Status</dt><dd>In the build desk</dd></div></dl>
      <div><Link href="/portal/builds">View build history</Link><button onClick={() => setSubmittedReference(null)} type="button">Continue to workspace</button></div>
    </div>
  </section>;

  if (!message && !error) return null;
  return <div aria-live="polite" className={`portal-request-resume${error ? " error" : ""}`} role="status">
    <i aria-hidden="true" />
    <span>{error ?? message}</span>
    {error ? <button onClick={() => void resume()} type="button">Try again</button> : null}
  </div>;
}
