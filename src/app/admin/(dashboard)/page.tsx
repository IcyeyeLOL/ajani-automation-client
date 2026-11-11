import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { adminPageNumber, loadAdminDashboardData, loadOutreachChannelSeries, loadOutreachReplySources } from "@/lib/admin/dashboard";
import { loadGoalBoard, loadMetricCatalog } from "@/lib/admin/metrics";
import { loadConnectionBoard } from "@/lib/admin/connections";
import { outreachChannelQueries, outreachReplySourceQueries, outreachReplySources, summarizeOutreachChannels } from "@/lib/admin/outreach-channels";
import { isSampleMode } from "@/lib/admin/sample-mode";
import { SAMPLE_DEFINITIONS, sampleDashboardData, sampleGoalBoard, sampleMetricCatalog, sampleMetricSeries } from "@/lib/admin/sample-data";

export const metadata: Metadata = { title: "Control Desk | Ajani Automation", robots: { index: false, follow: false } };
// Server Actions take the page's limit; the on-demand Dripify and platform syncs need up to 45 seconds.
export const maxDuration = 60;

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const pages = { experimentPage: adminPageNumber(query.experiments), batchPage: adminPageNumber(query.batches) };
  if (await isSampleMode()) {
    // Made-up numbers for every section, rendered only. The catalog still reads
    // the real metric definitions, and Connections always shows the real status.
    const [realCatalog, connections] = await Promise.all([loadMetricCatalog(), loadConnectionBoard()]);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const definitions = realCatalog.status === "available" && realCatalog.metrics.length ? realCatalog.metrics : SAMPLE_DEFINITIONS;
    const catalog = sampleMetricCatalog(definitions, today);
    // The same series Trends charts in sample mode, one per Outreach channel.
    const channels = summarizeOutreachChannels(outreachChannelQueries(today).map((channelQuery) => sampleMetricSeries(channelQuery, definitions, today)), catalog, today);
    const replySources = outreachReplySources(outreachReplySourceQueries(today).map((sourceQuery) => sampleMetricSeries(sourceQuery, definitions, today)));
    return <AdminDashboard
      catalog={catalog}
      channels={channels}
      connections={connections}
      data={sampleDashboardData(pages, now)}
      goals={sampleGoalBoard(today)}
      replySources={replySources}
      sampleMode
    />;
  }
  // Each loader authorizes itself before reading, so they can run in parallel.
  const today = new Date().toISOString().slice(0, 10);
  const [data, catalog, goals, connections, channelSeries, replySources] = await Promise.all([
    loadAdminDashboardData(pages),
    loadMetricCatalog(),
    loadGoalBoard(),
    loadConnectionBoard(),
    loadOutreachChannelSeries(today),
    loadOutreachReplySources(today),
  ]);
  return <AdminDashboard catalog={catalog} channels={summarizeOutreachChannels(channelSeries, catalog, today)} connections={connections} data={data} goals={goals} replySources={replySources} />;
}

