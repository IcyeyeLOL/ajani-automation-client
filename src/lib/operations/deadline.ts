/** A caller-owned deadline includes validation/DB time, not just the last provider attempt. */
export async function withinDeadline<T>(work: PromiseLike<T>, deadlineAt: number): Promise<T> {
  const promise = Promise.resolve(work);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    // Already-started work must not become an unhandled rejection after timeout.
    void promise.catch(() => undefined);
    throw new Error("operation_deadline_exceeded");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation_deadline_exceeded")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
