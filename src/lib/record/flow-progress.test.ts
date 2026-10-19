import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRecordFlowProgress,
  RECORD_FLOW_STORAGE_KEY,
  restoredFlowPosition,
  routeStepsWithinLimits,
} from "./flow-progress";

afterEach(() => vi.unstubAllGlobals());

const ready = { acknowledged: true, noteReady: true };

describe("record flow restore", () => {
  it("reopens the handoff step only while a saved draft is waiting", () => {
    expect(restoredFlowPosition({ stage: 4, reached: 4 }, { ...ready, hasPendingDraft: true })).toEqual({ stage: 4, reached: 4 });
    expect(restoredFlowPosition({ stage: 4, reached: 4 }, { ...ready, hasPendingDraft: false })).toEqual({ stage: 3, reached: 3 });
  });

  it("keeps earlier steps exactly where they were", () => {
    expect(restoredFlowPosition({ stage: 2, reached: 3 }, { ...ready, hasPendingDraft: false })).toEqual({ stage: 2, reached: 3 });
    expect(restoredFlowPosition({ stage: 3, reached: 2 }, { ...ready, hasPendingDraft: false })).toEqual({ stage: 3, reached: 3 });
  });

  it("starts over without the processing confirmation or a usable note", () => {
    expect(restoredFlowPosition({ stage: 4, reached: 4 }, { acknowledged: false, noteReady: true, hasPendingDraft: true })).toEqual({ stage: 0, reached: 0 });
    expect(restoredFlowPosition({ stage: 3, reached: 3 }, { acknowledged: true, noteReady: false, hasPendingDraft: false })).toEqual({ stage: 0, reached: 3 });
  });

  it("clears the same tab key the record flow saves to", () => {
    const values = new Map([[RECORD_FLOW_STORAGE_KEY, "{}"], ["other", "kept"]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(RECORD_FLOW_STORAGE_KEY).toBe("ajani_record_flow_v3");
    expect(clearRecordFlowProgress()).toBe(true);
    expect(values.has(RECORD_FLOW_STORAGE_KEY)).toBe(false);
    expect(values.get("other")).toBe("kept");
  });
});

describe("route step limits", () => {
  const step = { id: "a", kind: "trigger" as const, title: "A request arrives", detail: "Capture it." };

  it("accepts steps at the limits the build desk allows", () => {
    expect(routeStepsWithinLimits([{ ...step, title: "t".repeat(120), detail: "d".repeat(1_000) }])).toBe(true);
  });

  it("flags a description or name that the build desk would reject", () => {
    expect(routeStepsWithinLimits([step, { ...step, id: "b", detail: "d".repeat(1_001) }])).toBe(false);
    expect(routeStepsWithinLimits([{ ...step, title: "t".repeat(121) }])).toBe(false);
  });
});
