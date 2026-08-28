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

import { createExperimentAction, createOutreachBatchAction, logExperimentMetricsAction } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";

describe("admin server actions", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.requireAdminSession.mockReset();
    mocks.requireAdminSession.mockResolvedValue("user_admin");
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
      messageStep: "initial_dm",
      primaryMetric: "reply_rate",
      variants: "Outcome hook, Compliance hook",
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createExperimentAction(initialAdminActionState, form);

    expect(mocks.requireAdminSession).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_experiment", expect.objectContaining({
      p_title: "Outcome hook comparison",
      p_created_by: "user_admin",
      p_message_step: "initial_dm",
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
      customSent: 0,
      replies: 12,
      attributedReplies: 12,
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
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_batch", expect.objectContaining({ p_actor: "user_admin", p_metrics: metrics }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "5210b79a-90eb-4218-82c2-32d7eea6f429" });
  });

  it("accepts a batch whose only activity is a custom message step", async () => {
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f430", error: null });
    const form = new FormData();
    Object.entries({
      activityDate: "2026-08-14",
      teamMember: "Ajani team",
      channel: "linkedin",
      method: "manual",
      audience: "Insurance owners",
      campaign: "Custom follow-up",
      experimentId: "",
      notes: "",
      metrics: JSON.stringify([{
        variantId: null,
        variantLabel: "No variant",
        connectionRequests: 0,
        connectionsAccepted: 0,
        initialDms: 0,
        f1Sent: 0,
        f2Sent: 0,
        customSent: 7,
        replies: 0,
        attributedReplies: 0,
        positiveReplies: 0,
        callsBooked: 0,
      }]),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(result.status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledWith("create_outreach_batch", expect.objectContaining({
      p_metrics: [expect.objectContaining({ customSent: 7 })],
    }));
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
        customSent: 0,
        replies: 0,
        attributedReplies: 0,
        positiveReplies: 0,
        callsBooked: 0,
      }]),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await createOutreachBatchAction(initialAdminActionState, form);

    expect(result).toEqual({ status: "error", message: "Accepted connections cannot exceed connection requests" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("persists the focused counts for every experiment variant", async () => {
    mocks.rpc.mockResolvedValue({ data: "5210b79a-90eb-4218-82c2-32d7eea6f431", error: null });
    const metrics = [{
      variantId: "b7053867-3ad5-483f-90ba-d542abbd6ebd",
      variantLabel: "A",
      sent: 125,
      replies: 19,
      positiveReplies: 8,
      callsBooked: 4,
      connectionRequests: 150,
      connectionsAccepted: 63,
    }];
    const form = new FormData();
    Object.entries({
      experimentId: "5210b79a-90eb-4218-82c2-32d7eea6f429",
      messageStep: "initial_dm",
      activityDate: "2026-08-26",
      teamMember: "Ajani team",
      notes: "August cohort",
      metrics: JSON.stringify(metrics),
    }).forEach(([key, value]) => form.set(key, value));

    const result = await logExperimentMetricsAction(initialAdminActionState, form);

    expect(mocks.requireAdminSession).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_experiment_metric_snapshot", {
      p_experiment_id: "5210b79a-90eb-4218-82c2-32d7eea6f429",
      p_activity_date: "2026-08-26",
      p_team_member: "Ajani team",
      p_notes: "August cohort",
      p_metrics: metrics,
      p_actor: "user_admin",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(result).toMatchObject({ status: "success", entityId: "5210b79a-90eb-4218-82c2-32d7eea6f431" });
  });
});
