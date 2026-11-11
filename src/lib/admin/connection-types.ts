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
  dripify: DripifySummary;
};

/** Counts from the latest Dripify sync. Campaign names are the owner's own labels; no lead data. */
export type DripifySummary = {
  /** unavailable: the latest values could not be read (for example before the migration). */
  status: "available" | "unavailable";
  configured: boolean;
  /** UTC day of the most recent sync, or null before the first one. */
  lastSyncedOn: string | null;
  unreadMessages: number | null;
  activeCampaigns: number | null;
  /** Campaigns still sending whose fresh leads are nearly used up. */
  lowCampaigns: Array<{ dimension: string; label: string; remaining: number }>;
};
