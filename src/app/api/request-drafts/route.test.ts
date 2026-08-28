import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  after: vi.fn(),
  createAdmin: vi.fn(),
  extractDemand: vi.fn(),
  diagnostic: vi.fn(),
}));

import {
  POST,
  clarificationRound,
  consumePublicRequestAllowance,
  readLimitedJson,
  scheduleRequestDemandAnalysis,
} from "@/app/api/request-drafts/route";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: routeMocks.after }));
vi.mock("@/lib/ai/request-demand", () => ({ extractRequestDemand: routeMocks.extractDemand }));
vi.mock("@/lib/operations/request-save-diagnostics", () => ({
  recordRequestSaveDiagnostic: routeMocks.diagnostic,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: routeMocks.createAdmin,
}));

beforeEach(() => {
  routeMocks.after.mockReset();
  routeMocks.createAdmin.mockReset();
  routeMocks.extractDemand.mockReset();
  routeMocks.diagnostic.mockReset();
});

describe("request draft body parsing", () => {
  it("parses valid JSON bodies", async () => {
    const request = new Request("https://ajani.test/api/request-drafts", {
      method: "POST",
      body: JSON.stringify({ draft: { title: "A request" } }),
    });
    await expect(readLimitedJson(request)).resolves.toEqual({
      status: "ok",
      value: { draft: { title: "A request" } },
    });
  });

  it("rejects streamed bodies over the byte limit even without Content-Length", async () => {
    const request = new Request("https://ajani.test/api/request-drafts", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(100_001));
          controller.close();
        },
      }),
      // Required by Node for streaming request bodies; browsers supply the
      // equivalent transport semantics themselves.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readLimitedJson(request)).resolves.toEqual({ status: "too_large" });
  });
});

describe("public request allowance", () => {
  it("retries one transient database failure before allowing the save", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "ETIMEDOUT" } })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(consumePublicRequestAllowance({ rpc } as never, "fingerprint-123")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not retry a successful rate-limit decision", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(consumePublicRequestAllowance({ rpc } as never, "fingerprint-123")).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("clarification round persistence", () => {
  it("stores one workflow round for a batch of five answered questions", () => {
    expect(clarificationRound({
      clarificationAnswer: "",
      clarificationAnswers: Array.from({ length: 5 }, (_, index) => ({
        question: `Question ${index + 1}`,
        answer: `Answer ${index + 1}`,
      })),
    })).toBe(1);
  });

  it("stores zero rounds when no clarification was answered", () => {
    expect(clarificationRound({ clarificationAnswer: "", clarificationAnswers: [] })).toBe(0);
  });
});

