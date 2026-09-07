"use client";

import { type ReactNode } from "react";
import { Reveal } from "@/components/home/reveal";

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "article" | "aside" | "div" | "section";
};

export function MotionReveal({ children, className, delay = 0, as = "div" }: MotionRevealProps) {
  // Keep one progressive-enhancement implementation. Content is readable before
  // hydration and when observation is unavailable, including on legacy routes.
  return <Reveal as={as} className={className} delay={delay}>{children}</Reveal>;
}
