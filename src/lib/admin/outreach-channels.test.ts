import { describe, expect, it } from "vitest";
import { OUTREACH_CHANNELS, outreachChannelQueries, outreachReplySourceQueries, outreachReplySources, summarizeOutreachChannels } from "@/lib/admin/outreach-channels";
import { SAMPLE_DEFINITIONS, sampleDashboardData, sampleMetricCatalog, sampleMetricSeries } from "@/lib/admin/sample-data";
import type { MetricCatalog, MetricDefinition, MetricSeriesResult } from "@/lib/admin/metric-types";

const TODAY = "2026-10-18";

const definition = (key: string, entryMode: MetricDefinition["entryMode"], lastDate: string | null): MetricDefinition => ({
  key, source: key.slice(0, key.indexOf(".")), category: "outreach", label: key, description: "", unit: "count", aggregation: "sum",
  numeratorKey: null, denominatorKey: null, entryMode, higherIsBetter: true, chartable: true, firstDate: lastDate, lastDate, dimensions: [],
});

/** Every source number logged or synced yesterday, unless overridden. */
const catalog = (lastDates: Record<string, string | null> = {}, extra: Partial<MetricCatalog> = {}): MetricCatalog => ({
  status: "available",
  today: TODAY,
  metrics: [
    ...["dripify.new_contacted", "dripify.new_replies"].map((key) => definition(key, "connector", lastDates[key] === undefined ? "2026-10-17" : lastDates[key])),
    ...["dripify.calls_booked", "reddit.dms_sent", "reddit.dm_replies", "reddit.dm_calls_booked", "cold_calls.dials", "cold_calls.positive_replies", "cold_calls.meetings_booked"]
      .map((key) => definition(key, "manual", lastDates[key] === undefined ? "2026-10-17" : lastDates[key])),
  ],
  recentEntries: [],
  dimensionLabels: {},
  connectors: { dripify: true },
  ...extra,
});

/** What load_analytics_series returns for one channel: derived outreach counts, never null. */
const result = (dimension: string, counts: { touches: number; replies: number; reached: number; calls: number }): MetricSeriesResult => ({
  grain: "day", from: "2026-09-19", to: TODAY, previousFrom: "2026-08-20", previousTo: "2026-09-18", today: TODAY, dimension, buckets: [],
  series: ([["outreach.touches", counts.touches], ["outreach.replies", counts.replies], ["outreach.reply_base", counts.reached], ["outreach.calls_booked", counts.calls]] as const).map(([metricKey, current]) => ({
    metricKey, values: [], numerators: null, denominators: null, current, previous: null,
    currentNumerator: null, currentDenominator: null, previousNumerator: null, previousDenominator: null, coverageFrom: null,
  })),
});

const results = () => [
  result("linkedin/dripify", { touches: 300, replies: 12, reached: 300, calls: 2 }),
  result("reddit/dm", { touches: 40, replies: 6, reached: 40, calls: 1 }),
  result("phone/cold_call", { touches: 60, replies: 0, reached: 60, calls: 0 }),
];

describe("outreach channel queries", () => {
  it("asks for each channel's last 30 UTC days, today included, by its Channel-filter key", () => {
    const queries = outreachChannelQueries(TODAY);
    expect(queries.map((query) => query.dimension)).toEqual(["linkedin/dripify", "reddit/dm", "phone/cold_call"]);
    queries.forEach((query) => {
      expect(query).toMatchObject({ grain: "day", from: "2026-09-19", to: TODAY });
      expect(query.metrics).toEqual(["outreach.touches", "outreach.replies", "outreach.reply_base", "outreach.calls_booked"]);
    });
  });

  it("asks for each channel's replies over the chart's 90 days", () => {
    const queries = outreachReplySourceQueries(TODAY);
    expect(queries.map((query) => query.dimension)).toEqual(["linkedin/dripify", "reddit/dm", "phone/cold_call"]);
    queries.forEach((query) => expect(query).toMatchObject({ metrics: ["outreach.replies"], grain: "day", from: "2026-07-21", to: TODAY }));
  });

  it("names the three channels and their Log numbers sources", () => {
    expect(OUTREACH_CHANNELS.map((channel) => [channel.id, channel.label])).toEqual([["dripify", "Dripify"], ["reddit", "Reddit DMs"], ["cold_calls", "Cold calls"]]);
    // Only a positive cold-call answer is a reply.
    expect(OUTREACH_CHANNELS[2].sources.replies).toBe("cold_calls.positive_replies");
  });
});

