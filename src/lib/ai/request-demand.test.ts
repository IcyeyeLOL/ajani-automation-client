import { describe, expect, it, vi } from "vitest";
import { classifyRequestDemandFallback } from "@/lib/ai/request-demand";

vi.mock("server-only", () => ({}));

const baseInput = {
  clarificationAnswers: [],
  developmentBrief: undefined,
  systemBlocks: [
    { id: "trigger", kind: "trigger" as const, title: "A request arrives", detail: "Capture the request." },
    { id: "reply", kind: "reply" as const, title: "Reply promptly", detail: "Send the next step." },
  ],
};

describe("request demand fallback", () => {
  it("classifies the business and operational outcome independently", () => {
    const result = classifyRequestDemandFallback({
      ...baseInput,
      title: "After-hours clinic leads",
      transcript: "Our dental clinic needs every new patient enquiry followed up after hours.",
    });

    expect(result).toMatchObject({
      businessVertical: "Clinics and Practices",
      demandCategory: "Lead Follow-up",
    });
  });

  it("prioritizes quote demand over incidental lead wording", () => {
    const result = classifyRequestDemandFallback({
      ...baseInput,
      title: "Plumbing quote workflow",
      transcript: "A plumber needs to turn each website lead into an estimate and proposal.",
    });

    expect(result).toMatchObject({
      businessVertical: "Trades and Field Work",
      demandCategory: "Sales Quotes and Proposals",
    });
  });
});
