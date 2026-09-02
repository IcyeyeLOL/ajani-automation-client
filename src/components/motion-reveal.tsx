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

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      setVisible(true);
      observer.disconnect();
      window.removeEventListener("scroll", checkPosition);
    };
    const checkPosition = () => {
      if (element.getBoundingClientRect().top < window.innerHeight * .94) reveal();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) reveal();
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });

    observer.observe(element);
    window.addEventListener("scroll", checkPosition, { passive: true });
    checkPosition();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", checkPosition);
    };
  }, []);

  return <Tag className={["motion-reveal", visible ? "is-visible" : "", className].filter(Boolean).join(" ")} ref={elementRef as never} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</Tag>;
}
