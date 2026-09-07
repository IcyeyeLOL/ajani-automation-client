import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ intake: vi.fn(), shape: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/ai/automation-workflow", () => ({
  generateAutomationIntake: mocks.intake,
  generateAutomationShape: mocks.shape,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { POST } from "@/app/api/automation-brief/route";
import { CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT } from "@/lib/legal/processing-notice";

const transcript = "Website quote requests arrive after hours and wait until morning for a reply.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("automation brief route", () => {
  it("generates transcript-specific clarification questions", async () => {
    mocks.intake.mockResolvedValue({ method: "ai", model: "test-model", problem: {}, clarifications: [] });
    const response = await POST(new Request("https://ajani.test/api/automation-brief", {
      method: "POST",
      headers: { origin: "https://ajani.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "clarify", transcript, ...CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.intake).toHaveBeenCalledWith(transcript, { deadlineAt: expect.any(Number) });
  });

  it("passes the transcript and complete answer history into route shaping", async () => {
    const clarificationAnswers = [
      { question: "Where do requests arrive?", answer: "Website form" },
      { question: "Who owns exceptions?", answer: "Sales manager" },
    ];
    mocks.shape.mockResolvedValue({ method: "ai", model: "test-model", problem: {}, systemBlocks: [] });
    const response = await POST(new Request("https://ajani.test/api/automation-brief", {
      method: "POST",
      headers: { origin: "https://ajani.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "shape", transcript, clarificationAnswers, ...CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.shape).toHaveBeenCalledWith(transcript, clarificationAnswers, { deadlineAt: expect.any(Number) });
  });

  it("rejects cross-origin model requests", async () => {
    const response = await POST(new Request("https://ajani.test/api/automation-brief", {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "clarify", transcript }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.intake).not.toHaveBeenCalled();
  });

  it("rejects provider processing without the current acknowledgment", async () => {
    const response = await POST(new Request("https://ajani.test/api/automation-brief", {
      method: "POST",
      headers: { origin: "https://ajani.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "clarify", transcript }),
    }));

    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.intake).not.toHaveBeenCalled();
  });
});
