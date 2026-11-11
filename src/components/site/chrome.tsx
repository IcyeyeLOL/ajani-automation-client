import Link from "next/link";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { MobileSiteMenu } from "@/components/site/mobile-site-menu";
import { SmoothSectionLink } from "@/components/site/smooth-section-link";
import styles from "./chrome.module.css";

type Nav = "approach" | "demos" | "home" | null;
type ChromeTone = "dark" | "light";
type ChromeVariant = "marketing" | "funnel";

const primaryLinks = [
  { href: "/#client-work", label: "Client work", value: null },
  { href: "/#process", label: "Process", value: null },
  { href: "/demos", label: "Demos", value: "demos" },
  { href: "/#faq", label: "FAQ", value: null },
] as const;

/**
 * The marketing header and footer stay shared so pages do not drift apart.
 * The recorder opts into the stripped funnel variant: one way back and no
 * competing navigation at the point where a visitor is preparing a request.
 */
export function SiteTop({
  active = null,
  coverSafeArea = false,
  subtitle,
  tone = "dark",
  variant = "marketing",
}: {
  active?: Nav;
  coverSafeArea?: boolean;
  subtitle?: string;
  tone?: ChromeTone;
  variant?: ChromeVariant;
}) {
  const isFunnel = variant === "funnel";

  return (
    <>
      <a className={styles.skipLink} data-safe-area={coverSafeArea ? "cover" : undefined} href="#main-content">Skip to main content</a>
      <header className={styles.header} data-safe-area={coverSafeArea ? "cover" : undefined} data-tone={tone} data-variant={variant}>
        <div className={styles.headerInner}>
          <div className={styles.brandLockup}>
            <Link aria-label="Ajani home" className={styles.brand} href="/">ajani<i>.</i></Link>
            {subtitle ? <span className={styles.context}>{subtitle}</span> : null}
          </div>

          {isFunnel ? (
            <Link className={styles.funnelBack} href="/">
              <i aria-hidden="true">←</i><span>Back home</span>
            </Link>
          ) : (
            <>
              <nav aria-label="Primary navigation" className={styles.nav}>
                {primaryLinks.map((link) => {
                  const NavigationLink = link.href.startsWith("/#") ? SmoothSectionLink : Link;
                  return <NavigationLink
                    aria-current={link.value && active === link.value ? "page" : undefined}
                    className={styles.link}
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </NavigationLink>;
                })}
                <a
                  className={styles.cta}
                  href="mailto:olakunleajani@ajaniautomation.com?subject=Workflow%20audit"
                >
                  Discuss a workflow
                </a>
                <HeaderUserMenu signedOutFallback={null} />
              </nav>
              <MobileSiteMenu active={active} />
            </>
          )}
        </div>
      </header>
    </>
  );
}

export function SiteFoot({ coverSafeArea = false }: { coverSafeArea?: boolean }) {
  return (
    <footer className={styles.footer} data-safe-area={coverSafeArea ? "cover" : undefined}>
      <div className={styles.footerInner}>
        <div className={styles.footerMain}>
          <div className={styles.footerBrand}>
            <Link aria-label="Ajani Automation home" href="/">ajani<i>.</i></Link>
            <p>Automation systems built around the work slowing your team down.</p>
          </div>

          <nav aria-label="Footer" className={styles.footerNav}>
            <div className={styles.footerGroup}>
              <span>Contact</span>
              <a href="mailto:olakunleajani@ajaniautomation.com">olakunleajani@ajaniautomation.com</a>
              <div className={styles.socialLinks}>
                <a aria-label="YouTube" href="https://youtu.be/upEkMB8pYRA" rel="noreferrer" target="_blank" title="Watch Ajani on YouTube">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.3V8.7l5.7 3.3-5.7 3.3Z" /></svg>
                </a>
                <a aria-label="LinkedIn" href="https://www.linkedin.com/in/olakunleajani/" rel="noreferrer" target="_blank" title="Follow Ajani on LinkedIn">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5.4 7.9H2.2V21h3.2V7.9ZM3.8 2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM21.8 13.5c0-4-2.1-5.9-5-5.9a4.3 4.3 0 0 0-3.9 2.1V7.9H9.7V21h3.2v-6.5c0-1.7.3-3.4 2.5-3.4 2.2 0 2.2 2 2.2 3.5V21h3.2l1-7.5Z" /></svg>
                </a>
              </div>
            </div>
            <div className={styles.footerGroup}>
              <span>Explore</span>
              <SmoothSectionLink href="/#process">Process</SmoothSectionLink>
              <SmoothSectionLink href="/#client-work">Client work</SmoothSectionLink>
              <Link href="/demos">Demos</Link>
              <SmoothSectionLink href="/#faq">FAQ</SmoothSectionLink>
            </div>
            <div className={styles.footerGroup} data-footer-legal="true">
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
