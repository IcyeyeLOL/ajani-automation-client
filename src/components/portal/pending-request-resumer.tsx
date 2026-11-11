"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearRecordFlowProgress } from "@/lib/record/flow-progress";
import {
  claimSavedWebsiteRequestDraft,
  clearSavedWebsiteRequestCapability,
  getSavedWebsiteRequestDraft,
  RequestDraftApiError,
} from "@/lib/request-drafts/client";

export function PendingRequestResumer() {
  const { setActive } = useClerk();
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresLegalReview, setRequiresLegalReview] = useState(false);
  const [submittedReference, setSubmittedReference] = useState<string | null>(null);
  const [missingCapability, setMissingCapability] = useState(false);

  const resume = useCallback(async () => {
    if (started.current) return;
    const savedDraft = getSavedWebsiteRequestDraft();
    if (!savedDraft) {
      if (new URLSearchParams(window.location.search).get("handoff") === "pending") {
        setMissingCapability(true);
      }
      return;
    }
    setMissingCapability(false);
    started.current = true;
    setError(null);
    setMessage("Connecting your saved request to this workspace…");

    try {
      let result = await claimSavedWebsiteRequestDraft(savedDraft.id);
      if (result.status === "organization_activation_required" && result.organizationId) {
        await setActive({ organization: result.organizationId });
        result = await claimSavedWebsiteRequestDraft(savedDraft.id);
      }
      if (result.status !== "submitted" && result.status !== "claimed") {
        throw new Error(result.error || "Your saved request could not be resumed.");
      }

      if (result.status === "submitted") {
        clearSavedWebsiteRequestCapability(savedDraft.id);
        // The brief is with Ajani now. Without this, /record would reopen its
        // handoff step and a second send would create a duplicate request.
        clearRecordFlowProgress();
        setMessage(null);
        setSubmittedReference(result.buildRequest?.build_request_id?.slice(0, 8).toUpperCase() ?? "RECEIVED");
      } else {
        setMessage("Your request is attached to this workspace. Ajani is preparing it for submission now.");
      }
      router.refresh();
    } catch (reason) {
      setMessage(null);
      if (reason instanceof RequestDraftApiError && reason.status === 428) {
        setRequiresLegalReview(true);
        setError(null);
        started.current = false;
        return;
      }
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

  if (requiresLegalReview) return <div aria-live="polite" className="portal-request-resume legal-review" role="status">
    <i aria-hidden="true" />
    <span>This saved brief predates the current legal acknowledgment. Review the current Terms, Acceptable Use Policy, and Privacy Policy before sending it.</span>
    <Link href="/record">Review and continue</Link>
  </div>;

  if (missingCapability) return <div aria-live="polite" className="portal-request-resume error" role="status">
    <i aria-hidden="true" />
    <span>This tab no longer has access to the saved request. If browser storage was blocked, reloading or changing tabs may have cleared that access. Check build history before starting again.</span>
    <Link href="/portal/builds">Check build history</Link>
    <Link href="/record">Start another request</Link>
  </div>;

  if (!message && !error) return null;
  return <div aria-live="polite" className={`portal-request-resume${error ? " error" : ""}`} role="status">
    <i aria-hidden="true" />
    <span>{error ?? message}</span>
    {error ? <button onClick={() => void resume()} type="button">Try again</button> : null}
  </div>;
}
