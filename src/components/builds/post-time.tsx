"use client";

import { useSyncExternalStore } from "react";

const neverChanges = () => () => {};

/** The server renders the UTC date; the browser swaps in the viewer's own day and time. */
export function PostTime({ timestamp }: { timestamp: string }) {
  const label = useSyncExternalStore(neverChanges, () => postTimeLabel(timestamp, true), () => postTimeLabel(timestamp, false));
  return <time dateTime={timestamp}>{label}</time>;
}

export function postTimeLabel(timestamp: string, local: boolean, now = new Date()) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Recently";
  const timeZone = local ? undefined : "UTC";
  const dayKey = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(value);
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: dayKey(date).slice(0, 4) === dayKey(now).slice(0, 4) ? undefined : "numeric",
    timeZone,
  }).format(date);
  if (!local) return day;
  const yesterday = new Date(now.getTime() - 86_400_000);
  const relative = dayKey(date) === dayKey(now) ? "Today" : dayKey(date) === dayKey(yesterday) ? "Yesterday" : day;
  return `${relative}, ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}
