import { createClient } from "@/lib/supabase/client";
import type { WebsiteRequestDraftInput } from "@/lib/validation/website-request-draft";

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
  sessionStorage.setItem("ajani_request_draft_token", result.draftToken);
  sessionStorage.setItem("ajani_request_draft_id", result.draft.id);

  return result.draft;
}

export async function deleteSavedWebsiteRequestDraft() {
  const draftId = sessionStorage.getItem("ajani_request_draft_id");
  const draftToken = sessionStorage.getItem("ajani_request_draft_token");
  if (!draftId || !draftToken) throw new Error("This saved request is no longer available in this tab.");

  await deleteDraftCapability(draftId, draftToken);

  sessionStorage.removeItem("ajani_request_draft_id");
  sessionStorage.removeItem("ajani_request_draft_token");
}

export async function claimSavedWebsiteRequestDraft(): Promise<RequestDraftClaimResult> {
  const draftId = sessionStorage.getItem("ajani_request_draft_id");
  const draftToken = sessionStorage.getItem("ajani_request_draft_token");
  if (!draftId || !draftToken) throw new Error("This saved request is no longer available in this tab.");

  const response = await fetch("/api/request-drafts/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftId, draftToken }),
  });
  const result = await response.json() as RequestDraftClaimResult;
  if (!response.ok) throw new Error(result.error || "Your saved request could not be sent to Ajani.");
  return result;
}

export function clearSavedWebsiteRequestCapability() {
  sessionStorage.removeItem("ajani_request_draft_id");
  sessionStorage.removeItem("ajani_request_draft_token");
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
