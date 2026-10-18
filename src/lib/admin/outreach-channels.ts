import { rangeForPreset } from "@/lib/admin/metric-query";
import type { MetricCatalog, MetricSeriesQuery, MetricSeriesResult } from "@/lib/admin/metric-types";
import type { OutreachChannelBoard, OutreachChannelId, OutreachChannelSummary } from "@/lib/admin/types";

/** Same window as the Overview cards: the last 30 UTC days, today included. */
export const OUTREACH_CHANNEL_DAYS = 30;

const CHANNEL_METRICS = ["outreach.touches", "outreach.replies", "outreach.reply_base", "outreach.calls_booked"];

/**
 * The three ways the owner reaches people, as Outreach's Channel filter names
 * them, with the logged or synced number behind each count. Outreach counts are
 * derived, so a channel with nothing logged reads 0 from the database; the
 * source number's newest day is what tells a real 0 from "not logged".
 */
export const OUTREACH_CHANNELS: ReadonlyArray<{ id: OutreachChannelId; label: string; dimension: string; synced: boolean; outcomesWithTouches: boolean; sources: { touches: string; replies: string; callsBooked: string } }> = [
  // Dripify's sends and replies come from the nightly sync; its calls booked are logged.
  { id: "dripify", label: "Dripify", dimension: "linkedin/dripify", synced: true, outcomesWithTouches: false, sources: { touches: "dripify.new_contacted", replies: "dripify.new_replies", callsBooked: "dripify.calls_booked" } },
  { id: "reddit", label: "Reddit DMs", dimension: "reddit/dm", synced: false, outcomesWithTouches: false, sources: { touches: "reddit.dms_sent", replies: "reddit.dm_replies", callsBooked: "reddit.dm_calls_booked" } },
  // Only a positive answer counts as a cold-call reply. A call's outcome is known when it
  // ends, so calls logged with the positive or meetings box left blank mean none.
  { id: "cold_calls", label: "Cold calls", dimension: "phone/cold_call", synced: false, outcomesWithTouches: true, sources: { touches: "cold_calls.dials", replies: "cold_calls.positive_replies", callsBooked: "cold_calls.meetings_booked" } },
];

/** One series query per channel; the loader runs them in parallel. */
export function outreachChannelQueries(today: string): MetricSeriesQuery[] {
  const { from, to } = rangeForPreset("day", OUTREACH_CHANNEL_DAYS, today);
  return OUTREACH_CHANNELS.map((channel) => ({ metrics: CHANNEL_METRICS, grain: "day", from, to, dimension: channel.dimension }));
}

/**
 * Each channel's last 30 days and the three added up. A count stays null
 * (shown as "—") unless its source number was logged or synced in the window;
 * the total adds up what is known, like Outreach does, and is null only when
 * no channel has the number. `results` null means the series could not load.
 */
export function summarizeOutreachChannels(results: MetricSeriesResult[] | null, catalog: Pick<MetricCatalog, "status" | "metrics" | "connectors">, today: string): OutreachChannelBoard {
  const { from, to } = rangeForPreset("day", OUTREACH_CHANNEL_DAYS, today);
  const lastDates = new Map(catalog.metrics.map((metric) => [metric.key, metric.lastDate]));
  const channels = OUTREACH_CHANNELS.map((channel): OutreachChannelSummary => {
    const result = results?.find((item) => item.dimension === channel.dimension) ?? null;
    const logged = (sourceKey: string) => {
      const last = lastDates.get(sourceKey);
      return Boolean(last && last >= from);
    };
    const counted = (metricKey: string, sourceKey: string) => logged(sourceKey) || (channel.outcomesWithTouches && sourceKey !== channel.sources.touches && logged(channel.sources.touches))
      ? result?.series.find((item) => item.metricKey === metricKey)?.current ?? null
      : null;
    const touches = counted("outreach.touches", channel.sources.touches);
    const reached = counted("outreach.reply_base", channel.sources.touches);
    const replies = counted("outreach.replies", channel.sources.replies);
    return {
      id: channel.id,
      label: channel.label,
      dimension: channel.dimension,
      synced: channel.synced,
      touches,
      replies,
      reached,
      replyRate: rate(replies, reached),
      callsBooked: counted("outreach.calls_booked", channel.sources.callsBooked),
      // A synced channel's last sync; otherwise the newest day anything was logged.
      lastDate: (channel.synced ? [channel.sources.touches] : Object.values(channel.sources)).reduce<string | null>((latest, key) => {
        const last = lastDates.get(key) ?? null;
        return last && (!latest || last > latest) ? last : latest;
      }, null),
      // The Log numbers tab shows only once the catalog has a manual number for it.
      loggable: catalog.metrics.some((metric) => metric.entryMode === "manual" && metric.source === channel.id),
    };
  });
  const sum = (pick: (channel: OutreachChannelSummary) => number | null) => channels.reduce<number | null>((total, channel) => {
    const value = pick(channel);
    return value === null ? total : (total ?? 0) + value;
  }, null);
  const replies = sum((channel) => channel.replies);
  const reached = sum((channel) => channel.reached);
  return {
    status: results && catalog.status === "available" ? "available" : "unavailable",
    from,
    to,
    channels,
    total: { touches: sum((channel) => channel.touches), replies, reached, replyRate: rate(replies, reached), callsBooked: sum((channel) => channel.callsBooked) },
    dripifyConnected: catalog.connectors.dripify,
  };
}

function rate(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator ? numerator / denominator : null;
}
