import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  authorizeAdminAction: vi.fn(),
  revalidatePath: vi.fn(),
  sampleCookie: undefined as string | undefined,
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: async () => ({ get: () => mocks.sampleCookie ? { value: mocks.sampleCookie } : undefined, set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/session", () => ({
  clearAdminSessionCookie: vi.fn(),
  fingerprintRequest: vi.fn(),
  getAdminConfiguration: vi.fn(),
  keysMatch: vi.fn(),
  authorizeAdminAction: mocks.authorizeAdminAction,
  setAdminSessionCookie: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

import { postBuildUpdateAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";

const buildId = "21000000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const rows: Record<string, Record<string, unknown> | undefined> = {
  build_requests: { title: "Text back every missed call", created_by: "client_user", organization_id: "org-1" },
  profiles: { email: "dana@example.com", deleted_at: null },
  organization_members: { user_id: "client_user" },
  organizations: { archived_at: null },
};

function table(name: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    maybeSingle: async () => ({ data: rows[name] ?? null, error: null }),
    update: (values: unknown) => { const outcome = mocks.update(name, values) as { error: unknown } | undefined; return { eq: async () => outcome ?? { error: null } }; },
  };
  return builder;
}

describe("posting on a client build", () => {
  beforeEach(() => {
    mocks.sampleCookie = undefined;
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: [{ message_id: "msg-1", previous_status: "in_review", current_status: "in_progress" }], error: null });
    mocks.from.mockReset();
    mocks.from.mockImplementation(table);
    mocks.update.mockReset();
    mocks.authorizeAdminAction.mockReset();
    mocks.authorizeAdminAction.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.revalidatePath.mockReset();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "Ajani <hello@ajaniautomation.com>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ajaniflow.com");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts the update and stage together, emails the client and records it", async () => {
    const result = await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "update", body: "Calendar connected.", status: "in_progress", linkUrl: "https://www.loom.com/share/abc", linkLabel: "Walkthrough", notifyClient: "on" }));

    expect(mocks.rpc).toHaveBeenCalledWith("post_build_update", {
      p_build_request_id: buildId,
      p_actor: "user_admin",
      p_status: "in_progress",
      p_kind: "update",
      p_body: "Calendar connected.",
      p_link_url: "https://www.loom.com/share/abc",
      p_link_label: "Walkthrough",
    });
    expect(result).toMatchObject({ status: "success", entityId: "msg-1", message: "Update posted to the client's portal. Stage is now In build. The client was emailed." });
    const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request.headers["idempotency-key"]).toBe("build-message-msg-1");
    const body = JSON.parse(String(request.body)) as { to: string[]; subject: string; html: string };
    expect(body.to).toEqual(["dana@example.com"]);
    expect(body.subject).toBe("New update on Text back every missed call");
    expect(body.html).toContain(`https://ajaniflow.com/portal/builds/${buildId}#conversation`);
    expect(mocks.update).toHaveBeenCalledWith("build_messages", { email_status: "sent" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/builds/${buildId}`);
  });

  it("keeps the post when the email fails, and says so", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "question", body: "Which calendar?", notifyClient: "on" }));
    expect(result).toMatchObject({ status: "success", message: "Question posted to the client's portal. The email to the client may not have sent, but the post is in their portal." });
    expect(mocks.update).toHaveBeenCalledWith("build_messages", { email_status: "failed" });
  });

  it("still says the client was emailed when only the email record fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.update.mockReturnValueOnce({ error: { message: "permission denied" } });
    const result = await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "update", body: "Calendar connected.", notifyClient: "on" }));
    expect(result).toMatchObject({ status: "success", message: "Update posted to the client's portal. The client was emailed." });
    expect(logged).toHaveBeenCalledWith("Build message email status not saved", expect.objectContaining({ messageId: "msg-1", result: "sent" }));
  });

  it("does not email someone no longer in the client's workspace", async () => {
    const saved = rows.organization_members;
    rows.organization_members = undefined;
    try {
      const result = await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "update", body: "Calendar connected.", notifyClient: "on" }));
      expect(result).toMatchObject({ status: "success", message: "Update posted to the client's portal. No email was sent: the person who requested this build is no longer in the client's workspace." });
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      rows.organization_members = saved;
    }
    rows.organizations = { archived_at: "2026-10-01T00:00:00.000Z" };
    try {
      await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "update", body: "Calendar connected.", notifyClient: "on" }));
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      rows.organizations = { archived_at: null };
    }
  });

  it("does not email when the box is unticked, or for a stage-only move", async () => {
    await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "update", body: "Quiet note." }));
    mocks.rpc.mockResolvedValueOnce({ data: [{ message_id: null, previous_status: "in_progress", current_status: "live" }], error: null });
    const moved = await postBuildUpdateAction(initialAdminActionState, form({ buildId, kind: "update", body: "", status: "live", notifyClient: "on" }));
    expect(moved).toMatchObject({ status: "success", message: "Stage moved to Live." });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("explains a stage it is already at", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "nothing_to_post" } });
    const result = await postBuildUpdateAction(initialAdminActionState, form({ buildId, status: "live" }));
    expect(result).toEqual({ status: "error", message: "The build is already at that stage. Write an update, or pick a different stage." });
  });

  it("refuses bad input before touching the database", async () => {
    const result = await postBuildUpdateAction(initialAdminActionState, form({ buildId, body: "See this", linkUrl: "http://example.com" }));
    expect(result.status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never writes while sample data is shown", async () => {
    const fromForm = await postBuildUpdateAction(initialAdminActionState, form({ buildId, body: "Hi", sample: "1" }));
    mocks.sampleCookie = "1";
    const fromCookie = await postBuildUpdateAction(initialAdminActionState, form({ buildId, body: "Hi" }));
    expect(fromForm.status).toBe("error");
    expect(fromCookie.status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("stops when the desk refuses the sign-in", async () => {
    mocks.authorizeAdminAction.mockResolvedValueOnce({ status: "refused", state: { status: "error", message: "Press save again." } });
    expect(await postBuildUpdateAction(initialAdminActionState, form({ buildId, body: "Hi" }))).toEqual({ status: "error", message: "Press save again." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
