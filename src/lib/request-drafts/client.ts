import { createClient } from "@/lib/supabase/client";
import type {
  HandoffPolicyVersionInput,
  WebsiteRequestDraftInput,
} from "@/lib/validation/website-request-draft";

type DraftResponse = {
  draft?: { id: string; status: string; updated_at: string };
  draftToken?: string;
  diagnostic?: { stage?: string; errorCode?: string };
  error?: string;
  voiceMemoUpload?: { path: string; token: string };
};

export type RequestDraftClaimResult = {
  error?: string;
  organizationId?: string;
  status?: "organization_activation_required" | "claimed" | "submitted";
  buildRequest?: {
    build_request_id?: string;
    build_request_status?: string;
    build_request_created_at?: string;
  };
};

const CAPABILITY_KEY = "ajani_request_draft_capability_v1";
const LEGACY_CAPABILITY_KEYS = ["ajani_request_draft_id", "ajani_request_draft_token"];
type SavedCapability = { draftId: string; draftToken: string; persistence: "session" | "memory" };
// undefined permits initial storage hydration; null is a cleared capability.
// The tombstone prevents a failed storage deletion from reviving an old draft.
let activeCapability: SavedCapability | null | undefined;

function readSavedCapability(): SavedCapability | null {
  if (activeCapability !== undefined) return activeCapability;
  try {
    const raw = sessionStorage.getItem(CAPABILITY_KEY);
    if (raw) {
      const value = JSON.parse(raw) as { draftId?: unknown; draftToken?: unknown };
      if (typeof value.draftId === "string" && value.draftId && typeof value.draftToken === "string" && value.draftToken) {
        return { draftId: value.draftId, draftToken: value.draftToken, persistence: "session" };
      }
      return null;
    }
    const draftId = sessionStorage.getItem(LEGACY_CAPABILITY_KEYS[0]);
    const draftToken = sessionStorage.getItem(LEGACY_CAPABILITY_KEYS[1]);
    return draftId && draftToken ? { draftId, draftToken, persistence: "session" } : null;
  } catch {
    return null;
  }
}

function publishSavedCapability(draftId: string, draftToken: string) {
  // Publish one pair only after the full save/upload succeeds. A partial storage
  // write can never combine the new token with an earlier draft's identifier.
  activeCapability = { draftId, draftToken, persistence: "memory" };
  try {
    sessionStorage.setItem(CAPABILITY_KEY, JSON.stringify({ draftId, draftToken }));
    activeCapability.persistence = "session";
  } catch {
    // Same-page handoff remains possible when privacy settings block storage.
    try { sessionStorage.removeItem(CAPABILITY_KEY); } catch { /* Memory remains authoritative. */ }
  }
  for (const key of LEGACY_CAPABILITY_KEYS) {
    try { sessionStorage.removeItem(key); } catch { /* Memory is authoritative. */ }
  }
}

export function getSavedWebsiteRequestDraft(): { id: string; persistence: "session" | "memory" } | null {
  const capability = readSavedCapability();
  return capability ? { id: capability.draftId, persistence: capability.persistence } : null;
}

function requireSavedCapability(expectedDraftId?: string) {
  const capability = readSavedCapability();
  if (!capability) throw new Error("This saved request is no longer available in this tab.");
  if (expectedDraftId && capability.draftId !== expectedDraftId) throw new Error("The saved request changed. Review the current draft before sending it.");
  return capability;
}

export class RequestDraftApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RequestDraftApiError";
  }
}

export async function saveWebsiteRequestDraft(draft: WebsiteRequestDraftInput, voiceMemo?: Blob) {
  if (Boolean(draft.voiceMemo) !== Boolean(voiceMemo)) {
    throw new Error("The voice note metadata and recording must be saved together.");
  }

  const response = await fetch("/api/request-drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  const result = await response.json() as DraftResponse;

  if (!response.ok || !result.draft || !result.draftToken) {
    const diagnostic = result.diagnostic?.stage
      ? ` (${result.diagnostic.stage}${result.diagnostic.errorCode ? `: ${result.diagnostic.errorCode}` : ""})`
      : "";
    throw new Error(`${result.error || "Your request could not be saved."}${diagnostic}`);
  }

  try {
    if (voiceMemo) {
      if (!result.voiceMemoUpload) throw new Error("The private voice upload could not be prepared.");
      const { error: uploadError } = await createClient()
        .storage
        .from("voice-memos")
        .uploadToSignedUrl(result.voiceMemoUpload.path, result.voiceMemoUpload.token, voiceMemo, {
          cacheControl: "0",
          contentType: draft.voiceMemo?.mimeType,
        });
      if (uploadError) throw new Error("The voice note could not be uploaded. Please retry.");

      const completed = await fetch(`/api/request-drafts/${result.draft.id}/voice-memo/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftToken: result.draftToken }),
      });
      if (!completed.ok) {
        const completion = await completed.json() as { error?: string };
        throw new Error(completion.error || "The voice note upload could not be verified.");
      }
    }
  } catch (error) {
    // The new capability is not exposed to the rest of the UI until its private
    // upload is complete. If preparation fails, clean up that incomplete draft
    // without replacing a previously usable capability in this tab.
    await deleteDraftCapability(result.draft.id, result.draftToken).catch(() => undefined);
    throw error;
  }

  // The raw capability stays on this device. Supabase stores only its hash.
  publishSavedCapability(result.draft.id, result.draftToken);

  return result.draft;
}

export async function deleteSavedWebsiteRequestDraft() {
  const { draftId, draftToken } = requireSavedCapability();

  await deleteDraftCapability(draftId, draftToken);

  clearSavedWebsiteRequestCapability(draftId);
}

export async function claimSavedWebsiteRequestDraft(expectedDraftId?: string): Promise<RequestDraftClaimResult> {
  const { draftId, draftToken } = requireSavedCapability(expectedDraftId);

  const response = await fetch("/api/request-drafts/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftId, draftToken }),
  });
  const result = await response.json() as RequestDraftClaimResult;
  if (!response.ok) throw new RequestDraftApiError(
    result.error || "Your saved request could not be sent to Ajani.",
    response.status,
  );
  return result;
}

export async function acknowledgeSavedWebsiteRequestDraft(legalAcceptanceVersions: HandoffPolicyVersionInput, expectedDraftId?: string) {
  const { draftId, draftToken } = requireSavedCapability(expectedDraftId);

  const response = await fetch("/api/request-drafts/acknowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId,
      draftToken,
      legalAcceptanceAcknowledged: true,
      legalAcceptanceVersions,
    }),
  });
  const result = await response.json() as { error?: string; status?: string };
  if (!response.ok) throw new RequestDraftApiError(
    result.error || "The saved request acknowledgment could not be recorded.",
    response.status,
  );
  return result;
}

export function clearSavedWebsiteRequestCapability(expectedDraftId?: string) {
  if (expectedDraftId && readSavedCapability()?.draftId !== expectedDraftId) return;
  activeCapability = null;
  for (const key of [CAPABILITY_KEY, ...LEGACY_CAPABILITY_KEYS]) {
    try { sessionStorage.removeItem(key); } catch { /* Keep the cleared tombstone. */ }
  }
}

async function deleteDraftCapability(draftId: string, draftToken: string) {
  const response = await fetch(`/api/request-drafts/${draftId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftToken }),
  });
  if (!response.ok) {
    const result = await response.json() as { error?: string };
    throw new Error(result.error || "The saved request could not be deleted.");
  }
}
