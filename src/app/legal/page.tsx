import type { Metadata } from "next";
import Link from "next/link";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./legal.module.css";

export const metadata: Metadata = {
  title: "Legal · Ajani Automation",
  description: "Ajani Automation's legal documents, privacy commitments, and service terms.",
};

const documents = [
  {
    eyebrow: "SERVICE RULES",
    title: "Terms of Service",
    summary: "The rules for using Ajani's website, account tools, client portal, demos, and paid automation services.",
    details: ["Accounts and access", "Projects and payment", "Ownership and acceptable use", "Warranties and liability"],
    href: "/terms",
    cta: "Read the terms",
  },
  {
    eyebrow: "DATA PRACTICES",
    title: "Privacy Policy",
    summary: "What Ajani collects, why it is used, where service providers fit, and how information is secured and deleted.",
    details: ["Information collected", "AI and transcription", "Cookies and storage", "Retention and deletion"],
    href: "/privacy",
    cta: "Read the policy",
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
              <p className={styles.label}>AJANI / LEGAL</p>
              <h1>Clear terms.<br /><em>Clear choices.</em></h1>
            </div>
            <div className={styles.heroNote}>
              <span>Last updated August 26, 2026</span>
              <p>Choose the document you need. Project-specific proposals and signed agreements still control the exact commercial terms for client work.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="legal-documents-heading" className={styles.content}>
          <div className={styles.intro}>
            <p className={styles.label}>LEGAL LIBRARY</p>
            <h2 id="legal-documents-heading">Two documents,<br />organized by purpose.</h2>
            <p>Terms explain the relationship and rules of service. Privacy explains how information moves through Ajani&apos;s systems.</p>
          </div>

          <div className={styles.documentGrid}>
            {documents.map((document, index) => (
              <article className={styles.documentCard} key={document.href}>
                <div className={styles.cardTop}>
                  <span>0{index + 1}</span>
                  <p>{document.eyebrow}</p>
                </div>
                <h3>{document.title}</h3>
                <p className={styles.summary}>{document.summary}</p>
                <ul>
                  {document.details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
                <Link href={document.href}>{document.cta}<span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>

          <aside className={styles.contactCard}>
            <div>
              <p className={styles.label}>QUESTIONS OR PRIVACY REQUESTS</p>
              <h2>Use your existing Ajani channel.</h2>
            </div>
            <p>For an active project, use the communication channel or contact listed in your proposal so the request can be tied to the right account and agreement.</p>
          </aside>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}
