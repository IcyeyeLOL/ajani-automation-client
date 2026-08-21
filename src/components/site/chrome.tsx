import Link from "next/link";
import styles from "./chrome.module.css";

type Nav = "stories" | null;

/**
 * The marketing header and footer, shared so the pages a visitor moves between
 * do not each carry their own copy. The recorder page deliberately does not use
 * this — it runs a stripped header with a single way back, because it is the
 * end of the funnel and every extra link there is an exit.
 */
export function SiteTop({ active = null }: { active?: Nav }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/">ajani<i>.</i></Link>
        <nav className={styles.nav}>
          <Link
            aria-current={active === "stories" ? "page" : undefined}
            className={styles.link}
            href="/stories"
          >
            Stories
          </Link>
          <Link className={styles.link} href="/portal">Sign in</Link>
          <Link className={styles.cta} href="/record">Record a note</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFoot() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>© {new Date().getFullYear()} Ajani Automation</span>
        <div className={styles.footerLinks}>
          <Link href="/stories">Stories</Link>
          <Link href="/portal">Client portal</Link>
          <Link href="/record">Record a note</Link>
        </div>
      </div>
    </footer>
  );
}
