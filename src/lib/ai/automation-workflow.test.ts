import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generate, Output: { object: (value: unknown) => value } }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (model: string) => model }));
import { generateAutomationIntake, generateAutomationShape } from "./automation-workflow";
import { fallbackAutomationShape } from "@/lib/record/automation-brief";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); mocks.generate.mockReset(); });
const transcript = "Website quote requests arrive after hours and wait until the next morning for a reply.";
describe("server generation contracts", () => {
  it("does not restart a provider budget after the shared deadline is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mocks.generate.mockImplementation(async () => { vi.setSystemTime(144_001); throw new Error("slow provider"); });
    const result = await generateAutomationIntake(transcript, { deadlineAt: 145_000 });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(result.method).not.toBe("ai");
  });
  it("uses only remaining provider time after validation and DB work", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mocks.generate.mockRejectedValue(new Error("unavailable"));
    await generateAutomationIntake(transcript, { deadlineAt: 108_000 });
    expect(timeout).toHaveBeenCalledWith(7_000);
  });
  it("rejects an otherwise valid generated route without a human handoff", async () => {
    const fallback = fallbackAutomationShape(transcript, []);
    mocks.generate.mockResolvedValue({ output: { ...fallback, systemBlocks: fallback.systemBlocks.map((block) => ({ ...block, kind: "custom" })) } });
    const result = await generateAutomationShape(transcript, []);
    expect(result.method).not.toBe("ai");
    expect(result.systemBlocks.some((block) => block.kind === "handoff")).toBe(true);
  });
});
