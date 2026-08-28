import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { loadAdminDashboardData } from "@/lib/admin/dashboard";

export const metadata: Metadata = { title: "Control Desk | Ajani Automation", robots: { index: false, follow: false } };

export default async function AdminDashboardPage() {
  const data = await loadAdminDashboardData();
  return <AdminDashboard data={data} />;
}

