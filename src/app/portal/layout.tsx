import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { PortalNavigation } from "@/components/portal/portal-navigation";
import { hasClerkCredentials } from "@/lib/clerk/config";
import styles from "./portal.module.css";
import "./portal.css";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const configured = hasClerkCredentials();
  if (configured) await auth.protect();

  return <>
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#portal-content">Skip to portal content</a>
      <aside className={styles.rail}>
      <div className={styles.railTop}>
        <Link aria-label="Ajani Automation home" className={styles.brand} href="/">ajani<i>.</i></Link>
        <span className={styles.workspaceLabel}>Client workspace</span>
      </div>

      <div className={styles.desktopNavigation}>
        <PortalNavigation />
      </div>

      <Link className={styles.newRequest} href="/record">
        <span aria-hidden="true">+</span>
        <b>New request</b>
        <small>Tell us what needs to move</small>
      </Link>

      <div className={styles.railFoot}>
        <div className={styles.helpCard}>
          <span>Need a hand?</span>
          <p>Open any request and ask in its conversation. The answer stays with that build.</p>
        </div>
        <div className={styles.accountRow}>
          <HeaderUserMenu showName />
          <span className={styles.accountLabel}>Profile &amp; sign out</span>
        </div>
        <Link className={styles.backToSite} href="/">← Back to Ajani</Link>
      </div>
      </aside>
      <main className={styles.main} id="portal-content" tabIndex={-1}>{children}</main>
    </div>
    <div className={styles.mobileNavigation}>
      <PortalNavigation />
    </div>
  </>;
}
