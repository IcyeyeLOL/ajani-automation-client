import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), sample: vi.fn(), catalog: vi.fn(), extract: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/session", () => ({ resolveAdminSession: mocks.session }));
vi.mock("@/lib/admin/sample-mode", () => ({ isSampleMode: mocks.sample }));
vi.mock("@/lib/admin/metrics", () => ({ loadMetricCatalog: mocks.catalog }));
vi.mock("@/lib/admin/report-import", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/admin/report-import")>(),
  extractReportValues: mocks.extract,
}));

import { POST } from "@/app/admin/reports/read/route";

const PDF = new TextEncoder().encode("%PDF-1.7\nreport");
const followers = { key: "instagram.followers", source: "instagram", category: "content", label: "Instagram followers", description: "", unit: "count", aggregation: "last", numeratorKey: null, denominatorKey: null, entryMode: "manual", higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions: [] };

function upload(fields: { platform?: string; file?: Blob | null; name?: string } = {}) {
  const body = new FormData();
  if (fields.platform !== undefined) body.set("platform", fields.platform);
  else body.set("platform", "instagram");
  if (fields.file !== null) body.set("file", fields.file ?? new Blob([PDF], { type: "application/pdf" }), fields.name ?? "report.pdf");
  return new Request("https://ajani.test/admin/reports/read", { method: "POST", body });
}

describe("report read route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.sample.mockResolvedValue(false);
    mocks.catalog.mockResolvedValue({ status: "available", today: "2026-10-17", metrics: [followers], recentEntries: [], dimensionLabels: {}, connectors: { dripify: false } });
    mocks.extract.mockResolvedValue({
      status: "ok", reportDate: "2026-10-17", provider: "anthropic", model: "claude-opus-5-5",
      rows: [{ metricKey: "instagram.followers", date: "2026-10-17", value: 73, evidence: "73 followers" }],
      notUsed: [{ item: "Views, last 30 days", reason: "A 30-day total" }], dropped: [],
    });
  });

  it("needs an admin session and real data before reading anything", async () => {
    mocks.session.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await POST(upload())).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ status: "forbidden" });
    expect((await POST(upload())).status).toBe(404);
    mocks.sample.mockResolvedValueOnce(true);
    expect((await POST(upload())).status).toBe(409);
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("refuses a missing platform or file, a file that is too big, and files that are not reports", async () => {
    expect((await POST(upload({ platform: "tiktok" }))).status).toBe(400);
    expect((await POST(upload({ file: null }))).status).toBe(400);
    expect((await POST(upload({ file: new Blob([new Uint8Array(4_000_001)]) }))).status).toBe(413);
    const zip = await POST(upload({ file: new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0])]), name: "report.pdf" }));
    expect(zip.status).toBe(415);
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("returns the rows for review, labelled, uncached and unsaved", async () => {
    const response = await POST(upload());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      platform: "instagram", today: "2026-10-17", reportDate: "2026-10-17",
      rows: [{ metricKey: "instagram.followers", label: "Instagram followers", date: "2026-10-17", value: 73, evidence: "73 followers" }],
      notUsed: [{ item: "Views, last 30 days", reason: "A 30-day total" }], dropped: [],
    });
    const [input] = mocks.extract.mock.calls[0];
    expect(input).toMatchObject({ platform: "instagram", fileName: "report.pdf", today: "2026-10-17" });
    expect(Array.from(input.bytes)).toEqual(Array.from(PDF));
  });

  it("explains when trends or the reader are unavailable", async () => {
    mocks.catalog.mockResolvedValueOnce({ status: "unavailable", today: "2026-10-17", metrics: [], recentEntries: [], dimensionLabels: {}, connectors: { dripify: false } });
    expect((await POST(upload())).status).toBe(503);
    mocks.extract.mockResolvedValueOnce({ status: "error", code: "ai_unavailable" });
    const response = await POST(upload());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/type the numbers in by hand/);
  });
});
