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

let {
  acknowledgeSavedWebsiteRequestDraft,
  claimSavedWebsiteRequestDraft,
  clearSavedWebsiteRequestCapability,
  getSavedWebsiteRequestDraft,
  saveWebsiteRequestDraft,
} = await import("@/lib/request-drafts/client");
import { CURRENT_HANDOFF_POLICY_VERSION } from "@/lib/legal/policy-versions";

const newDraft = {
  id: "bfa16669-b62c-49e5-a356-9ac634a969bb",
  status: "ready_to_submit",
  updated_at: "2026-08-25T00:00:00.000Z",
};
const newToken = "new-capability-token-that-is-long-enough-for-validation";
const draftInput = {
  legalAcceptanceAcknowledged: true as const,
  legalAcceptanceVersions: CURRENT_HANDOFF_POLICY_VERSION,
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

  beforeEach(async () => {
    vi.resetModules();
    ({ acknowledgeSavedWebsiteRequestDraft, claimSavedWebsiteRequestDraft, clearSavedWebsiteRequestCapability, getSavedWebsiteRequestDraft, saveWebsiteRequestDraft } = await import("@/lib/request-drafts/client"));
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

    expect(JSON.parse(values.get("ajani_request_draft_capability_v1")!)).toEqual({ draftId: newDraft.id, draftToken: newToken });
    expect(getSavedWebsiteRequestDraft()).toEqual({ id: newDraft.id, persistence: "session" });
    expect(values.has("ajani_request_draft_id")).toBe(false);
    expect(values.has("ajani_request_draft_token")).toBe(false);
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

  it("records a fresh acknowledgment for a legacy saved capability", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "acknowledged" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(acknowledgeSavedWebsiteRequestDraft(CURRENT_HANDOFF_POLICY_VERSION)).resolves.toEqual({
      status: "acknowledged",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/request-drafts/acknowledge", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        draftId: "prior-draft-id",
        draftToken: "prior-capability-token",
        legalAcceptanceAcknowledged: true,
        legalAcceptanceVersions: CURRENT_HANDOFF_POLICY_VERSION,
      }),
    }));
  });

  it("preserves an API status for legal-review recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Review required" }, { status: 428 })));

    await expect(claimSavedWebsiteRequestDraft()).rejects.toMatchObject({
      message: "Review required",
      status: 428,
    });
  });

  it("can finish the current handoff in memory when every storage method is denied", async () => {
    const denied = () => { throw new DOMException("Storage denied", "SecurityError"); };
    vi.stubGlobal("sessionStorage", { getItem: denied, setItem: denied, removeItem: denied });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/request-drafts"
      ? createdResponse()
      : Response.json({ status: "submitted" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveWebsiteRequestDraft({ ...draftInput, voiceMemo: null })).resolves.toEqual(newDraft);
    expect(getSavedWebsiteRequestDraft()).toEqual({ id: newDraft.id, persistence: "memory" });
    await expect(claimSavedWebsiteRequestDraft(newDraft.id)).resolves.toMatchObject({ status: "submitted" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/request-drafts/claim", expect.objectContaining({
      body: JSON.stringify({ draftId: newDraft.id, draftToken: newToken }),
    }));
    clearSavedWebsiteRequestCapability(newDraft.id);
    expect(getSavedWebsiteRequestDraft()).toBeNull();
    await expect(claimSavedWebsiteRequestDraft()).rejects.toThrow("no longer available");
  });

  it("never pairs a new token with a previous draft when persistence fails", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); },
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => String(input) === "/api/request-drafts"
      ? createdResponse()
      : Response.json({ status: "submitted" })));
    await saveWebsiteRequestDraft({ ...draftInput, voiceMemo: null });
    expect(getSavedWebsiteRequestDraft()).toEqual({ id: newDraft.id, persistence: "memory" });
    await expect(claimSavedWebsiteRequestDraft("prior-draft-id")).rejects.toThrow("saved request changed");
    clearSavedWebsiteRequestCapability("prior-draft-id");
    expect(getSavedWebsiteRequestDraft()?.id).toBe(newDraft.id);
    expect(values.has("ajani_request_draft_id")).toBe(false);
  });

  it("does not revive a cleared capability when storage cleanup is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: () => { throw new DOMException("Storage denied", "SecurityError"); },
    });
    expect(getSavedWebsiteRequestDraft()?.id).toBe("prior-draft-id");
    clearSavedWebsiteRequestCapability("prior-draft-id");
    expect(getSavedWebsiteRequestDraft()).toBeNull();
  });

  it("does not claim or expose a memory-only capability after a full reload", async () => {
    const denied = () => { throw new DOMException("Storage denied", "SecurityError"); };
    vi.stubGlobal("sessionStorage", { getItem: denied, setItem: denied, removeItem: denied });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createdResponse()));
    await saveWebsiteRequestDraft({ ...draftInput, voiceMemo: null });
    expect(getSavedWebsiteRequestDraft()?.persistence).toBe("memory");
    vi.resetModules();
    const reloadedClient = await import("@/lib/request-drafts/client");
    expect(reloadedClient.getSavedWebsiteRequestDraft()).toBeNull();
    await expect(reloadedClient.claimSavedWebsiteRequestDraft()).rejects.toThrow("no longer available");
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
