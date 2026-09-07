import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { adminPageNumber, loadAdminDashboardData } from "@/lib/admin/dashboard";

export const metadata: Metadata = { title: "Control Desk | Ajani Automation", robots: { index: false, follow: false } };

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const data = await loadAdminDashboardData({ experimentPage: adminPageNumber(query.experiments), batchPage: adminPageNumber(query.batches) });
  return <AdminDashboard data={data} />;
}