describe("post-response request demand analysis", () => {
  const job = {
    draftId: "2bd4bdc9-f65c-4620-908d-d4c16fc0b37d",
    transcriptFingerprint: "transcript-fingerprint",
    input: {
      title: "Route new leads",
      transcript: "Send each new website lead to the right team member.",
      clarificationAnswers: [],
      developmentBrief: undefined,
      systemBlocks: [{
        id: "trigger-1",
        kind: "trigger" as const,
        title: "New lead arrives",
        detail: "Capture a completed website form.",
      }],
    },
    latestExtraction: { source: "customer_approved_website_flow" },
  };

  it("returns 201 with a base AI state before route-level extraction starts", async () => {
    const draftId = "bfa16669-b62c-49e5-a356-9ac634a969bb";
    const insertState = vi.fn().mockResolvedValue({ error: null });
    const insertRun = vi.fn().mockResolvedValue({ error: null });
    const finalStateFilter = vi.fn().mockResolvedValue({ error: null });
    const transcriptFilter = vi.fn(() => ({ eq: finalStateFilter }));
    const updateState = vi.fn(() => ({ eq: transcriptFilter }));
    const rateLimit = vi.fn().mockResolvedValue({ data: true, error: null });
    const deleteDraft = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    const from = vi.fn((table: string) => {
      if (table === "request_drafts") {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: { id: draftId, status: "ready_to_submit", updated_at: "2026-08-27T00:00:00.000Z" },
                error: null,
              }),
            }),
          }),
          delete: deleteDraft,
        };
      }
      if (table === "request_draft_ai_states") {
        return { insert: insertState, update: updateState };
      }
      if (table === "request_draft_ai_runs") return { insert: insertRun };
      throw new Error(`Unexpected table: ${table}`);
    });
    routeMocks.createAdmin.mockReturnValue({ rpc: rateLimit, from });
    routeMocks.extractDemand.mockResolvedValue({
      extraction: {
        businessVertical: "Other Service Businesses",
        demandCategory: "Lead Follow-up",
        summary: "Route new website leads.",
        confidence: 0.91,
        method: "ai",
        provider: "vercel_ai_gateway",
        model: "anthropic/claude-sonnet-5",
        promptVersion: "request-demand-v1",
      },
      latencyMs: 120,
      tokenUsage: {},
      routeReasons: [],
    });
    let postResponseTask: (() => void | Promise<void>) | undefined;
    routeMocks.after.mockImplementation((task: () => void | Promise<void>) => {
      postResponseTask = task;
    });

    const response = await POST(new Request("https://ajani.test/api/request-drafts", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://ajani.test" },
      body: JSON.stringify({
        draft: {
          title: "Route new leads",
          transcript: "Send each new website lead to the right team member.",
          clarificationAnswer: "",
          clarificationAnswers: [],
          systemBlocks: [{
            id: "trigger-1",
            kind: "trigger",
            title: "New lead arrives",
            detail: "Capture a completed website form.",
          }],
          voiceMemo: null,
        },
      }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ draft: { id: draftId } });
    expect(routeMocks.extractDemand).not.toHaveBeenCalled();
    expect(insertState).toHaveBeenCalledWith(expect.objectContaining({
      confidence: null,
      latest_extraction: expect.objectContaining({ demand: null }),
    }));
    expect(postResponseTask).toBeTypeOf("function");

    await postResponseTask?.();

    expect(routeMocks.extractDemand).toHaveBeenCalledOnce();
    expect(insertRun).toHaveBeenCalledOnce();
    expect(updateState).toHaveBeenCalledWith(expect.objectContaining({
      confidence: 0.91,
      latest_extraction: expect.objectContaining({
        demand: expect.objectContaining({ demandCategory: "Lead Follow-up" }),
      }),
    }));
    expect(transcriptFilter).toHaveBeenCalledWith("request_draft_id", draftId);
    expect(finalStateFilter).toHaveBeenCalledWith("transcript_fingerprint", expect.any(String));
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("registers enrichment without running it on the save response path", async () => {
    let afterTask: (() => void | Promise<void>) | undefined;
    const persist = vi.fn().mockResolvedValue(undefined);

    scheduleRequestDemandAnalysis(job, {
      schedule: (task) => { afterTask = task; },
      persist,
    });

    expect(persist).not.toHaveBeenCalled();
    expect(afterTask).toBeTypeOf("function");
    await afterTask?.();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("keeps a completed save successful when enrichment fails", async () => {
    let afterTask: (() => void | Promise<void>) | undefined;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    scheduleRequestDemandAnalysis(job, {
      schedule: (task) => { afterTask = task; },
      persist: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    });

    await expect(afterTask?.()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "Post-response request demand extraction failed",
      expect.objectContaining({ draftId: job.draftId }),
    );
    consoleError.mockRestore();
  });

  it("keeps a completed save successful when after-work cannot be registered", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => scheduleRequestDemandAnalysis(job, {
      schedule: () => { throw new Error("after context unavailable"); },
      persist: vi.fn(),
    })).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      "Post-response request demand extraction could not be scheduled",
      expect.objectContaining({ draftId: job.draftId }),
    );
    consoleError.mockRestore();
  });
});
