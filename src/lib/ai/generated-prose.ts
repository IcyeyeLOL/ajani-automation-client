export function normalizeGeneratedProse<T>(value: T): T {
  if (typeof value === "string") return normalizeGeneratedText(value) as T;
  if (Array.isArray(value)) return value.map((item) => normalizeGeneratedProse(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeGeneratedProse(item)]),
    ) as T;
  }
  return value;
}

export function normalizeGeneratedText(value: string) {
  return value
    .replace(/(\d)\s*[\u2012-\u2015]\s*(\d)/g, "$1 to $2")
    .replace(/(\d)-(\d)/g, "$1 to $2")
    .replace(/(^|\n)\s*[-\u2012-\u2015]\s+/g, "$1")
    .replace(/\s+[-\u2012-\u2015]\s+/g, ", ")
    .replace(/[\u2012-\u2015]/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
