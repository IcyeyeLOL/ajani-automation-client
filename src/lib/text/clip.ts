/**
 * Cuts text to a length limit (in UTF-16 units, as the schemas count) without
 * splitting an emoji in half. A lone half makes the saved JSON invalid, so
 * the database refuses it and every retry of the same request fails.
 */
export function clipText(text: string, max: number) {
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}
