"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/portal/portal.module.css";

const links = [
  { href: "/portal", label: "Overview", icon: "overview" },
  { href: "/portal/builds", label: "Requests", icon: "requests" },
  { href: "/portal/systems", label: "Systems", icon: "systems" },
  { href: "/portal/billing", label: "Billing", icon: "billing" },
] as const;

export function PortalNavigation() {
  const pathname = usePathname();

  return <nav aria-label="Client portal" className={styles.portalNav}>
    {links.map((link) => {
      const active = link.href === "/portal" ? pathname === link.href : pathname.startsWith(link.href);
      return <Link aria-current={active ? "page" : undefined} href={link.href} key={link.href}>
        <PortalIcon name={link.icon} />
        <span>{link.label}</span>
      </Link>;
    })}
  </nav>;
}

export function PortalIcon({ name }: { name: "billing" | "overview" | "requests" | "systems" }) {
  if (name === "overview") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h6v7H4V4Zm10 0h6v4h-6V4ZM4 15h6v5H4v-5Zm10-3h6v8h-6v-8Z" /></svg>;
  if (name === "requests") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Zm2.5 5h5M9.5 12h5M9.5 15.5H13" /></svg>;
  if (name === "systems") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.3 10.9 7.4-3.8M8.3 13.1l7.4 3.8" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect height="15" rx="2.5" width="18" x="3" y="4.5" /><path d="M3 9h18M7 15h4" /></svg>;
}
