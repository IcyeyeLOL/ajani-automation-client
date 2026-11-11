"use client";

import { formatMetricValue } from "@/lib/admin/metric-query";
import type { OutreachChannelBoard, OutreachChannelId, OutreachChannelSummary } from "@/lib/admin/types";

type ChannelNumbers = Pick<OutreachChannelSummary, "touches" | "replies" | "reached" | "replyRate" | "callsBooked">;

const touchLabels: Record<OutreachChannelId, string> = { dripify: "Leads contacted", reddit: "DMs sent", cold_calls: "Calls made" };
const channelNotes: Record<OutreachChannelId, string> = { dripify: "LinkedIn, synced every night", reddit: "Logged by you", cold_calls: "Only a positive answer counts as a reply" };
// The channels typed in most often come first.
const logButtons: Array<[OutreachChannelId, string]> = [["cold_calls", "LOG COLD CALLS"], ["reddit", "LOG REDDIT DMS"], ["dripify", "LOG DRIPIFY REPLIES & CALLS"]];

/** Each channel's last 30 days, then the three added up. "—" is nothing logged (or synced) yet, never zero. */
export function OutreachChannels({ board, onCharts }: { board: OutreachChannelBoard; onCharts: () => void }) {
  const dripifyGap = board.dripifyConnected ? "Not synced" : "Not connected";
  return <article className="admin-panel admin-channel-panel">
    <header className="admin-panel-head"><div><p>OUTREACH BY CHANNEL</p><h2>Where your outreach came from.</h2></div><span>LAST 30 DAYS</span></header>
    {board.status === "available" ? <div className="admin-channel-grid">
      {board.channels.map((channel) => {
        const { synced } = channel;
        const foot = synced && !board.dripifyConnected && !channel.lastDate ? "Dripify isn't connected yet" : channel.lastDate ? `Last ${synced ? "synced" : "logged"} ${shortDate(channel.lastDate)}` : `Nothing ${synced ? "synced" : "logged"} yet`;
        return <ChannelCard foot={foot} gaps={{ touches: synced ? dripifyGap : "Not logged", replies: synced ? dripifyGap : "Not logged", callsBooked: "Not logged" }} key={channel.id} note={channelNotes[channel.id]} numbers={channel} title={channel.label} touchLabel={touchLabels[channel.id]} />;
      })}
      <ChannelCard gaps={{ touches: "Not logged", replies: "Not logged", callsBooked: "Not logged" }} note="The Outreach total" numbers={board.total} title="All three" total touchLabel="Touches" />
    </div> : <p className="admin-channel-unavailable" role="status">Channel numbers couldn&apos;t load just now. Refresh to try again. Nothing is shown as zero meanwhile.</p>}
    <footer className="admin-chart-note admin-channel-foot"><span>“—” means nothing was logged in these 30 days, not zero.</span><button className="admin-trend-link" onClick={onCharts} type="button">See every outreach chart in Trends</button></footer>
  </article>;
}

function ChannelCard({ title, note, touchLabel, numbers, gaps, foot, total = false }: { title: string; note: string; touchLabel: string; numbers: ChannelNumbers; gaps: Record<"touches" | "replies" | "callsBooked", string>; foot?: string; total?: boolean }) {
  const count = (value: number | null) => formatMetricValue(value, "count");
  const rows: Array<[string, string, string | null]> = [
    [touchLabel, count(numbers.touches), numbers.touches === null ? gaps.touches : null],
    ["Replies", count(numbers.replies), numbers.replies === null ? gaps.replies : null],
    // A rate says what it is measured against; with no one reached there is no rate.
    ["Reply rate", formatMetricValue(numbers.replyRate, "ratio"), numbers.replyRate !== null && numbers.reached !== null ? `of ${count(numbers.reached)} reached` : numbers.reached === 0 ? "No one reached" : null],
    ["Calls booked", count(numbers.callsBooked), numbers.callsBooked === null ? gaps.callsBooked : null],
  ];
  return <section aria-label={`${title}, last 30 days`} className={`admin-channel-card${total ? " total" : ""}`}>
    <header><h3>{title}</h3><small>{note}</small></header>
    <dl>{rows.map(([label, value, detail]) => <div key={label}><dt>{label}</dt><dd><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</dd></div>)}</dl>
    {foot ? <footer>{foot}</footer> : null}
  </section>;
}

/** Dripify syncs on its own; the rest of Outreach is typed into Log numbers, each channel on its own tab. */
export function LogOutreachPanel({ board, onLog }: { board: OutreachChannelBoard; onLog: (sources: string[] | null) => void }) {
  const tabs = logButtons.filter(([id]) => board.channels.some((channel) => channel.id === id && channel.loggable));
  return <article className="admin-action-panel">
    <p>QUICK ACTION</p><h2>Log today&apos;s outreach.</h2>
    <span>Dripify syncs its sends and replies every night. Type in your cold calls and Reddit DMs, plus the positive replies and calls booked from Dripify conversations.</span>
    <div className="admin-action-buttons">{tabs.length ? tabs.map(([id, label]) => <button key={id} onClick={() => onLog([id])} type="button">{label} <b>→</b></button>) : <button onClick={() => onLog(null)} type="button">OPEN LOG NUMBERS <b>→</b></button>}</div>
  </article>;
}

function shortDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
