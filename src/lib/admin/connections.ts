import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/admin/session";
import { withinDeadline } from "@/lib/operations/deadline";
import { connectorMessage, connectorSetup, ingestEnabled, ingestKeyTooShort, isConnectorId } from "@/lib/connectors/registry";
import type { ConnectorReason, ConnectorStatus } from "@/lib/connectors/connector-store";
import type { ConnectionBoard, DripifySummary } from "@/lib/admin/connection-types";

type Row = Record<string, unknown>;

/** About two days of connection requests at Dripify's usual daily pace. */
export const LOW_LEADS = 40;
/** Campaigns not synced within this many days of the latest sync are treated as gone. */
const FRESH_DAYS = 7;
const DRIPIFY_KEYS = ["dripify.leads_remaining", "dripify.leads_in_progress", "dripify.unread_messages", "dripify.active_campaigns"];

export async function loadConnectionBoard(): Promise<ConnectionBoard> {
  await requireAdminSession();
  const setup = connectorSetup();
  const base = {
    ingest: { enabled: ingestEnabled(), keyTooShort: ingestKeyTooShort(), path: "/api/metrics/ingest" },
    dripify: await loadDripifySummary(Boolean(process.env.DRIPIFY_API_KEY?.trim())),
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

async function loadDripifySummary(configured: boolean): Promise<DripifySummary> {
  const empty: DripifySummary = { configured, lastSyncedOn: null, unreadMessages: null, activeCampaigns: null, lowCampaigns: [] };
  try {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await withinDeadline(createSupabaseAdminClient().rpc("load_analytics_latest_values", {
      p_keys: DRIPIFY_KEYS, p_before: tomorrow,
    }), Date.now() + 8_000);
    if (error) throw error;
    return summarizeDripify(configured, Array.isArray(data) ? data as Row[] : []);
  } catch {
    // Before the migration the card still shows whether Dripify is connected.
    return empty;
  }
}

/** Latest value per campaign or team, ignoring ones that stopped syncing a week before the newest. */
export function summarizeDripify(configured: boolean, rows: Row[]): DripifySummary {
  const valid = rows.flatMap((row) => {
    const value = Number(row.value);
    return typeof row.metric_key === "string" && typeof row.dimension_key === "string" && typeof row.metric_date === "string"
      && Number.isFinite(value) && value >= 0
      ? [{ key: row.metric_key, dimension: row.dimension_key, date: row.metric_date, value, label: typeof row.label === "string" ? row.label : "" }]
      : [];
  });
  const lastSyncedOn = valid.reduce<string | null>((latest, row) => (!latest || row.date > latest ? row.date : latest), null);
  if (!lastSyncedOn) return { configured, lastSyncedOn: null, unreadMessages: null, activeCampaigns: null, lowCampaigns: [] };
  const cutoff = new Date(Date.parse(`${lastSyncedOn}T00:00:00Z`) - FRESH_DAYS * 86_400_000).toISOString().slice(0, 10);
  const fresh = valid.filter((row) => row.date >= cutoff);
  const total = (key: string) => {
    const matching = fresh.filter((row) => row.key === key);
    return matching.length ? matching.reduce((sum, row) => sum + row.value, 0) : null;
  };
  const sending = new Set(fresh.filter((row) => row.key === "dripify.leads_in_progress" && row.value > 0).map((row) => row.dimension));
  const lowCampaigns = fresh
    .filter((row) => row.key === "dripify.leads_remaining" && row.value < LOW_LEADS && sending.has(row.dimension))
    .sort((a, b) => a.value - b.value)
    .map((row) => ({ label: row.label || `Campaign ${row.dimension.replace(/^dripify:/, "")}`, remaining: row.value }));
  return { configured, lastSyncedOn, unreadMessages: total("dripify.unread_messages"), activeCampaigns: total("dripify.active_campaigns"), lowCampaigns };
}
