"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { RecordNoteAction } from "@/components/record-note-action";
import styles from "./chrome.module.css";
import menu from "./mobile-site-menu.module.css";

const links = [
  { href: "/#solutions", label: "Solutions", description: "See the systems Ajani builds", value: "solutions" },
  { href: "/#industries", label: "Industries", description: "Explore operational use cases", value: "industries" },
  { href: "/stories", label: "Client work", accessibleLabel: "Client work and Stories", description: "Inspect client systems and results", value: "stories" },
  { href: "/#process", label: "Process", description: "Understand scope, build, and launch", value: "process" },
  { href: "/#about", label: "About", description: "See who is behind Ajani", value: "about" },
  { href: "/demos", label: "Demos", description: "Explore working system examples", value: "demos" },
  { href: "/#contact", label: "Contact", description: "Discuss one costly workflow", value: "contact" },
] as const;

type MobileSiteMenuProps = {
  active?: "approach" | "demos" | "home" | "stories" | null;
};

export function MobileSiteMenu({ active = null }: MobileSiteMenuProps) {
  const [open, setOpen] = useState(false);
  const handingOff = useRef(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1121px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className={styles.mobileControls}>
      <HeaderUserMenu className={styles.mobileAccount} signedOutFallback={null} />
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Trigger asChild>
          <button
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            className={styles.mobileMenuTrigger}
            type="button"
          >
            <span aria-hidden="true" className={styles.menuIcon}><i /><i /><i /></span>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={menu.overlay} />
          <Dialog.Content className={menu.panel} onCloseAutoFocus={(event) => {
            // A newly opened account dialog owns focus, not the closing menu.
            if (handingOff.current) event.preventDefault();
            handingOff.current = false;
          }}>
            <div className={menu.head}>
              <Dialog.Close asChild>
                <Link aria-label="Ajani home" className={menu.brand} href="/">ajani<span>.</span></Link>
              </Dialog.Close>
              <span className={menu.menuLabel}>Menu</span>
              <Dialog.Close aria-label="Close navigation menu" className={menu.close}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </Dialog.Close>
            </div>
            <div className={menu.body}>
              <Dialog.Title className={menu.srOnly}>Explore Ajani</Dialog.Title>
              <Dialog.Description className={menu.srOnly}>Browse Ajani&apos;s services, client work, process, and contact options.</Dialog.Description>
              <nav aria-label="Mobile navigation" className={menu.links}>
                {links.map((link) => (
                  <Dialog.Close asChild key={link.href}>
                    <Link
                      aria-label={"accessibleLabel" in link ? link.accessibleLabel : link.label}
                      aria-current={active === link.value ? "page" : undefined}
                      href={link.href}
                    >
                      <span className={menu.destinationIcon} aria-hidden="true">
                        {link.value === "demos" ? (
                          <svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="22" rx="5" /><path d="m13 11 8 5-8 5Z" /></svg>
                        ) : link.value === "stories" ? (
                          <svg viewBox="0 0 32 32"><rect x="6" y="4" width="20" height="24" rx="4" /><path d="M11 11h10M11 16h10M11 21h6" /></svg>
                        ) : (
                          <svg viewBox="0 0 32 32"><circle cx="7" cy="16" r="3" /><circle cx="25" cy="8" r="3" /><circle cx="25" cy="24" r="3" /><path d="M10 16h6c4 0 4-8 6-8M16 16c4 0 4 8 6 8" /></svg>
                        )}
                      </span>
                      <span className={menu.linkCopy}><b>{link.label}</b><small>{link.description}</small></span>
                      <svg className={menu.arrow} aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                    </Link>
                  </Dialog.Close>
                ))}
                <Dialog.Close asChild>
                  <a
                    aria-label="Discuss a workflow"
                    className={menu.cta}
                    href="mailto:hello@ajaniautomation.com?subject=Workflow%20audit"
                  >
                    <span className={menu.destinationIcon} aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 25 25 6M14 6h11v11" /></svg></span>
                    <span className={menu.linkCopy}><b>Discuss a workflow</b><small>Start with one costly process</small></span>
                    <svg className={menu.arrow} aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                  </a>
                </Dialog.Close>
                <RecordNoteAction className={menu.secondaryCta} onActivate={() => {
                  handingOff.current = true;
                  setOpen(false);
                }}>
                  <span className={menu.destinationIcon} aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 13v6M11 9v14M16 5v22M21 10v12M26 13v6" /></svg></span>
                  <span className={menu.linkCopy}><b>Record a note</b><small aria-hidden="true">Tell us in your own words</small></span>
                  <svg className={menu.arrow} aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                </RecordNoteAction>
              </nav>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
