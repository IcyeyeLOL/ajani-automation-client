import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSampleMode: vi.fn(),
  loadAdminDashboardData: vi.fn(),
  loadMetricCatalog: vi.fn(),
  loadGoalBoard: vi.fn(),
  loadConnectionBoard: vi.fn(),
  loadOutreachChannelSeries: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/admin-dashboard", () => ({ AdminDashboard: () => null }));
vi.mock("@/lib/admin/sample-mode", () => ({ isSampleMode: mocks.isSampleMode }));
vi.mock("@/lib/admin/dashboard", () => ({ adminPageNumber: () => 1, loadAdminDashboardData: mocks.loadAdminDashboardData, loadOutreachChannelSeries: mocks.loadOutreachChannelSeries }));
vi.mock("@/lib/admin/metrics", () => ({ loadGoalBoard: mocks.loadGoalBoard, loadMetricCatalog: mocks.loadMetricCatalog }));
vi.mock("@/lib/admin/connections", () => ({ loadConnectionBoard: mocks.loadConnectionBoard }));

import AdminDashboardPage from "@/app/admin/(dashboard)/page";
import { SAMPLE_DEFINITIONS } from "@/lib/admin/sample-data";
import type { OutreachChannelBoard } from "@/lib/admin/types";

const connections = { status: "available", connectors: [], dripify: { configured: true }, ingest: { enabled: false } };
const realCatalog = {
  status: "available",
  metrics: SAMPLE_DEFINITIONS,
  firstDate: "2025-01-01",
  lastDate: "2026-10-15",
  dimensions: [{ metricKey: "linkedin.followers", dimension: "@real-handle" }],
  dimensionLabels: { "dripify:99": "Real campaign name" },
  recentEntries: [{ metricKey: "linkedin.followers", date: "2026-10-15", dimension: "@real-handle", value: 987_654_321 }],
  connectors: { dripify: true },
};

async function render() {
  const element = await AdminDashboardPage({ searchParams: Promise.resolve({}) });
  return element.props as Record<string, unknown>;
}

describe("control desk page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadMetricCatalog.mockResolvedValue(realCatalog);
    mocks.loadConnectionBoard.mockResolvedValue(connections);
    mocks.loadAdminDashboardData.mockResolvedValue({ generatedAt: "real" });
    mocks.loadGoalBoard.mockResolvedValue({ status: "real" });
    mocks.loadOutreachChannelSeries.mockResolvedValue(null);
  });

  it("renders sample data without reading real numbers, goals or logged entries", async () => {
    mocks.isSampleMode.mockResolvedValue(true);
    const props = await render();

    expect(props.sampleMode).toBe(true);
    expect(mocks.loadAdminDashboardData).not.toHaveBeenCalled();
    expect(mocks.loadGoalBoard).not.toHaveBeenCalled();
    // Connections always shows the real setup.
    expect(props.connections).toBe(connections);
    // The catalog keeps the real definitions but none of the real entries, accounts or labels.
    const catalog = JSON.stringify(props.catalog);
    expect(catalog).not.toContain("@real-handle");
    expect(catalog).not.toContain("Real campaign name");
    expect(catalog).not.toContain("987654321");
    expect((props.data as { generatedAt: string }).generatedAt).not.toBe("real");
    // Outreach channels come from the sample series, never the database.
    expect(mocks.loadOutreachChannelSeries).not.toHaveBeenCalled();
    const channels = props.channels as OutreachChannelBoard;
    expect(channels.status).toBe("available");
    expect(channels.channels.map((channel) => channel.id)).toEqual(["dripify", "reddit", "cold_calls"]);
    expect(channels.total.touches).toBeGreaterThan(0);
  });

  it("renders real numbers when sample data is off", async () => {
    mocks.isSampleMode.mockResolvedValue(false);
    const props = await render();

    expect(props.sampleMode).toBeUndefined();
    expect(props.data).toEqual({ generatedAt: "real" });
    expect(props.goals).toEqual({ status: "real" });
    expect(props.catalog).toBe(realCatalog);
    expect(props.connections).toBe(connections);
    // Today's last 30 days, loaded alongside the rest; a failed load is "unavailable", not zeros.
    expect(mocks.loadOutreachChannelSeries).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect((props.channels as OutreachChannelBoard).status).toBe("unavailable");
  });
});
