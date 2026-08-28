import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }),
    },
  }),
}));

import {
  claimSavedWebsiteRequestDraft,
  clearSavedWebsiteRequestCapability,
  saveWebsiteRequestDraft,
} from "@/lib/request-drafts/client";

const newDraft = {
  id: "bfa16669-b62c-49e5-a356-9ac634a969bb",
  status: "ready_to_submit",
  updated_at: "2026-08-25T00:00:00.000Z",
};
const newToken = "new-capability-token-that-is-long-enough-for-validation";
const draftInput = {
  title: "After-hours lead handoff",
  transcript: "After-hours leads need a timely response and clear ownership.",
  clarificationAnswer: "Send qualified replies to the team queue.",
  clarificationAnswers: [{ question: "Who owns it?", answer: "The team queue" }],
  developmentBrief: {
    workThatSlips: "After-hours follow-up",
    momentItHappens: "When the office is closed",
    desiredOutcome: "Every lead gets a timely next step",
    protection: "A person still receives exceptions",
  },
  systemBlocks: [
    { id: "trigger", kind: "trigger" as const, title: "Lead arrives", detail: "Capture the enquiry." },
  ],
  voiceMemo: {
    durationSeconds: 12,
    byteLength: 16,
    mimeType: "audio/webm" as const,
  },
};

describe("website request draft client", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map([
      ["ajani_request_draft_id", "prior-draft-id"],
      ["ajani_request_draft_token", "prior-capability-token"],
    ]);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    mocks.uploadToSignedUrl.mockReset();
    vi.restoreAllMocks();
  });

  it("keeps the prior capability and cleans up a new draft when voice upload fails", async () => {
    mocks.uploadToSignedUrl.mockResolvedValue({ error: new Error("upload failed") });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-drafts" && init?.method === "POST") return createdResponse();
      if (String(input) === `/api/request-drafts/${newDraft.id}` && init?.method === "DELETE") {
        return Response.json({ deleted: true });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveWebsiteRequestDraft(draftInput, voiceBlob())).rejects.toThrow("could not be uploaded");

    expect(values.get("ajani_request_draft_id")).toBe("prior-draft-id");
    expect(values.get("ajani_request_draft_token")).toBe("prior-capability-token");
    expect(fetchMock).toHaveBeenCalledWith(`/api/request-drafts/${newDraft.id}`, expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ draftToken: newToken }),
    }));
  });

  it("publishes the new capability only after upload completion succeeds", async () => {
    mocks.uploadToSignedUrl.mockResolvedValue({ error: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/request-drafts" && init?.method === "POST") return createdResponse();
      if (String(input).endsWith("/voice-memo/complete") && init?.method === "POST") {
        expect(values.get("ajani_request_draft_id")).toBe("prior-draft-id");
        expect(values.get("ajani_request_draft_token")).toBe("prior-capability-token");
        return Response.json({ voiceMemo: { status: "uploaded" } });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveWebsiteRequestDraft(draftInput, voiceBlob())).resolves.toEqual(newDraft);

    expect(values.get("ajani_request_draft_id")).toBe(newDraft.id);
    expect(values.get("ajani_request_draft_token")).toBe(newToken);
  });

  it("claims the saved capability and only clears it after confirmed submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      status: "submitted",
      buildRequest: { build_request_id: "build-123" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimSavedWebsiteRequestDraft()).resolves.toMatchObject({ status: "submitted" });
    expect(fetchMock).toHaveBeenCalledWith("/api/request-drafts/claim", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        draftId: "prior-draft-id",
        draftToken: "prior-capability-token",
      }),
    }));
    expect(values.get("ajani_request_draft_id")).toBe("prior-draft-id");

    clearSavedWebsiteRequestCapability();
    expect(values.has("ajani_request_draft_id")).toBe(false);
    expect(values.has("ajani_request_draft_token")).toBe(false);
  });

  it("keeps the saved capability when the authenticated handoff fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Workspace unavailable" }, { status: 503 })));

    await expect(claimSavedWebsiteRequestDraft()).rejects.toThrow("Workspace unavailable");
    expect(values.get("ajani_request_draft_id")).toBe("prior-draft-id");
    expect(values.get("ajani_request_draft_token")).toBe("prior-capability-token");
  });
});

function createdResponse() {
  return Response.json({
    draft: newDraft,
    draftToken: newToken,
    voiceMemoUpload: { path: `${newDraft.id}/voice-note.webm`, token: "signed-upload-token" },
  }, { status: 201 });
}

function voiceBlob() {
  return new Blob([new Uint8Array(16)], { type: "audio/webm" });
}
