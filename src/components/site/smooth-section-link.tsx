"use client";

import Link from "next/link";
import { forwardRef, type ComponentProps, type MouseEvent } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

let cancelActiveScroll: (() => void) | null = null;

function moveToSection(target: HTMLElement) {
  cancelActiveScroll?.();

  const root = document.documentElement;
  const start = window.scrollY;
  const margin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
  const destination = Math.max(0, target.getBoundingClientRect().top + start - margin);
  const focusTarget = () => {
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.dataset.motion !== "full") {
    window.scrollTo({ top: destination, behavior: "instant" });
    focusTarget();
    return;
  }

  const distance = destination - start;
  if (Math.abs(distance) < 2) {
    focusTarget();
    return;
  }

  const duration = Math.min(720, Math.max(380, Math.abs(distance) * .18));
  let frame = 0;
  let startedAt: number | null = null;
  let finished = false;

  const finish = (completed: boolean) => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("keydown", cancel);
    window.removeEventListener("pointerdown", cancel);
    window.removeEventListener("popstate", cancel);
    window.removeEventListener("hashchange", cancel);
    window.removeEventListener("pagehide", cancel);
    if (cancelActiveScroll === cancel) cancelActiveScroll = null;
    if (completed) focusTarget();
  };
  const cancel = () => finish(false);
  cancelActiveScroll = cancel;
  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchstart", cancel, { passive: true });
  window.addEventListener("keydown", cancel);
  window.addEventListener("pointerdown", cancel, { passive: true });
  window.addEventListener("popstate", cancel);
  window.addEventListener("hashchange", cancel);
  window.addEventListener("pagehide", cancel);

  const tick = (now: number) => {
    if (startedAt === null) startedAt = now;
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    window.scrollTo({ top: start + distance * eased, behavior: "instant" });
    if (progress < 1) frame = requestAnimationFrame(tick);
    else finish(true);
  };
  frame = requestAnimationFrame(tick);
}

export const SmoothSectionLink = forwardRef<HTMLAnchorElement, Props>(function SmoothSectionLink(
  { href, onClick, ...props },
  ref,
) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.location.pathname !== "/") return;

    const target = document.getElementById(href.slice(2));
    if (!target) return;
    event.preventDefault();
    if (window.location.hash !== `#${target.id}`) window.history.pushState(null, "", href);
    moveToSection(target);
  };

  return <Link {...props} href={href} onClick={navigate} ref={ref} />;
});
