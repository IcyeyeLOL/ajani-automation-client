import "server-only";

import { env, type ConnectorId, type ConnectorResult } from "@/lib/connectors/connector-store";
import { vaultKey } from "@/lib/connectors/credential-vault";
import { ingestKey } from "@/lib/connectors/ingest";
import { instagramConfigured, syncInstagramMetrics } from "@/lib/connectors/instagram";
import { syncYouTubeMetrics, youtubeChannelValid, youtubeSettings } from "@/lib/connectors/youtube";

export const CONNECTOR_IDS: readonly ConnectorId[] = ["youtube", "instagram"];

const labels: Record<ConnectorId, string> = { youtube: "YouTube", instagram: "Instagram" };

export function isConnectorId(value: unknown): value is ConnectorId {
  return typeof value === "string" && (CONNECTOR_IDS as readonly string[]).includes(value);
}

export type SyncOptions = { deadlineAt: number; now?: number };

export function syncConnector(id: ConnectorId, options: SyncOptions): Promise<ConnectorResult> {
  return id === "youtube" ? syncYouTubeMetrics(options) : syncInstagramMetrics(options);
}

/** Every configured connector in parallel (different providers), each within the same deadline. */
export async function syncAllConnectors(options: SyncOptions) {
  const settled = await Promise.allSettled(CONNECTOR_IDS.map((id) => syncConnector(id, options)));
  return settled.map((outcome, index): ConnectorResult => outcome.status === "fulfilled" ? outcome.value : {
    connector: CONNECTOR_IDS[index], status: "partial", reason: "failures", date: new Date(options.now ?? Date.now()).toISOString().slice(0, 10), valuesWritten: 0, details: {},
  });
}

/** present: set and usable. invalid: set, but in a shape the connector cannot use. */
export type SettingCheck = { name: string; present: boolean; invalid?: boolean };

/** Which settings exist, by name only. Values never leave the server. */
export type ConnectorSetup = {
  id: ConnectorId;
  label: string;
  configured: boolean;
  level: "analytics" | "public" | "account" | null;
  settings: SettingCheck[];
  optional: SettingCheck[];
};

export function connectorSetup(source: Record<string, string | undefined> = process.env): ConnectorSetup[] {
  const has = (name: string): SettingCheck => ({ name, present: Boolean(env(name, source)) });
  const checked = (name: string, usable: boolean): SettingCheck => {
    const set = Boolean(env(name, source));
    return set && !usable ? { name, present: false, invalid: true } : { name, present: set };
  };
  const youtube = youtubeSettings(source);
  const vault = checked("CONNECTOR_ENCRYPTION_KEY", vaultKey(source) !== null);
  return [
    {
      id: "youtube",
      label: labels.youtube,
      configured: youtube !== null,
      level: youtube?.oauth ? "analytics" : youtube ? "public" : null,
      settings: [has("YOUTUBE_API_KEY"), checked("YOUTUBE_CHANNEL_ID", youtubeChannelValid(env("YOUTUBE_CHANNEL_ID", source)))],
      optional: [has("YOUTUBE_CLIENT_ID"), has("YOUTUBE_CLIENT_SECRET"), has("YOUTUBE_REFRESH_TOKEN")],
    },
    {
      id: "instagram",
      label: labels.instagram,
      configured: instagramConfigured(source),
      level: instagramConfigured(source) ? "account" : null,
      settings: [has("INSTAGRAM_ACCESS_TOKEN")],
      optional: [vault],
    },
  ];
}

export function ingestEnabled(source: Record<string, string | undefined> = process.env) {
  return ingestKey(source) !== null;
}

/** Set but too short to be safe, so the endpoint stays off. */
export function ingestKeyTooShort(source: Record<string, string | undefined> = process.env) {
  return Boolean(env("AJANI_METRICS_INGEST_KEY", source)) && !ingestEnabled(source);
}

/** Plain language for the control desk. Never includes provider text or setting values. */
export function connectorMessage(result: ConnectorResult): { status: "success" | "error"; message: string } {
  const label = labels[result.connector];
  if (result.status === "not_configured") {
    return { status: "error", message: `${label} is not connected yet. Add its settings in Vercel, redeploy, then sync again.` };
  }
  if (result.status === "rejected") return { status: "error", message: rejectionMessage(result) };
  const numbers = `${result.valuesWritten} number${result.valuesWritten === 1 ? "" : "s"} changed`;
  if (result.status === "partial") {
    if (result.reason === "save_failed") {
      return { status: "error", message: `${label} answered, but its numbers could not be saved. Apply the latest database migration, then sync again.` };
    }
    if (result.reason && actionable.has(result.reason)) {
      return { status: "error", message: `Synced part of ${label} (${numbers}). ${rejectionMessage(result)}` };
    }
    const why = result.reason === "rate_limited" ? `${label} asked us to slow down or its daily quota ran out`
      : result.reason === "deadline" ? `${label} was slow to respond` : "some numbers could not be read";
    return { status: "error", message: `Synced part of ${label} (${numbers}); ${why}. The rest is read again on the next sync.` };
  }
  const renewal = result.reason === "vault_missing"
    ? " Add CONNECTOR_ENCRYPTION_KEY so the Instagram token renews itself before its 60 days run out." : "";
  return { status: "success", message: `Synced ${label} for ${result.date} (UTC): ${numbers}.${renewal}` };
}

/** Reasons the owner has to fix; the rest clear up on the next sync. */
const actionable = new Set(["invalid_credentials", "token_expired", "permission_missing", "access_not_approved", "account_not_found"]);

function rejectionMessage(result: ConnectorResult) {
  if (result.connector === "youtube") {
    switch (result.reason) {
      case "token_expired": return "Google's sign-in for YouTube expired or was revoked. Create a new refresh token, and set the Google Cloud app to \"In production\" so tokens stop expiring after 7 days.";
      case "invalid_credentials": return "Google did not accept the YouTube settings. Check YOUTUBE_API_KEY (or the client ID, secret and refresh token) in Vercel.";
      case "access_not_approved": return "The YouTube APIs are not switched on for this Google Cloud project. Enable YouTube Data API v3 (and YouTube Analytics API for private numbers), then sync again.";
      case "account_not_found": return "YouTube could not find the channel. Check YOUTUBE_CHANNEL_ID (the UC… ID or your @handle).";
      case "rate_limited": return "YouTube's daily quota for this project is used up. It resets at midnight Pacific time.";
      default: return "YouTube refused the request. The Google sign-in may be missing the YouTube Analytics permission; create a new refresh token with both read-only scopes.";
    }
  }
  switch (result.reason) {
    case "token_expired": return "The Instagram token expired. Generate a new one in Meta's App Dashboard (Instagram → API setup with Instagram business login), then paste it into INSTAGRAM_ACCESS_TOKEN.";
    case "invalid_credentials": return "Instagram did not accept the token. Generate a new one in Meta's App Dashboard and update INSTAGRAM_ACCESS_TOKEN.";
    case "permission_missing": return "The Instagram token is missing a permission. Generate it again with instagram_business_basic and instagram_business_manage_insights.";
    case "account_not_found": return "Instagram did not return a professional account for this token. Switch the account to Business or Creator, then generate a new token.";
    default: return "Instagram refused the request. Generate a new token in Meta's App Dashboard, then sync again.";
  }
}
