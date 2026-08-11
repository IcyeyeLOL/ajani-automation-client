import type { AutomationHealth, BuildRequestStatus } from "@/lib/domain/types";

export const activeSystems: Array<{
  name: string;
  health: AutomationHealth;
  metric: string;
  detail: string;
  lastRun: string;
}> = [
  { name: "After-hours lead handoff", health: "healthy", metric: "247", detail: "leads processed this month", lastRun: "Ran 4 min ago" },
  { name: "Client intake routing", health: "healthy", metric: "38", detail: "clean briefs delivered", lastRun: "Ran 19 min ago" },
  { name: "Returning client nudge", health: "warning", metric: "12", detail: "live opportunities this week", lastRun: "Needs one approval" },
];

export const buildHistory: Array<{
  title: string;
  status: BuildRequestStatus;
  updated: string;
  price: string;
}> = [
  { title: "After-hours lead handoff", status: "live", updated: "Updated today", price: "$3,800 build + $350/mo" },
  { title: "Returning client nudge", status: "in_review", updated: "Review ready", price: "$2,400 build" },
  { title: "Client intake routing", status: "in_progress", updated: "Build day 3", price: "$3,100 build" },
];
