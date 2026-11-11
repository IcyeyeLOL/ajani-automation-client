import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAdminAction } from "@/app/admin/actions";

/** The control desk frame for the client build pages, which live at their own URLs. */
export function AdminBuildsShell({ children, sampleMode }: { children: ReactNode; sampleMode: boolean }) {
  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <div>
        <span className="admin-wordmark">AJANI<i>.</i></span>
        <small>CONTROL DESK</small>
      </div>
      <nav aria-label="Admin sections">
        <Link href="/admin"><span>01</span>Desk overview</Link>
        <Link aria-current="page" href="/admin/builds"><span>08</span>Client builds</Link>
      </nav>
      <div className="admin-sidebar-foot">
        <p><i className={sampleMode ? "sample" : "online"} />{sampleMode ? "SAMPLE DATA SHOWN, NOT LIVE" : "LIVE CLIENT DATA"}</p>
        <form action={logoutAdminAction}><button type="submit">LOCK DESK</button></form>
      </div>
    </aside>
    <section className="admin-main">
      {sampleMode ? <aside aria-label="Sample data notice" className="admin-sample-banner">
        <div>
          <span>NOT REAL CLIENTS</span>
          <p><strong>SAMPLE DATA</strong><span className="admin-sample-detail">: made-up clients and builds. Nothing you post here is saved. Turn sample data off on the desk overview to see real clients.</span></p>
        </div>
      </aside> : null}
      {children}
    </section>
  </main>;
}
