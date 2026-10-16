/** Client-safe view of the connectors: setting names and outcomes only, never setting values. */
export type ConnectionSetting = { name: string; present: boolean; invalid?: boolean };

export type ConnectionCard = {
  id: "youtube" | "instagram";
  label: string;
  configured: boolean;
  /** analytics = private numbers (Google sign-in), public = API key only, account = Instagram token. */
  level: "analytics" | "public" | "account" | null;
  settings: ConnectionSetting[];
  optional: ConnectionSetting[];
  lastRunAt: string | null;
  lastSyncedAt: string | null;
  lastOutcome: { status: "success" | "error"; message: string } | null;
};

export type ConnectionBoard = {
  status: "available" | "unavailable";
  connectors: ConnectionCard[];
  ingest: { enabled: boolean; keyTooShort: boolean; path: string };
  dripify: { configured: boolean };
};
