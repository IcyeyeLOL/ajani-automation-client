import "server-only";

export type RequestSaveDiagnostic = {
  at: string;
  status: "started" | "rate_limited" | "succeeded" | "failed";
  stage: string;
  errorCode?: string;
  hasVoice?: boolean;
  transcriptCharacters?: number;
  systemBlockCount?: number;
};

const DIAGNOSTIC_KEY = "__ajaniRequestSaveDiagnostics";
const MAX_EVENTS = 30;

export function recordRequestSaveDiagnostic(event: Omit<RequestSaveDiagnostic, "at">) {
  if (process.env.NODE_ENV !== "development") return;
  const store = diagnosticStore();
  store.push({ ...event, at: new Date().toISOString() });
  if (store.length > MAX_EVENTS) store.splice(0, store.length - MAX_EVENTS);
}

export function recentRequestSaveDiagnostics() {
  return [...diagnosticStore()];
}

function diagnosticStore() {
  const scope = globalThis as typeof globalThis & { [DIAGNOSTIC_KEY]?: RequestSaveDiagnostic[] };
  scope[DIAGNOSTIC_KEY] ??= [];
  return scope[DIAGNOSTIC_KEY];
}
