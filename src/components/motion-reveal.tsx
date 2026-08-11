"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "article" | "aside" | "div" | "section";
};

export function MotionReveal({ children, className, delay = 0, as = "div" }: MotionRevealProps) {
  const elementRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const Tag = as;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { threshold: 0.12 });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <Tag className={["motion-reveal", visible ? "is-visible" : "", className].filter(Boolean).join(" ")} ref={elementRef as never} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</Tag>;
}
