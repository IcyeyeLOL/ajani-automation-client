import type { WebsiteRequestDraftInput } from "@/lib/validation/website-request-draft";

type DraftResponse = {
  draft?: { id: string; status: string; updated_at: string };
  draftToken?: string;
  error?: string;
};

export async function saveWebsiteRequestDraft(draft: WebsiteRequestDraftInput) {
  const response = await fetch("/api/request-drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  const result = await response.json() as DraftResponse;

  if (!response.ok || !result.draft || !result.draftToken) {
    throw new Error(result.error || "Your request could not be saved.");
  }

  // The raw capability stays on this device. Supabase stores only its hash.
  sessionStorage.setItem("ajani_request_draft_token", result.draftToken);
  sessionStorage.setItem("ajani_request_draft_id", result.draft.id);
  return result.draft;
}
