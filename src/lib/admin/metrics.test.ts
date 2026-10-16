import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/session", () => ({ requireAdminSession: mocks.authorize }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

import { loadMetricCatalog, shapeMetricCatalog, shapeMetricSeries } from "@/lib/admin/metrics";

describe("metric catalog", () => {
  it("shapes definitions, coverage and recent entries", () => {
    const catalog = shapeMetricCatalog({
      today: "2026-10-16",
      metrics: [{
        metric_key: "youtube.subscribers", source: "youtube", category: "content", label: "YouTube subscribers",
        description: "Channel subscribers", unit: "count", aggregation: "last", entry_mode: "manual",
        higher_is_better: true, chartable: true, first_date: "2026-01-01", last_date: "2026-10-15", dimensions: ["@second"],
      }],
      recent_entries: [{ metric_key: "youtube.subscribers", metric_date: "2026-10-15", dimension_key: "", value: "1250.0000", recorded_at: "2026-10-16T01:00:00Z" }],
    });
    expect(catalog.status).toBe("available");
    expect(catalog.metrics[0]).toMatchObject({ key: "youtube.subscribers", aggregation: "last", entryMode: "manual", dimensions: ["@second"] });
    expect(catalog.recentEntries[0].value).toBe(1250);
  });

  it("authorizes, then reports an unavailable catalog instead of an empty healthy one", async () => {
    mocks.authorize.mockResolvedValue("user_admin");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const catalog = await loadMetricCatalog();
    expect(mocks.authorize).toHaveBeenCalled();
    expect(catalog.status).toBe("unavailable");
    expect(catalog.metrics).toEqual([]);
  });

  it("never queries the catalog for an unauthorized visitor", async () => {
    mocks.rpc.mockClear();
    mocks.authorize.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(loadMetricCatalog()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("metric series", () => {
  it("keeps one value per bucket and preserves unknown values as null", () => {
    const series = shapeMetricSeries({
      grain: "month", from: "2026-08-01", to: "2026-10-16", previous_from: "2026-05-17", previous_to: "2026-07-31", today: "2026-10-16", dimension: null,
      buckets: [
        { start: "2026-08-01", end: "2026-08-31", partial: false },
        { start: "2026-09-01", end: "2026-09-30", partial: false },
        { start: "2026-10-01", end: "2026-10-16", partial: true },
      ],
      series: [{
        metric_key: "sales.close_rate", values: [null, 0.25], numerators: [null, 2], denominators: [null, 8],
        current: 0.25, previous: null, current_numerator: 2, current_denominator: 8,
      }],
    });
    expect(series.series[0].values).toEqual([null, 0.25, null]);
    expect(series.series[0].denominators).toEqual([null, 8, null]);
    expect(series.buckets[2].partial).toBe(true);
    expect(series.series[0].previous).toBeNull();
  });

  it("rejects incomplete payloads", () => {
    expect(() => shapeMetricSeries({ grain: "week" })).toThrow("metric_series_incomplete");
    expect(() => shapeMetricCatalog({ metrics: [] })).toThrow("metric_catalog_incomplete");
  });
});
