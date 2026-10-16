import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { adminPageNumber, loadAdminDashboardData } from "@/lib/admin/dashboard";
import { loadMetricCatalog } from "@/lib/admin/metrics";

export const metadata: Metadata = { title: "Control Desk | Ajani Automation", robots: { index: false, follow: false } };

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  // Each loader authorizes itself before reading, so they can run in parallel.
  const [data, catalog] = await Promise.all([
    loadAdminDashboardData({ experimentPage: adminPageNumber(query.experiments), batchPage: adminPageNumber(query.batches) }),
    loadMetricCatalog(),
  ]);
  return <AdminDashboard catalog={catalog} data={data} />;
}

