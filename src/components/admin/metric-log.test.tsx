import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/admin/actions", () => ({ deleteMetricValueAction: vi.fn(), recordMetricValuesAction: vi.fn() }));

import { MetricLog, entryGroups } from "@/components/admin/metric-log";
import type { MetricCatalog, MetricDefinition } from "@/lib/admin/metric-types";

const definition = (key: string, label: string, entryMode: MetricDefinition["entryMode"], dimensions: string[] = []): MetricDefinition => ({
  key, source: key.slice(0, key.indexOf(".")), category: "outreach", label, description: "", unit: "count", aggregation: "sum",
  numeratorKey: null, denominatorKey: null, entryMode, higherIsBetter: true, chartable: true, firstDate: null, lastDate: null, dimensions,
});

const catalog: MetricCatalog = {
  status: "available",
  today: "2026-10-18",
  metrics: [
    definition("sales.deals_won", "Clients signed", "manual"),
    definition("cold_calls.dials", "Cold calls made", "manual"),
    definition("dripify.new_contacted", "Dripify leads contacted (new)", "connector", ["dripify:1"]),
    definition("dripify.new_replies", "Dripify replies (new)", "connector", ["dripify:1"]),
    definition("dripify.positive_replies", "Dripify positive replies", "manual"),
    definition("dripify.calls_booked", "Dripify calls booked", "manual", ["@someone"]),
    definition("reddit.dms_sent", "Reddit DMs sent", "manual"),
  ],
  recentEntries: [],
  dimensionLabels: {},
  connectors: { dripify: true },
};
const definitions = new Map(catalog.metrics.map((metric) => [metric.key, metric]));

function render(options: { sources?: string[] | null; viewId?: "key" | "outreach" | "dripify"; viewSources?: string[] | null; onNavigate?: () => void } = {}) {
  return renderToStaticMarkup(<MetricLog
    catalog={catalog}
    definitions={definitions}
    onNavigate={options.onNavigate}
    request={{ token: 1, sources: options.sources ?? null }}
    sampleMode={false}
    viewId={options.viewId ?? "key"}
    viewSources={options.viewSources ?? null}
  />);
}

describe("Log numbers", () => {
  it("has a Dripify tab next to Cold calls", () => {
    const ids = entryGroups.map((group) => group.id);
    expect(ids.indexOf("dripify")).toBe(ids.indexOf("cold_calls") + 1);
    expect(entryGroups.find((group) => group.id === "dripify")?.sources).toEqual(["dripify"]);
  });

  it("lists only Dripify's manual numbers, for the whole business, with what to log there", () => {
    const html = render({ sources: ["dripify"] });
    expect(html).toContain('aria-pressed="true" type="button">Dripify</button>');
    expect(html).toContain("Positive replies");
    expect(html).toContain("Calls booked");
    // What the sync writes is never a typed field, and there is no account to pick.
    expect(html).not.toContain("Leads contacted (new)");
    expect(html).not.toContain("Replies (new)");
    expect(html).not.toContain("Main account");
    expect(html).toContain("Dripify syncs its sends, acceptances and replies every night. Log the positive replies and calls booked from Dripify conversations here.");
  });

  it("opens Reddit with a note that Outreach adds its DMs up", () => {
    const html = render({ sources: ["reddit"] });
    expect(html).toContain("Log every Reddit DM here; Outreach adds them up with Dripify and cold calls.");
    expect(html).not.toContain("batch");
  });

  it("points the Outreach view at the tabs that feed it, not at a batch logger", () => {
    const html = render({ viewId: "outreach", viewSources: ["outreach"], onNavigate: () => {} });
    expect(html).toContain("Outreach adds up Dripify, Reddit DMs and cold calls.");
    expect(html).toContain("Outreach →");
    expect(html).not.toContain("batch");
    // Opened on the Outreach view, the panel starts on the first tab that feeds it.
    expect(html).toContain('aria-pressed="true" type="button">Cold calls</button>');
  });

  it("opens the Dripify view on the Dripify tab", () => {
    expect(render({ viewId: "dripify", viewSources: ["dripify"] })).toContain('aria-pressed="true" type="button">Dripify</button>');
  });
});
