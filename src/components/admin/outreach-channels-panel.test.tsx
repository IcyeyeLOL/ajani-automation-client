import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogOutreachPanel, OutreachChannels } from "@/components/admin/outreach-channels-panel";
import type { OutreachChannelBoard, OutreachChannelSummary } from "@/lib/admin/types";

const channel = (id: OutreachChannelSummary["id"], label: string, numbers: Partial<OutreachChannelSummary> = {}): OutreachChannelSummary => ({
  id, label, dimension: "", synced: id === "dripify", touches: 100, replies: 5, reached: 100, replyRate: 0.05, callsBooked: 1, lastDate: "2026-10-17", loggable: true, ...numbers,
});

const board = (overrides: Partial<OutreachChannelBoard> = {}): OutreachChannelBoard => ({
  status: "available",
  from: "2026-09-19",
  to: "2026-10-18",
  channels: [channel("dripify", "Dripify", { touches: 694, replies: 30, reached: 694, replyRate: 30 / 694, callsBooked: null }), channel("reddit", "Reddit DMs"), channel("cold_calls", "Cold calls", { touches: 0, replies: 0, reached: 0, replyRate: null, callsBooked: 0, lastDate: null })],
  total: { touches: 794, replies: 35, reached: 794, replyRate: 35 / 794, callsBooked: 1 },
  dripifyConnected: true,
  ...overrides,
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("OutreachChannels", () => {
  it("shows each channel's last 30 days in its own words, then the three added up", () => {
    const html = text(renderToStaticMarkup(<OutreachChannels board={board()} onCharts={() => {}} />));
    expect(html).toContain("Dripify LinkedIn, synced every night Leads contacted 694 Replies 30 Reply rate 4.3% of 694 reached");
    expect(html).toContain("Reddit DMs Logged by you DMs sent 100");
    expect(html).toContain("Cold calls Only a positive answer counts as a reply Calls made 0");
    expect(html).toContain("All three The Outreach total Touches 794 Replies 35 Reply rate 4.4% of 794 reached Calls booked 1");
    expect(html).toContain("Last synced Oct 17");
    expect(html).toContain("Nothing logged yet");
    expect(html).toContain("See every outreach chart in Trends");
  });

  it("shows a number that wasn't logged as a dash, never as zero", () => {
    const html = text(renderToStaticMarkup(<OutreachChannels board={board()} onCharts={() => {}} />));
    // Dripify's calls booked were never logged; cold calls really were 0.
    expect(html).toContain("Calls booked — Not logged");
    expect(html).toContain("Calls made 0 Replies 0 Reply rate — No one reached Calls booked 0");
  });

  it("says Dripify isn't synced or connected instead of showing zeros", () => {
    const unsynced = board({ channels: [channel("dripify", "Dripify", { touches: null, replies: null, reached: null, replyRate: null, callsBooked: null, lastDate: null })] });
    expect(text(renderToStaticMarkup(<OutreachChannels board={unsynced} onCharts={() => {}} />))).toContain("Leads contacted — Not synced Replies — Not synced Reply rate — Calls booked — Not logged Nothing synced yet");
    const html = text(renderToStaticMarkup(<OutreachChannels board={{ ...unsynced, dripifyConnected: false }} onCharts={() => {}} />));
    expect(html).toContain("Leads contacted — Not connected");
    expect(html).toContain("Dripify isn&#x27;t connected yet");
  });

  it("says so when the channels can't load, with no numbers at all", () => {
    const html = renderToStaticMarkup(<OutreachChannels board={board({ status: "unavailable" })} onCharts={() => {}} />);
    expect(html).toContain("Channel numbers couldn&#x27;t load just now");
    expect(html).not.toContain("admin-channel-card");
  });
});

describe("LogOutreachPanel", () => {
  it("offers one button per channel with a Log numbers tab, the most typed first", () => {
    const html = text(renderToStaticMarkup(<LogOutreachPanel board={board()} onLog={() => {}} />));
    expect(html).toContain("LOG COLD CALLS → LOG REDDIT DMS → LOG DRIPIFY REPLIES &amp; CALLS →");
    expect(html).not.toContain("BATCH");
  });

  it("leaves out a channel whose tab isn't there yet, and falls back to Log numbers itself", () => {
    const noDripifyTab = board({ channels: board().channels.map((item) => item.id === "dripify" ? { ...item, loggable: false } : item) });
    expect(text(renderToStaticMarkup(<LogOutreachPanel board={noDripifyTab} onLog={() => {}} />))).not.toContain("DRIPIFY REPLIES");
    const noTabs = board({ channels: board().channels.map((item) => ({ ...item, loggable: false })) });
    expect(text(renderToStaticMarkup(<LogOutreachPanel board={noTabs} onLog={() => {}} />))).toContain("OPEN LOG NUMBERS →");
  });
});
