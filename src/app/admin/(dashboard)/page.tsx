import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { adminPageNumber, loadAdminDashboardData } from "@/lib/admin/dashboard";
import { loadGoalBoard, loadMetricCatalog } from "@/lib/admin/metrics";
import { loadConnectionBoard } from "@/lib/admin/connections";
import { isSampleMode } from "@/lib/admin/sample-mode";
import { SAMPLE_DEFINITIONS, sampleDashboardData, sampleGoalBoard, sampleMetricCatalog } from "@/lib/admin/sample-data";

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
    return <AdminDashboard
      catalog={sampleMetricCatalog(definitions, today)}
      connections={connections}
      data={sampleDashboardData(pages, now)}
      goals={sampleGoalBoard(today)}
      sampleMode
    />;
  }
  // Each loader authorizes itself before reading, so they can run in parallel.
  const [data, catalog, goals, connections] = await Promise.all([
    loadAdminDashboardData(pages),
    loadMetricCatalog(),
    loadGoalBoard(),
    loadConnectionBoard(),
  ]);
  return <AdminDashboard catalog={catalog} connections={connections} data={data} goals={goals} />;
}