describe("outreach channel summary", () => {
  it("shows each channel's counts and adds the three up", () => {
    const board = summarizeOutreachChannels(results(), catalog(), TODAY);
    expect(board.status).toBe("available");
    expect(board).toMatchObject({ from: "2026-09-19", to: TODAY, dripifyConnected: true });
    expect(board.channels.map((channel) => [channel.id, channel.touches, channel.replies, channel.callsBooked])).toEqual([
      ["dripify", 300, 12, 2], ["reddit", 40, 6, 1], ["cold_calls", 60, 0, 0],
    ]);
    expect(board.channels[0].replyRate).toBeCloseTo(0.04);
    // A logged 0 is a real 0, so the rate is a real 0%.
    expect(board.channels[2].replyRate).toBe(0);
    expect(board.total).toEqual({ touches: 400, replies: 18, reached: 400, replyRate: 18 / 400, callsBooked: 3 });
  });

  it("never shows a number that wasn't logged in the window as zero", () => {
    // Reddit calls never logged, cold calls last logged 40 days ago, Dripify replies never synced.
    const board = summarizeOutreachChannels(results(), catalog({ "reddit.dm_calls_booked": null, "cold_calls.dials": "2026-09-08", "cold_calls.positive_replies": "2026-09-08", "cold_calls.meetings_booked": "2026-09-08", "dripify.new_replies": null }), TODAY);
    const [dripify, reddit, calls] = board.channels;
    expect(dripify).toMatchObject({ touches: 300, replies: null, replyRate: null, callsBooked: 2 });
    expect(reddit).toMatchObject({ touches: 40, replies: 6, callsBooked: null });
    expect(calls).toMatchObject({ touches: null, replies: null, reached: null, replyRate: null, callsBooked: null, lastDate: "2026-09-08" });
    // The total adds up what is known, like Outreach does.
    expect(board.total).toMatchObject({ touches: 340, replies: 6, reached: 340, callsBooked: 2 });
  });

  it("reads cold calls logged with the positive and meetings boxes blank as none, but not Reddit DMs with replies blank", () => {
    const board = summarizeOutreachChannels(results(), catalog({ "cold_calls.positive_replies": null, "cold_calls.meetings_booked": null, "reddit.dm_replies": null }), TODAY);
    const [, reddit, calls] = board.channels;
    // A call's outcome is known when it ends; a DM's replies come in later.
    expect(calls).toMatchObject({ touches: 60, replies: 0, reached: 60, replyRate: 0, callsBooked: 0 });
    expect(reddit).toMatchObject({ touches: 40, replies: null, replyRate: null });
    // Without calls logged in the window, cold-call outcomes stay unknown.
    const none = summarizeOutreachChannels(results(), catalog({ "cold_calls.dials": null, "cold_calls.positive_replies": null, "cold_calls.meetings_booked": null }), TODAY);
    expect(none.channels[2]).toMatchObject({ touches: null, replies: null, callsBooked: null });
  });

  it("counts a day logged on the window's first day, and not the day before", () => {
    const inside = summarizeOutreachChannels(results(), catalog({ "reddit.dms_sent": "2026-09-19" }), TODAY);
    const outside = summarizeOutreachChannels(results(), catalog({ "reddit.dms_sent": "2026-09-18" }), TODAY);
    expect(inside.channels[1].touches).toBe(40);
    expect(outside.channels[1].touches).toBeNull();
  });

  it("leaves the total unknown when no channel has the number", () => {
    // No calls logged either: calls logged would make cold-call bookings a known 0.
    const board = summarizeOutreachChannels(results(), catalog({ "dripify.calls_booked": null, "reddit.dm_calls_booked": null, "cold_calls.meetings_booked": null, "cold_calls.dials": null }), TODAY);
    expect(board.total.callsBooked).toBeNull();
    expect(board.total.touches).toBe(340);
  });

  it("gives no rate when nobody was reached", () => {
    const board = summarizeOutreachChannels([result("reddit/dm", { touches: 0, replies: 0, reached: 0, calls: 0 })], catalog(), TODAY);
    expect(board.channels[1]).toMatchObject({ touches: 0, reached: 0, replyRate: null });
  });

  it("reports the channels unavailable when the series or the catalog could not load", () => {
    const noSeries = summarizeOutreachChannels(null, catalog(), TODAY);
    expect(noSeries.status).toBe("unavailable");
    expect(noSeries.channels.every((channel) => channel.touches === null && channel.replies === null && channel.callsBooked === null)).toBe(true);
    expect(noSeries.total.touches).toBeNull();
    expect(summarizeOutreachChannels(results(), catalog({}, { status: "unavailable", metrics: [] }), TODAY).status).toBe("unavailable");
  });

  it("knows which channels have a Log numbers tab and when each was last logged or synced", () => {
    const withoutDripifyTab = catalog();
    withoutDripifyTab.metrics = withoutDripifyTab.metrics.filter((metric) => metric.key !== "dripify.calls_booked");
    const board = summarizeOutreachChannels(results(), withoutDripifyTab, TODAY);
    expect(board.channels.map((channel) => [channel.id, channel.loggable])).toEqual([["dripify", false], ["reddit", true], ["cold_calls", true]]);
    const dates = summarizeOutreachChannels(results(), catalog({ "dripify.calls_booked": TODAY, "reddit.dms_sent": "2026-10-12", "reddit.dm_replies": "2026-10-14", "reddit.dm_calls_booked": null }), TODAY);
    // Dripify: the last sync, not the day its calls were logged.
    expect(dates.channels.map((channel) => [channel.id, channel.synced, channel.lastDate])).toEqual([["dripify", true, "2026-10-17"], ["reddit", false, "2026-10-14"], ["cold_calls", false, "2026-10-17"]]);
    expect(summarizeOutreachChannels(results(), catalog({}, { connectors: { dripify: false } }), TODAY).dripifyConnected).toBe(false);
  });

  it("splits each day's replies by channel for the activity chart", () => {
    const daily = (dimension: string, replies: Array<number | null>): MetricSeriesResult => ({
      ...result(dimension, { touches: 0, replies: 0, reached: 0, calls: 0 }),
      buckets: ["2026-10-16", "2026-10-17", "2026-10-18"].map((start) => ({ start, end: start, partial: start === TODAY })),
      series: [{ ...result(dimension, { touches: 0, replies: 0, reached: 0, calls: 0 }).series[1], values: replies }],
    });
    const sources = outreachReplySources([daily("linkedin/dripify", [0, 1, 0]), daily("reddit/dm", [2, 0, null]), daily("phone/cold_call", [0, 0, 1])]);
    expect(sources).toEqual({
      "2026-10-16": { dripify: 0, reddit: 2, cold_calls: 0 },
      "2026-10-17": { dripify: 1, reddit: 0, cold_calls: 0 },
      "2026-10-18": { dripify: 0, reddit: 0, cold_calls: 1 },
    });
    // A missing channel would pin its replies on the others, so the chart shows replies unsplit.
    expect(outreachReplySources([daily("linkedin/dripify", [0, 1, 0]), daily("reddit/dm", [2, 0, 0])])).toBeNull();
    expect(outreachReplySources(null)).toBeNull();
  });

  it("splits sample replies so each day adds up to the chart's total", () => {
    const sources = outreachReplySources(outreachReplySourceQueries(TODAY).map((query) => sampleMetricSeries(query, SAMPLE_DEFINITIONS, TODAY)));
    const trend = sampleDashboardData({}, new Date(`${TODAY}T12:00:00Z`)).trend;
    expect(sources).not.toBeNull();
    expect(Object.keys(sources!)).toEqual(trend.map((point) => point.date));
    trend.forEach((point) => {
      const day = sources![point.date];
      expect(day.dripify + day.reddit + day.cold_calls, point.date).toBe(point.replies);
    });
    expect(trend.some((point) => point.replies > 0)).toBe(true);
  });

  it("works from sample data the way it does from the database", () => {
    const sampleCatalog = sampleMetricCatalog(SAMPLE_DEFINITIONS, TODAY);
    const board = summarizeOutreachChannels(outreachChannelQueries(TODAY).map((query) => sampleMetricSeries(query, SAMPLE_DEFINITIONS, TODAY)), sampleCatalog, TODAY);
    expect(board.status).toBe("available");
    for (const channel of board.channels) {
      expect(channel.touches, channel.id).toBeGreaterThan(0);
      expect(channel.replies, channel.id).not.toBeNull();
    }
    expect(board.total.touches).toBe(board.channels.reduce((sum, channel) => sum + (channel.touches ?? 0), 0));
  });
});
