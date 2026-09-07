import { afterEach, describe, expect, it, vi } from "vitest";
import { readTabValue, removeTabValue, writeTabValue } from "./tab-storage";

afterEach(() => vi.unstubAllGlobals());

describe("optional tab storage", () => {
  it("does not throw when browser storage methods reject access", () => {
    const denied = () => { throw new DOMException("Storage denied", "SecurityError"); };
    vi.stubGlobal("sessionStorage", { getItem: denied, setItem: denied, removeItem: denied });
    expect(readTabValue("flow")).toBeNull();
    expect(writeTabValue("flow", "draft")).toBe(false);
    expect(removeTabValue("legacy-flow")).toBe(false);
  });

  it("still saves and restores progress when storage is available", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(writeTabValue("flow", "draft")).toBe(true);
    expect(readTabValue("flow")).toBe("draft");
    expect(removeTabValue("flow")).toBe(true);
    expect(readTabValue("flow")).toBeNull();
  });
});
