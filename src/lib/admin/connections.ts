import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/admin/session";
import { withinDeadline } from "@/lib/operations/deadline";
import { connectorMessage, connectorSetup, ingestEnabled, ingestKeyTooShort, isConnectorId } from "@/lib/connectors/registry";
import type { ConnectorReason, ConnectorStatus } from "@/lib/connectors/connector-store";
import type { ConnectionBoard } from "@/lib/admin/connection-types";

type Row = Record<string, unknown>;

export async function loadConnectionBoard(): Promise<ConnectionBoard> {
  await requireAdminSession();
  const setup = connectorSetup();
  const base = {
    ingest: { enabled: ingestEnabled(), keyTooShort: ingestKeyTooShort(), path: "/api/metrics/ingest" },
    dripify: { configured: Boolean(process.env.DRIPIFY_API_KEY?.trim()) },
  };
  let runs: Row = {};
  let status: ConnectionBoard["status"] = "available";
  try {
    const { data, error } = await withinDeadline(createSupabaseAdminClient().rpc("load_analytics_connector_status"), Date.now() + 8_000);
    if (error) throw error;
    runs = data && typeof data === "object" && !Array.isArray(data) ? data as Row : {};
  } catch {
    // Settings still show; only the run history is missing until the migration is applied.
    status = "unavailable";
  }
  return {
    status,
    ...base,
    connectors: setup.map((connector) => {
      const run = runs[connector.id] && typeof runs[connector.id] === "object" ? runs[connector.id] as Row : {};
      const lastStatus = typeof run.last_status === "string" ? run.last_status as ConnectorStatus : null;
      const lastReason = typeof run.last_reason === "string" ? run.last_reason as ConnectorReason : null;
      const lastRunAt = typeof run.last_run_at === "string" ? run.last_run_at : null;
      return {
        id: connector.id,
        label: connector.label,
        configured: connector.configured,
        level: connector.level,
        settings: connector.settings,
        optional: connector.optional,
        lastRunAt,
        lastSyncedAt: typeof run.last_synced_at === "string" ? run.last_synced_at : null,
        lastOutcome: lastStatus && lastRunAt && isConnectorId(connector.id)
          ? connectorMessage({ connector: connector.id, status: lastStatus, reason: lastReason, date: lastRunAt.slice(0, 10), valuesWritten: 0, details: {} })
          : null,
      };
    }),
  };
}
