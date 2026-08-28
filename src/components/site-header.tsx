"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccountAccess } from "@/components/account-access-dialog";
import { HeaderUserMenu } from "@/components/header-user-menu";

const links = [
  { href: "/", label: "Home" },
  { href: "/demos", label: "Demos" },
  { href: "/stories", label: "Stories" },
  { href: "/approach", label: "Approach" },
];

export function SiteHeader() {
  const { openAccountAccess } = useAccountAccess();
  const pathname = usePathname();

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        ajani<i>.</i>
      </Link>
      <nav className="site-nav" aria-label="Primary navigation">
        {links.map((link) => (
          <Link aria-current={pathname === link.href ? "page" : undefined} className={`site-nav-link${pathname === link.href ? " is-active" : ""}`} href={link.href} key={link.href}>
            {link.label}
          </Link>
        ))}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button aria-label="Open navigation menu" className="mobile-nav-menu" type="button">Menu</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="mobile-nav-menu-content" sideOffset={10}>
              {links.slice(1).map((link) => <DropdownMenu.Item asChild key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </DropdownMenu.Item>)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <HeaderUserMenu signedOutFallback={<button className="header-sign-in" onClick={() => openAccountAccess("sign-in")} type="button">Sign in</button>} />
        <Link className="header-action" href="/record">
          REQUEST A BUILD
        </Link>
      </nav>
    </header>
  );
}
