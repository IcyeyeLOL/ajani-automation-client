import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireAdminSession: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/session", () => ({
  clearAdminSessionCookie: vi.fn(),
  fingerprintRequest: vi.fn(),
  getAdminConfiguration: vi.fn(),
  keysMatch: vi.fn(),
  requireAdminSession: mocks.requireAdminSession,
  setAdminSessionCookie: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

import { createExperimentAction, createOutreachBatchAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";

describe("admin server actions", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.requireAdminSession.mockReset();
    mocks.revalidatePath.mockReset();
  });

  it("authorizes and persists a flexible experiment", async () => {
    mocks.rpc.mockResolvedValue({ data: "b7053867-3ad5-483f-90ba-d542abbd6ebd", error: null });
    const form = new FormData();
    Object.entries({
      title: "Outcome hook comparison",
      audience: "Insurance owners",
      campaign: "August outreach",
      channel: "linkedin",
      method: "manual",
      primaryMetric: "reply_rate",
      createdBy: "Ajani team",
      variants: "Outcome hook, Compliance hook",
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createExperimentAction(initialAdminActionState, form);

    expect(mocks.requireAdminSession).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_experiment", expect.objectContaining({
      p_title: "Outcome hook comparison",
      p_variants: [{ label: "A", title: "Outcome hook" }, { label: "B", title: "Compliance hook" }],
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "b7053867-3ad5-483f-90ba-d542abbd6ebd" });
  });

  it("authorizes and persists an aggregate outreach batch", async () => {
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f429", error: null });
    const metrics = [{
      variantId: null,
      variantLabel: "No variant",
      connectionRequests: 100,
      connectionsAccepted: 40,
      initialDms: 80,
      f1Sent: 50,
      f2Sent: 20,
      replies: 12,
      positiveReplies: 6,
      callsBooked: 3,
    }];
    const form = new FormData();
    Object.entries({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "August outreach",
      experimentId: "",
      notes: "",
      metrics: JSON.stringify(metrics),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(mocks.requireAdminSession).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_batch", expect.objectContaining({ p_metrics: metrics }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "5210b79a-90eb-4218-82c2-32d7eea6f429" });
  });

  it("rejects impossible counts before contacting the database", async () => {
    const form = new FormData();
    Object.entries({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "",
      experimentId: "",
      notes: "",
      metrics: JSON.stringify([{
        variantId: null,
        variantLabel: "No variant",
        connectionRequests: 10,
        connectionsAccepted: 11,
        initialDms: 10,
        f1Sent: 0,
        f2Sent: 0,
        replies: 0,
        positiveReplies: 0,
        callsBooked: 0,
      }]),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(result).toEqual({ status: "error", message: "Accepted connections cannot exceed connection requests" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
