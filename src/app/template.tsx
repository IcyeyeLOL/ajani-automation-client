import type { ReactNode } from "react";

export default function PageTemplate({ children }: { children: ReactNode }) {
  return <div className="route-transition">{children}</div>;
}
