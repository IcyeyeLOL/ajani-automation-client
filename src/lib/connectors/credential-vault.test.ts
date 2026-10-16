import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

import { databaseCredentialStore, openCredential, sealCredential, vaultKey } from "@/lib/connectors/credential-vault";

const key = randomBytes(32);

describe("credential vault", () => {
  it("reads a 64-character hex key or a base64 key of 32 bytes, and nothing else", () => {
    expect(vaultKey({ CONNECTOR_ENCRYPTION_KEY: "ab".repeat(32) })?.length).toBe(32);
    expect(vaultKey({ CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("base64") })?.length).toBe(32);
    expect(vaultKey({ CONNECTOR_ENCRYPTION_KEY: "too-short" })).toBeNull();
    expect(vaultKey({ CONNECTOR_ENCRYPTION_KEY: "ab".repeat(31) })).toBeNull();
    expect(vaultKey({ CONNECTOR_ENCRYPTION_KEY: "  " })).toBeNull();
    expect(vaultKey({})).toBeNull();
  });

  it("seals with a fresh IV each time and opens only with the same key and connector", () => {
    const first = sealCredential("IGAAtoken-123", key, "instagram");
    const second = sealCredential("IGAAtoken-123", key, "instagram");
    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("IGAAtoken");
    expect(openCredential(first, key, "instagram")).toBe("IGAAtoken-123");
    expect(openCredential(first, key, "youtube")).toBeNull();
    expect(openCredential(first, randomBytes(32), "instagram")).toBeNull();
  });

  it("rejects anything tampered with or in another format", () => {
    const sealed = sealCredential("secret", key, "instagram");
    const [version, iv, ciphertext, tag] = sealed.split(".");
    const flipped = ciphertext.slice(0, -1) + (ciphertext.endsWith("A") ? "B" : "A");
    expect(openCredential([version, iv, flipped, tag].join("."), key, "instagram")).toBeNull();
    expect(openCredential([version, iv, ciphertext, ""].join("."), key, "instagram")).toBeNull();
    expect(openCredential(["v2", iv, ciphertext, tag].join("."), key, "instagram")).toBeNull();
    expect(openCredential("secret", key, "instagram")).toBeNull();
  });

  it("stores only sealed text and reads it back through the RPCs", async () => {
    const saved: Record<string, unknown> = {};
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "save_analytics_connector_credential") { Object.assign(saved, args); return { data: null, error: null }; }
      return { data: [{ sealed: saved.p_sealed, expires_at: saved.p_expires_at, updated_at: "2026-10-16T00:00:00Z" }], error: null };
    });
    const store = databaseCredentialStore(key, Date.now() + 5_000);
    await store.save("instagram", "IGAA-plain", "2026-12-15T00:00:00.000Z");
    expect(String(saved.p_sealed)).not.toContain("IGAA-plain");
    await expect(store.load("instagram")).resolves.toMatchObject({ token: "IGAA-plain", expiresAt: "2026-12-15T00:00:00.000Z" });
    // A row sealed for one connector is useless to another.
    await expect(store.load("youtube")).resolves.toBeNull();
  });

  it("reports store failures without database detail", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "permission denied for relation analytics_connector_credentials" } });
    const store = databaseCredentialStore(key, Date.now() + 5_000);
    await expect(store.load("instagram")).rejects.toThrow(/^credential_load_failed$/);
    await expect(store.save("instagram", "x", null)).rejects.toThrow(/^credential_save_failed$/);
  });
});
