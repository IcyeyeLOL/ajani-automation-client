export type LimitedJsonResult =
  | { status: "ok"; value: unknown }
  | { status: "invalid" }
  | { status: "too_large" };

/**
 * Reads JSON without trusting Content-Length, which may be absent or incorrect
 * for streamed requests. The reader is cancelled as soon as the limit is
 * crossed so mutation handlers do not buffer an unbounded body.
 */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  if (!request.body) return { status: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { status: "too_large" };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      status: "ok",
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    return { status: "invalid" };
  }
}
