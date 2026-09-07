type RequestDeadlineOptions = { signal?: AbortSignal; timeoutMs: number; timeoutMessage: string };

/** Bound the whole response, including body parsing, and release abort listeners. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal, timeoutMs, timeoutMessage }: RequestDeadlineOptions,
): Promise<T> {
  const controller = new AbortController();
  let rejectCancellation!: (reason: unknown) => void;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectCancellation(reason);
  };
  const onAbort = () => abort(signal?.reason ?? new DOMException("Request canceled.", "AbortError"));
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => abort(new DOMException(timeoutMessage, "TimeoutError")), timeoutMs);
  try {
    if (signal?.aborted) onAbort();
    return await Promise.race([
      cancellation,
      // Avoid starting work at all if the caller already canceled it.
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return operation(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
