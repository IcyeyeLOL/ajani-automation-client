import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("tests must never reach the database"); } }));

import { connectorMessage, connectorSetup, ingestEnabled, ingestKeyTooShort, isConnectorId } from "@/lib/connectors/registry";
import type { ConnectorReason, ConnectorResult, ConnectorStatus } from "@/lib/connectors/connector-store";

const SECRETS = {
  YOUTUBE_API_KEY: "AIzaSECRET-youtube-key",
  YOUTUBE_CHANNEL_ID: "UC1234567890abcdefghijkl",
  YOUTUBE_CLIENT_ID: "SECRET-client-id",
  YOUTUBE_CLIENT_SECRET: "GOCSPX-SECRET",
  YOUTUBE_REFRESH_TOKEN: "1//SECRET-refresh",
  INSTAGRAM_ACCESS_TOKEN: "IGAASECRET-token",
  CONNECTOR_ENCRYPTION_KEY: "ab".repeat(32),
  AJANI_METRICS_INGEST_KEY: "SECRET".repeat(8),
};

const result = (connector: "youtube" | "instagram", status: ConnectorStatus, reason: ConnectorReason | null, valuesWritten = 4): ConnectorResult =>
  ({ connector, status, reason, date: "2026-10-16", valuesWritten, details: {} });

describe("connector setup", () => {
  it("reports names and presence only, never values", () => {
    const setup = connectorSetup(SECRETS);
    const text = JSON.stringify(setup);
    for (const value of Object.values(SECRETS)) expect(text).not.toContain(value);
    expect(setup.find((item) => item.id === "youtube")).toMatchObject({ configured: true, level: "analytics" });
    expect(setup.find((item) => item.id === "instagram")).toMatchObject({ configured: true, level: "account", optional: [{ name: "CONNECTOR_ENCRYPTION_KEY", present: true }] });
  });

  it("tells apart missing settings and settings in the wrong format", () => {
    const setup = connectorSetup({ YOUTUBE_API_KEY: "k", YOUTUBE_CHANNEL_ID: "https://www.youtube.com/@ajani", CONNECTOR_ENCRYPTION_KEY: "not-32-bytes" });
    const youtube = setup.find((item) => item.id === "youtube");
    expect(youtube).toMatchObject({ configured: false, level: null });
    expect(youtube?.settings).toEqual([{ name: "YOUTUBE_API_KEY", present: true }, { name: "YOUTUBE_CHANNEL_ID", present: false, invalid: true }]);
    expect(setup.find((item) => item.id === "instagram")?.optional).toEqual([{ name: "CONNECTOR_ENCRYPTION_KEY", present: false, invalid: true }]);
    expect(connectorSetup({ YOUTUBE_API_KEY: "k", YOUTUBE_CHANNEL_ID: "@ajani" }).find((item) => item.id === "youtube")?.level).toBe("public");
  });

  it("switches the endpoint on only with a long key", () => {
    expect(ingestEnabled({})).toBe(false);
    expect(ingestKeyTooShort({})).toBe(false);
    expect(ingestEnabled({ AJANI_METRICS_INGEST_KEY: "short" })).toBe(false);
    expect(ingestKeyTooShort({ AJANI_METRICS_INGEST_KEY: "short" })).toBe(true);
    expect(ingestEnabled({ AJANI_METRICS_INGEST_KEY: "x".repeat(32) })).toBe(true);
  });

  it("knows only real connectors", () => {
    expect(isConnectorId("youtube")).toBe(true);
    expect(isConnectorId("reddit")).toBe(false);
    expect(isConnectorId("__proto__")).toBe(false);
    expect(isConnectorId(null)).toBe(false);
  });
});

describe("connector messages", () => {
  it("covers every status and reason in plain language", () => {
    const statuses: ConnectorStatus[] = ["synced", "partial", "not_configured", "rejected"];
    const reasons: Array<ConnectorReason | null> = [null, "invalid_credentials", "token_expired", "permission_missing", "access_not_approved", "account_not_found", "rate_limited", "deadline", "failures", "save_failed", "vault_missing"];
    for (const connector of ["youtube", "instagram"] as const) {
      for (const status of statuses) {
        for (const reason of reasons) {
          const message = connectorMessage(result(connector, status, reason));
          expect(message.message.length, `${connector} ${status} ${reason}`).toBeGreaterThan(20);
          expect(message.message).not.toMatch(/undefined|null|\[object/);
          expect(message.status).toBe(status === "synced" ? "success" : "error");
        }
      }
    }
  });

  it("names the fix for the reasons the owner must act on", () => {
    expect(connectorMessage(result("instagram", "rejected", "token_expired")).message).toContain("INSTAGRAM_ACCESS_TOKEN");
    expect(connectorMessage(result("youtube", "rejected", "token_expired")).message).toContain("In production");
    expect(connectorMessage(result("youtube", "partial", "token_expired")).message).toMatch(/^Synced part of YouTube \(4 numbers changed\)\. Google's sign-in/);
    expect(connectorMessage(result("youtube", "partial", "save_failed")).message).toContain("database migration");
    expect(connectorMessage(result("instagram", "synced", "vault_missing", 1)).message).toBe("Synced Instagram for 2026-10-16 (UTC): 1 number changed. Add CONNECTOR_ENCRYPTION_KEY so the Instagram token renews itself before its 60 days run out.");
  });
});
