import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/session", () => ({ resolveAdminSession: mocks.session }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));

import { GET } from "@/app/admin/analytics/series/route";

const url = "https://ajani.test/admin/analytics/series?metrics=youtube.views,outreach.reply_rate&grain=week&from=2026-09-07&to=2026-10-16";

describe("admin metric series route", () => {
  beforeEach(() => {
    mocks.session.mockReset();
    mocks.rpc.mockReset();
  });

  it("requires an admin session before touching the database", async () => {
    mocks.session.mockResolvedValue({ status: "unauthorized" });
    const response = await GET(new Request(url));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.session.mockResolvedValue({ status: "forbidden" });
    expect((await GET(new Request(url))).status).toBe(404);
  });

  it("rejects malformed queries without calling the database", async () => {
    mocks.session.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    const response = await GET(new Request("https://ajani.test/admin/analytics/series?metrics=DROP%20TABLE&grain=week&from=2026-09-07&to=2026-10-16"));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns shaped, uncached series for a valid query", async () => {
    mocks.session.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.rpc.mockResolvedValue({
      error: null,
      data: {
        grain: "week", from: "2026-09-07", to: "2026-10-16", previous_from: "2026-07-28", previous_to: "2026-09-06", today: "2026-10-16", dimension: null,
        buckets: [{ start: "2026-09-07", end: "2026-09-13", partial: false }, { start: "2026-10-12", end: "2026-10-16", partial: true }],
        series: [{ metric_key: "youtube.views", values: ["160.0000", null], current: 160, previous: null, numerators: null, denominators: null }],
      },
    });

    const response = await GET(new Request(url));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("load_analytics_series", {
      p_metric_keys: ["youtube.views", "outreach.reply_rate"],
      p_grain: "week",
      p_from: "2026-09-07",
      p_to: "2026-10-16",
      p_dimension: null,
    });
    expect(body.series[0]).toMatchObject({ metricKey: "youtube.views", values: [160, null], current: 160, previous: null });
    expect(body.buckets[1].partial).toBe(true);
  });

  it("separates caller mistakes from infrastructure failures", async () => {
    mocks.session.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Too many periods; choose a larger grain" } });
    const invalid = await GET(new Request(url));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("larger grain");

    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    expect((await GET(new Request(url))).status).toBe(503);
  });
});
