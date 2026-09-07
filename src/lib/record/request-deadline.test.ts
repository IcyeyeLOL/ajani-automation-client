import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestDeadline } from "./request-deadline";

const options = { timeoutMs: 100, timeoutMessage: "Processing took too long." };

afterEach(() => vi.useRealTimers());

describe("client request deadline", () => {
  it("returns successful work and clears its deadline/listener", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    await expect(withRequestDeadline(async () => "ready", { ...options, signal: caller.signal })).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not start a request that the caller already canceled", async () => {
    const caller = new AbortController();
    caller.abort();
    const operation = vi.fn();
    await expect(withRequestDeadline(operation, { ...options, signal: caller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("aborts active network work when the caller invalidates its input", async () => {
    const caller = new AbortController();
    let networkSignal: AbortSignal | undefined;
    const pending = withRequestDeadline((signal) => {
      networkSignal = signal;
      return new Promise<never>(() => {});
    }, { ...options, signal: caller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    caller.abort();
    await rejected;
    expect(networkSignal?.aborted).toBe(true);
  });

  it("bounds stalled work even if an operation ignores the abort signal", async () => {
    vi.useFakeTimers();
    let networkSignal: AbortSignal | undefined;
    const pending = withRequestDeadline((signal) => {
      networkSignal = signal;
      return new Promise<never>(() => {});
    }, options);
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError", message: options.timeoutMessage });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(networkSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
