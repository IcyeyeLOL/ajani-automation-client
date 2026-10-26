import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  provision: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
  hasClerkCredentials: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, clerkClient: vi.fn() }));
vi.mock("@/lib/clerk/config", () => ({ hasClerkCredentials: mocks.hasClerkCredentials }));
vi.mock("@/lib/clerk/provisioning", () => ({ provisionClerkWorkspace: mocks.provision }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    from: (name: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: { title: "Text back every missed call", organizations: { business_name: "Northline Dental" } }, error: null }),
        update: (values: unknown) => { const outcome = mocks.update(name, values) as { error: unknown } | undefined; return { eq: async () => outcome ?? { error: null } }; },
      };
      return builder;
    },
  }),
}));

import { sendBuildMessageAction } from "@/app/portal/actions";
import { initialPortalMessageState } from "@/app/portal/message-state";

const buildId = "21000000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("a client writing on their build", () => {
  beforeEach(() => {
    mocks.hasClerkCredentials.mockReturnValue(true);
    mocks.auth.mockReset();
    mocks.auth.mockResolvedValue({ userId: "client_user", orgId: "org_client" });
    mocks.provision.mockReset();
    mocks.provision.mockResolvedValue({ organizationId: "org-row-1" });
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: "msg-9", error: null });
    mocks.update.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "email-9" }), { status: 200 }));
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "Ajani <hello@ajaniautomation.com>");
    vi.stubEnv("INTERNAL_NOTIFICATION_TO", "owner@example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ajaniflow.com");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("saves through the workspace check and emails Ajani", async () => {
    const result = await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "  Use the front desk calendar.  " }));
    expect(mocks.provision).toHaveBeenCalledWith("client_user", "org_client");
    expect(mocks.rpc).toHaveBeenCalledWith("post_client_build_message", {
      p_build_request_id: buildId,
      p_user_id: "client_user",
      p_organization_id: "org-row-1",
      p_body: "Use the front desk calendar.",
    });
    expect(result).toEqual({ status: "success", message: "Sent. Ajani has been emailed.", sentId: "msg-9" });
    const body = JSON.parse(String((mocks.fetch.mock.calls[0] as [string, RequestInit])[1].body)) as { to: string[]; subject: string; html: string };
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.subject).toBe("Northline Dental wrote about Text back every missed call");
    // Through the unlock page, which returns to the build.
    expect(body.html).toContain(`https://ajaniflow.com/admin/login?next=%2Fadmin%2Fbuilds%2F${buildId}`);
    expect(mocks.update).toHaveBeenCalledWith("build_messages", { email_status: "sent" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/portal/builds/${buildId}`);
  });

  it("asks to send again when the sign-in was renewing", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null, orgId: null });
    const result = await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }));
    expect(result).toEqual({ status: "error", message: "Your sign-in was renewing, so nothing was sent. Press send again." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("explains another workspace's build and the rate cap without saying more", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "build_request_not_found" } });
    expect((await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }))).message).toBe("This request could not be found in your workspace. Refresh the page.");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "message_rate_limited" } });
    expect((await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }))).message).toBe("You've sent a lot of messages in a few minutes. Wait a little, then send again.");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    expect((await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }))).message).toBe("Your message could not be sent right now. It is still in the box, so try again in a moment.");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reports the message as sent, without claiming an email, when the email fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetch.mockRejectedValueOnce(new Error("network down"));
    const result = await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }));
    expect(result).toMatchObject({ status: "success", message: "Sent and saved on this build. Ajani will see it in the control desk." });
    expect(mocks.update).toHaveBeenCalledWith("build_messages", { email_status: "failed" });
  });

  it("logs a missed email record without changing what the client is told", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.update.mockReturnValueOnce({ error: { message: "permission denied" } });
    const result = await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }));
    expect(result.message).toBe("Sent. Ajani has been emailed.");
    expect(logged).toHaveBeenCalledWith("Build message email status not saved", expect.objectContaining({ messageId: "msg-9", result: "sent" }));
  });

  it("refuses an empty message and a preview without Clerk", async () => {
    expect((await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "  " }))).message).toBe("Write your message first.");
    mocks.hasClerkCredentials.mockReturnValue(false);
    expect((await sendBuildMessageAction(initialPortalMessageState, form({ buildId, body: "Hi" }))).message).toBe("This is a preview, so nothing was sent.");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
