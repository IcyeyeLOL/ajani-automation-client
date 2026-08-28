import { requireAdminSession } from "@/lib/admin/session";
import type { ReactNode } from "react";
import "../admin.css";

export const dynamic = "force-dynamic";

export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  await requireAdminSession();
  return children;
}
