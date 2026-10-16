import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";
import type { ConnectorId } from "@/lib/connectors/connector-store";

/**
 * Rotating provider tokens (Instagram's refreshes every 60 days) are stored
 * sealed with AES-256-GCM. The key lives only in CONNECTOR_ENCRYPTION_KEY on
 * the server, so the database never holds a usable token, and the connector
 * name is bound in as associated data, so a sealed token cannot be replayed
 * for another connector.
 */
const VERSION = "v1";

export function vaultKey(source: Record<string, string | undefined> = process.env) {
  const raw = source.CONNECTOR_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function sealCredential(plaintext: string, key: Buffer, connector: ConnectorId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(connector));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** null for anything tampered, sealed with another key, or for another connector. */
export function openCredential(sealed: string, key: Buffer, connector: ConnectorId) {
  const [version, iv, ciphertext, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(connector));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type StoredCredential = { token: string; expiresAt: string | null; updatedAt: string };

export type CredentialStore = {
  load(connector: ConnectorId): Promise<StoredCredential | null>;
  save(connector: ConnectorId, token: string, expiresAt: string | null): Promise<void>;
};

/** The live store. Callers check vaultKey() first; without a key nothing is read or written. */
export function databaseCredentialStore(key: Buffer, deadlineAt: number): CredentialStore {
  const admin = createSupabaseAdminClient();
  return {
    async load(connector) {
      const { data, error } = await withinDeadline(admin.rpc("load_analytics_connector_credential", { p_connector: connector }), deadlineAt);
      if (error) throw new Error("credential_load_failed");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const token = typeof record.sealed === "string" ? openCredential(record.sealed, key, connector) : null;
      if (!token) return null;
      return {
        token,
        expiresAt: typeof record.expires_at === "string" ? record.expires_at : null,
        updatedAt: typeof record.updated_at === "string" ? record.updated_at : "",
      };
    },
    async save(connector, token, expiresAt) {
      const { error } = await withinDeadline(admin.rpc("save_analytics_connector_credential", {
        p_connector: connector, p_sealed: sealCredential(token, key, connector), p_expires_at: expiresAt,
      }), deadlineAt);
      if (error) throw new Error("credential_save_failed");
    },
  };
}
