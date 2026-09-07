import type { Metadata } from "next";
import Link from "next/link";
import { LegalSwitcher } from "@/components/legal/legal-switcher";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import { LEGAL_EFFECTIVE_DATE_LABEL } from "@/lib/legal/policy-versions";
import styles from "./legal.module.css";

export const metadata: Metadata = {
  title: "Legal & Trust Center · Ajani Automation",
  description: "Ajani's service terms, privacy practices, acceptable-use rules, accessibility approach, and provider inventory.",
};

const documents = [
  {
    eyebrow: "TERMS & USE",
    title: "Terms of Service",
    summary: "The agreement for using Ajani, including project formation, client responsibilities, and acceptable-use rules.",
    details: ["Requests and project formation", "Consent and communications", "Human review and regulated data", "Payment, ownership, and limits"],
    href: "/terms",
    cta: "Read the terms",
    supportingHref: "/acceptable-use",
    supportingLabel: "Detailed acceptable-use rules",
  },
  {
    eyebrow: "PRIVACY & DATA",
    title: "Privacy Policy",
    summary: "What Ajani collects, why it is used, how providers fit, how long records remain, and how to make a request.",
    details: ["Voice and AI processing", "Service-provider disclosures", "Retention and security", "Privacy choices and rights"],
    href: "/privacy",
    cta: "Read the policy",
    supportingHref: "/subprocessors",
    supportingLabel: "Current service-provider inventory",
  },
  {
    eyebrow: "ACCESS & SUPPORT",
    title: "Accessibility & support",
    summary: "How to use Ajani across devices and input methods, request an alternative format, or report a barrier.",
    details: ["Keyboard and page structure", "Written intake alternative", "Motion and media controls", "Public contact route"],
    href: "/accessibility",
    cta: "Read the statement",
    supportingHref: "mailto:hello@ajaniautomation.com?subject=Legal%20or%20accessibility%20question",
    supportingLabel: "Contact Ajani about legal or access needs",
  },
] as const;

export default function LegalPage() {
  return (
    <div className={styles.shell}>
      <SiteTop />

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <p className={styles.label}>AJANI / LEGAL &amp; TRUST</p>
              <h1>Clear rules.<br /><em>Visible practices.</em></h1>
            </div>
            <div className={styles.heroNote}>
              <span>Last updated {LEGAL_EFFECTIVE_DATE_LABEL}</span>
              <p>Three clear destinations cover service rules, data practices, and accessible support. Detailed use and provider disclosures remain available inside their parent documents.</p>
              <LegalSwitcher className={styles.legalSwitcher} current="overview" />
            </div>
          </div>
        </section>

        <section aria-labelledby="legal-documents-heading" className={styles.content}>
          <div className={styles.intro}>
            <p className={styles.label}>LEGAL LIBRARY</p>
            <h2 id="legal-documents-heading">Three groups.<br />Nothing scattered.</h2>
            <p>Acceptable-use rules live under Terms, and the provider inventory lives under Privacy. Accessibility and public support stay together.</p>
          </div>

          <div className={styles.documentGrid}>
            {documents.map((document, index) => (
              <article className={styles.documentCard} data-legal-group="true" key={document.href}>
                <div className={styles.cardTop}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{document.eyebrow}</p>
                </div>
                <h3>{document.title}</h3>
                <p className={styles.summary}>{document.summary}</p>
                <ul>
                  {document.details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
                <a className={styles.supportingLink} href={document.supportingHref}>{document.supportingLabel}<span aria-hidden="true">↗</span></a>
                <Link className={styles.primaryLink} href={document.href}>{document.cta}<span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}
