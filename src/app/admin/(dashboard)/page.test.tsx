import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSampleMode: vi.fn(),
  loadAdminDashboardData: vi.fn(),
  loadMetricCatalog: vi.fn(),
  loadGoalBoard: vi.fn(),
  loadConnectionBoard: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/admin-dashboard", () => ({ AdminDashboard: () => null }));
vi.mock("@/lib/admin/sample-mode", () => ({ isSampleMode: mocks.isSampleMode }));
vi.mock("@/lib/admin/dashboard", () => ({ adminPageNumber: () => 1, loadAdminDashboardData: mocks.loadAdminDashboardData }));
vi.mock("@/lib/admin/metrics", () => ({ loadGoalBoard: mocks.loadGoalBoard, loadMetricCatalog: mocks.loadMetricCatalog }));
vi.mock("@/lib/admin/connections", () => ({ loadConnectionBoard: mocks.loadConnectionBoard }));

import AdminDashboardPage from "@/app/admin/(dashboard)/page";
import { SAMPLE_DEFINITIONS } from "@/lib/admin/sample-data";

const connections = { status: "available", connectors: [], dripify: { configured: true }, ingest: { enabled: false } };
const realCatalog = {
  status: "available",
  metrics: SAMPLE_DEFINITIONS,
  firstDate: "2025-01-01",
  lastDate: "2026-10-15",
  dimensions: [{ metricKey: "linkedin.followers", dimension: "@real-handle" }],
  dimensionLabels: { "dripify:99": "Real campaign name" },
  recentEntries: [{ metricKey: "linkedin.followers", date: "2026-10-15", dimension: "@real-handle", value: 987_654_321 }],
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
  });

  it("renders real numbers when sample data is off", async () => {
    mocks.isSampleMode.mockResolvedValue(false);
    const props = await render();

    expect(props.sampleMode).toBeUndefined();
    expect(props.data).toEqual({ generatedAt: "real" });
    expect(props.goals).toEqual({ status: "real" });
    expect(props.catalog).toBe(realCatalog);
    expect(props.connections).toBe(connections);
  });
});
