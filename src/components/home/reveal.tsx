"use client";

import { type CSSProperties, type ElementType, type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./reveal.module.css";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger, in ms. Use small steps — 70 to 110 reads as one gesture. */
  delay?: number;
  as?: ElementType;
  /** Merged with the reveal's own delay variable, for per-instance tokens. */
  style?: CSSProperties;
};

/**
 * Fades and lifts an element the first time it enters the viewport, then stops
 * observing.
 *
 * Reduced motion is handled entirely in CSS: the media query pins opacity to 1
 * and drops the transition, so the content is visible whether or not this
 * component ever marks it shown. The observer is then harmless rather than
 * load-bearing, and nothing here can hide content if JavaScript fails.
 */
export function Reveal({ children, className, delay = 0, as, style }: RevealProps) {
  const node = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const Tag = (as ?? "div") as ElementType;

  useEffect(() => {
    const element = node.current;
    if (!element) return;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setShown(true);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };

    // IntersectionObserver only fires when the ratio crosses a threshold. A jump
    // — anchor link, End key, restored scroll position — takes an element from
    // below the viewport straight to above it, 0 to 0, and never fires. So a
    // passive scroll check backs it up; content must never stay invisible.
    const onScroll = () => {
      if (element.getBoundingClientRect().top < window.innerHeight) finish();
    };

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) finish(); },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(element);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <Tag
      className={[styles.reveal, shown ? styles.shown : "", className].filter(Boolean).join(" ")}
      ref={node}
      style={{ ...style, "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
