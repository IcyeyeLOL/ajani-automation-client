import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchesAudioContainer, POST } from "@/app/api/request-drafts/[draftId]/voice-memo/complete/route";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), draft: vi.fn(), memo: vi.fn(), after: vi.fn(), info: vi.fn(), download: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({
  rpc: mocks.rpc,
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: table === "request_drafts" ? mocks.draft : mocks.memo };
    return query;
  },
  storage: { from: () => ({ info: mocks.info, download: mocks.download }) },
}) }));

describe("voice completion lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draft.mockResolvedValue({ data: { id: "draft", status: "ready_to_submit", expires_at: "2099-01-01" }, error: null });
    mocks.memo.mockResolvedValue({ data: { id: "memo", status: "pending_upload", mime_type: "audio/webm", byte_length: 12, storage_path: "private/note.webm" }, error: null });
    mocks.info.mockResolvedValue({ data: { size: 12, contentType: "audio/webm" }, error: null });
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,0,0,0,0,0,0,0,0])]), error: null });
    mocks.rpc.mockResolvedValue({ data: [{ voice_memo_id: "memo", voice_status: "uploaded" }], error: null });
  });
  function complete() {
    return POST(new Request("https://ajani.test/api/request-drafts/draft/voice-memo/complete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftToken: "a".repeat(40) }),
    }), { params: Promise.resolve({ draftId: "draft" }) });
  }
  it("returns a successful current receipt without downgrading a ready memo", async () => {
    mocks.memo.mockResolvedValue({ data: { id: "memo", status: "ready" }, error: null });
    const response = await complete();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ voiceMemo: { status: "ready" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it("uses one transactional completion RPC and retains success if scheduling fails", async () => {
    mocks.after.mockImplementationOnce(() => { throw new Error("no request context"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await complete();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("complete_request_draft_voice_memo", expect.objectContaining({ p_draft_id: "draft", p_voice_memo_id: "memo", p_byte_length: 12 }));
    log.mockRestore();
  });
});

describe("voice memo container validation", () => {
  it.each([
    ["audio/webm", [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["audio/mp4", [0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]],
    ["audio/ogg", [0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["audio/wav", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ["audio/mpeg", [0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])("accepts a matching %s signature", async (mimeType, header) => {
    await expect(matchesAudioContainer(new Blob([new Uint8Array(header as number[])]), mimeType as string)).resolves.toBe(true);
  });

  it("rejects a media label that does not match the uploaded bytes", async () => {
    const fakeWebm = new Blob([new TextEncoder().encode("this is not webm audio")]);
    await expect(matchesAudioContainer(fakeWebm, "audio/webm")).resolves.toBe(false);
  });

  it("rejects files that are too small to be audio containers", async () => {
    await expect(matchesAudioContainer(new Blob([new Uint8Array([0x49, 0x44, 0x33])]), "audio/mpeg")).resolves.toBe(false);
  });
});
