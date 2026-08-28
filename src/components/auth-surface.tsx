import Link from "next/link";
import type { ReactNode } from "react";

export function AuthSurface({ children, label }: { children: ReactNode; label: string }) {
  return <main className="auth-shell" id="main-content" tabIndex={-1}>
    <h1 className="sr-only">{label}</h1>
    <div aria-hidden="true" className="auth-ambient"><i /><i /><i /></div>
    <Link aria-label="Ajani Automation home" className="brand auth-brand" href="/">ajani<i>.</i></Link>
    <p className="auth-route-label">AJANI / PRIVATE WORKSPACE</p>
    <section aria-label={label} className="auth-card-frame">
      <Link aria-label="Return to the Ajani Automation home page" className="auth-surface-close" href="/">×</Link>
      {children}
    </section>
  </main>;
}

export function AuthTrustLine() {
  return <p className="auth-trust-line"><i aria-hidden="true" />Protected client access · Ajani Automation</p>;
}
