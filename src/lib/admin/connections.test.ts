import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("tests must never reach the database"); } }));
vi.mock("@/lib/admin/session", () => ({ requireAdminSession: vi.fn() }));

import { LOW_LEADS, summarizeDripify } from "@/lib/admin/connections";

const row = (metric_key: string, dimension_key: string, metric_date: string, value: unknown, label: string | null = null) =>
  ({ metric_key, dimension_key, metric_date, value, label });

describe("Dripify summary", () => {
  it("is empty before the first sync", () => {
    expect(summarizeDripify(true, [])).toEqual({ status: "available", configured: true, lastSyncedOn: null, unreadMessages: null, activeCampaigns: null, lowCampaigns: [] });
  });

  it("adds up teams, flags only campaigns still sending, and ignores stale campaigns", () => {
    const summary = summarizeDripify(true, [
      row("dripify.unread_messages", "dripify-team:5", "2026-10-16", 3, "Sales"),
      row("dripify.unread_messages", "dripify-team:6", "2026-10-16", "2", "Agency"),
      row("dripify.active_campaigns", "dripify-team:5", "2026-10-16", 2),
      // Sending and nearly out of fresh leads.
      row("dripify.leads_remaining", "dripify:10", "2026-10-16", 12, "Insurance owners TX"),
      row("dripify.leads_in_progress", "dripify:10", "2026-10-16", 80),
      // No label saved yet: falls back to the ID.
      row("dripify.leads_remaining", "dripify:11", "2026-10-16", 0),
      row("dripify.leads_in_progress", "dripify:11", "2026-10-16", 4),
      // Finished campaign: nothing in progress, so 0 left is expected, not a warning.
      row("dripify.leads_remaining", "dripify:12", "2026-10-16", 0, "Done"),
      row("dripify.leads_in_progress", "dripify:12", "2026-10-16", 0),
      // Plenty left.
      row("dripify.leads_remaining", "dripify:13", "2026-10-16", LOW_LEADS, "Fine"),
      row("dripify.leads_in_progress", "dripify:13", "2026-10-16", 9),
      // Last synced long before the newest sync: a deleted campaign, ignored.
      row("dripify.leads_remaining", "dripify:14", "2026-09-01", 1, "Deleted"),
      row("dripify.leads_in_progress", "dripify:14", "2026-09-01", 9),
      row("dripify.unread_messages", "dripify-team:9", "2026-09-01", 50),
      // Malformed rows are skipped.
      row("dripify.unread_messages", "dripify-team:7", "2026-10-16", "lots"),
    ]);
    expect(summary).toEqual({
      status: "available",
      configured: true,
      lastSyncedOn: "2026-10-16",
      unreadMessages: 5,
      activeCampaigns: 2,
      lowCampaigns: [{ dimension: "dripify:11", label: "Campaign 11", remaining: 0 }, { dimension: "dripify:10", label: "Insurance owners TX", remaining: 12 }],
    });
  });

  it("dates the latest sync from the original counts, so syncs before the newer metrics still count", () => {
    expect(summarizeDripify(true, [row("dripify.leads_contacted", "dripify:10", "2026-10-16", 694, "TX")])).toMatchObject({ lastSyncedOn: "2026-10-16", unreadMessages: null, lowCampaigns: [] });
  });
});
