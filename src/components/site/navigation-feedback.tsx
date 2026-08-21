"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./navigation-feedback.module.css";

const MINIMUM_VISIBLE_MS = 420;
const NAVIGATION_TIMEOUT_MS = 8_000;

function destinationLabel(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/demos")) return "demos";
  if (pathname.startsWith("/stories")) return "stories";
  if (pathname.startsWith("/record") || pathname.startsWith("/request")) return "recording desk";
  if (pathname.startsWith("/portal")) return "client portal";
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) return "account access";
  return "next page";
}

export function NavigationFeedback() {
  const pathname = usePathname();
  const feedbackNode = useRef<HTMLDivElement | null>(null);
  const previousPathname = useRef(pathname);
  const completionTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [label, setLabel] = useState("next page");

  useEffect(() => {
    const finish = () => {
      if (completionTimer.current) window.clearTimeout(completionTimer.current);
      completionTimer.current = window.setTimeout(() => setPending(false), MINIMUM_VISIBLE_MS);
    };

    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      finish();
    }
  }, [pathname]);

  useEffect(() => {
    const begin = (nextPathname: string) => {
      setLabel(destinationLabel(nextPathname));
      setPending(true);

      if (completionTimer.current) window.clearTimeout(completionTimer.current);
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = window.setTimeout(() => setPending(false), NAVIGATION_TIMEOUT_MS);
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname) return;

      begin(destination.pathname);
    };

    const node = feedbackNode.current;
    document.addEventListener("click", onClick, true);
    if (node) node.dataset.ready = "true";
    return () => {
      document.removeEventListener("click", onClick, true);
      if (node) delete node.dataset.ready;
      if (completionTimer.current) window.clearTimeout(completionTimer.current);
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    };
  }, []);

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={styles.feedback}
      data-visible={pending ? "true" : "false"}
      ref={feedbackNode}
      role="status"
    >
      <div className={styles.progress} aria-hidden="true"><i /></div>
      <div className={styles.notice}>
        <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
        <span><b>Ajani</b>Opening {label}</span>
      </div>
    </div>
  );
}
