import Link from "next/link";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { RecordNoteAction } from "@/components/record-note-action";
import styles from "./chrome.module.css";

type Nav = "approach" | "demos" | "home" | "stories" | null;

const mobileLinks = [
  { href: "/demos", label: "Demos", note: "See the systems move", value: "demos" },
  { href: "/stories", label: "Stories", note: "Real client work and proof", value: "stories" },
] as const;

/**
 * The marketing header and footer, shared so the pages a visitor moves between
 * do not each carry their own copy. The recorder page deliberately does not use
 * this — it runs a stripped header with a single way back, because it is the
 * end of the funnel and every extra link there is an exit.
 */
export function SiteTop({ active = null }: { active?: Nav }) {
  return (
    <>
      <a className={styles.skipLink} href="#main-content">Skip to main content</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/">ajani<i>.</i></Link>
          <nav className={styles.nav}>
            <Link
              aria-current={active === "demos" ? "page" : undefined}
              className={styles.link}
              href="/demos"
            >
              Demos
            </Link>
            <Link
              aria-current={active === "stories" ? "page" : undefined}
              className={styles.link}
              href="/stories"
            >
              Stories
            </Link>
            <RecordNoteAction className={styles.cta}>Record a note</RecordNoteAction>
            <HeaderUserMenu />
          </nav>
          <div className={styles.mobileControls}>
            <HeaderUserMenu className={styles.mobileAccount} />
            <details className={styles.mobileMenu}>
              <summary aria-label="Open navigation menu" className={styles.mobileMenuTrigger}>
                <span aria-hidden="true" className={styles.menuIcon}><i /><i /><i /></span>
              </summary>
              <div className={styles.mobileMenuPanel}>
                <div className={styles.mobileMenuHead}>
                  <span>Explore Ajani</span>
                </div>
                <h2 className={styles.mobileMenuTitle}>Where do you want to go?</h2>
                <nav aria-label="Mobile navigation" className={styles.mobileMenuLinks}>
                  {mobileLinks.map((link, index) => (
                    <Link
                      aria-current={active === link.value ? "page" : undefined}
                      href={link.href}
                      key={link.href}
                    >
                      <small>0{index + 1}</small>
                      <span><b>{link.label}</b><em>{link.note}</em></span>
                      <i aria-hidden="true">→</i>
                    </Link>
                  ))}
                </nav>
                <RecordNoteAction className={styles.mobileCta}>
                  <span>Record a note</span><i aria-hidden="true">→</i>
                </RecordNoteAction>
                <nav aria-label="Legal" className={styles.mobileMenuLegal}>
                  <Link href="/legal">Legal</Link>
                  <i aria-hidden="true">·</i>
                  <Link href="/terms">Terms</Link>
                  <i aria-hidden="true">·</i>
                  <Link href="/privacy">Privacy</Link>
                </nav>
              </div>
            </details>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFoot() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerMain}>
          <div className={styles.footerBrand}>
            <Link aria-label="Ajani Automation home" href="/">ajani<i>.</i></Link>
            <p>Automation systems built around the work slowing your team down.</p>
          </div>

          <nav aria-label="Footer" className={styles.footerNav}>
            <div className={styles.footerGroup}>
              <span>Watch</span>
              <div className={styles.socialLinks}>
                <a aria-label="YouTube" href="https://youtu.be/upEkMB8pYRA" rel="noreferrer" target="_blank" title="Watch Ajani on YouTube">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.3V8.7l5.7 3.3-5.7 3.3Z" /></svg>
                </a>
                <a aria-label="LinkedIn" href="https://www.linkedin.com/in/olakunleajani/" rel="noreferrer" target="_blank" title="Follow Ajani on LinkedIn">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5.4 7.9H2.2V21h3.2V7.9ZM3.8 2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM21.8 13.5c0-4-2.1-5.9-5-5.9a4.3 4.3 0 0 0-3.9 2.1V7.9H9.7V21h3.2v-6.5c0-1.7.3-3.4 2.5-3.4 2.2 0 2.2 2 2.2 3.5V21h3.2l1-7.5Z" /></svg>
                </a>
                <span aria-label="Instagram — coming soon" className={styles.socialSoon} role="img" title="Instagram coming soon">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><rect height="17" rx="5" width="17" x="3.5" y="3.5" /><circle cx="12" cy="12" r="4" /><circle cx="17.7" cy="6.4" r="1" /></svg>
                </span>
                <span aria-label="Facebook — coming soon" className={styles.socialSoon} role="img" title="Facebook coming soon">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 21v-8h2.7l.4-3H14V8.1c0-.9.3-1.5 1.6-1.5h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3V10H7.8v3h2.8v8H14Z" /></svg>
                </span>
              </div>
              <small className={styles.socialNote}>Instagram + Facebook coming soon</small>
            </div>
            <div className={styles.footerGroup}>
              <span>Legal</span>
              <Link href="/legal">Legal overview</Link>
              <Link href="/terms">Terms of service</Link>
              <Link href="/privacy">Privacy policy</Link>
            </div>
          </nav>
        </div>

        <div className={styles.footerBase}>
          <span>© {new Date().getFullYear()} Ajani Automation</span>
          <span>Designed around your workflow.</span>
        </div>
      </div>
    </footer>
  );
}
