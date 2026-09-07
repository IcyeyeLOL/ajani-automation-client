import { afterEach, describe, expect, it, vi } from "vitest";
import { getReducedMotionPreference, shouldReduceMotion, subscribeToMotionPreference } from "./preference";

afterEach(() => vi.unstubAllGlobals());

describe("shared motion policy", () => {
  it("animates by default regardless of device preference", () => {
    for (const override of [undefined, null, "full", "unknown"]) {
      expect(shouldReduceMotion(true, override)).toBe(false);
      expect(shouldReduceMotion(false, override)).toBe(false);
    }
  });
  it("retains an explicitly requested device-based fallback", () => {
    expect(shouldReduceMotion(true, "system")).toBe(true);
    expect(shouldReduceMotion(false, "system")).toBe(false);
  });
  it("is safe to read and subscribe on the server", () => {
    expect(getReducedMotionPreference()).toBe(false);
    const subscriber = vi.fn();
    const unsubscribe = subscribeToMotionPreference(subscriber);
    expect(subscriber).toHaveBeenCalledWith(false);
    expect(unsubscribe).not.toThrow();
  });
  it("never consults legacy storage, even when storage is denied", () => {
    const getStorage = vi.fn(() => { throw new Error("denied"); });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }), get localStorage() { return getStorage(); } });
    vi.stubGlobal("document", { documentElement: { dataset: { motion: "full" } } });
    expect(getReducedMotionPreference()).toBe(false);
    expect(getStorage).not.toHaveBeenCalled();
  });
  it("shares listeners, tracks explicit changes, and cleans up the last subscriber", () => {
    let mediaChange = () => {};
    let overrideChange = () => {};
    const media = { matches: true, addEventListener: vi.fn((_event, cb) => { mediaChange = cb; }), removeEventListener: vi.fn() };
    const disconnect = vi.fn();
    const dataset = { motion: "full" as string | undefined };
    vi.stubGlobal("window", { matchMedia: () => media });
    vi.stubGlobal("document", { documentElement: { dataset } });
    vi.stubGlobal("MutationObserver", class {
      constructor(callback: () => void) { overrideChange = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToMotionPreference(first);
    const stopSecond = subscribeToMotionPreference(second);
    try {
      expect(first).toHaveBeenLastCalledWith(false);
      expect(media.addEventListener).toHaveBeenCalledTimes(1);
      dataset.motion = "system";
      overrideChange();
      expect(second).toHaveBeenLastCalledWith(true);
      media.matches = false;
      mediaChange();
      expect(second).toHaveBeenLastCalledWith(false);
      dataset.motion = "full";
      overrideChange();
      media.matches = true;
      mediaChange();
      expect(second).toHaveBeenLastCalledWith(false);
      stopFirst();
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      stopFirst();
      stopSecond();
    }
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
