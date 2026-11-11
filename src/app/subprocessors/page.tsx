import type { Metadata } from "next";
import Link from "next/link";
import { LegalSwitcher } from "@/components/legal/legal-switcher";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import { LEGAL_EFFECTIVE_DATE_LABEL } from "@/lib/legal/policy-versions";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Service Providers & Subprocessors · Ajani Automation",
  description: "A dated list of core providers used by Ajani's website and request workflow.",
};

const providers = [
  { name: "Vercel", purpose: "Website hosting, delivery, infrastructure security, and AI Gateway routing", data: "Network and device data; request content when AI Gateway is used", use: "Core / conditional AI" },
  { name: "Clerk", purpose: "Authentication, account sessions, organization membership, fraud prevention, and account security", data: "Identity, contact, network, device, cookie, session, security-event, and organization data", use: "Core when account features are configured" },
  { name: "Supabase", purpose: "Database, private file storage, and service operations", data: "Account, request, project, workflow, event, and saved voice-recording data", use: "Core" },
  { name: "Deepgram", purpose: "Voice-note transcription", data: "Audio, transcript, language, confidence, duration, and request metadata", use: "When voice is used" },
  { name: "Anthropic", purpose: "AI-assisted questions, workflow drafting, and classification", data: "Written request, confirmed answers, proposed workflow, and related context", use: "When AI processing is used" },
  { name: "Resend", purpose: "Internal request-routing email", data: "Contact details and the implementation brief needed to route a request", use: "When an internal request notification is sent" },
  { name: "Stripe", purpose: "Payment, subscription, and invoice processing", data: "Billing identifiers, amount, currency, status, and payment metadata", use: "Inactive unless billing is activated" },
] as const;

const independentServices = [
  { name: "Google", purpose: "Optional OAuth sign-in selected by the user", data: "Authentication and account identifiers under Google's own notice" },
  { name: "GitHub", purpose: "Optional OAuth sign-in selected by the user", data: "Authentication and account identifiers under GitHub's own notice" },
  { name: "YouTube", purpose: "Privacy-enhanced client-story video", data: "Network, device, and interaction information when embedded content loads or is used" },
  { name: "Browser or operating-system speech service", purpose: "Optional live speech recognition", data: "Speech and recognition data under the browser or operating-system provider's terms" },
] as const;

const sections = [
  ["scope", "How to read this list"],
  ["processors", "Core providers"],
  ["independent", "User-selected services"],
  ["client", "Client-specific providers"],
  ["changes", "Changes and questions"],
] as const;

export default function SubprocessorsPage() {
  return (
    <div className={styles.shell}>
      <SiteTop />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <p className={styles.label}>AJANI / TRUST</p>
              <h1>Service providers <em>&amp; subprocessors.</em></h1>
            </div>
            <div className={styles.heroNote}>
              <span>Current as of {LEGAL_EFFECTIVE_DATE_LABEL}</span>
              <p>A practical inventory of the core companies that help operate Ajani&apos;s website, accounts, request flow, and client workspace.</p>
              <LegalSwitcher className={styles.legalSwitcher} current="privacy" />
            </div>
          </div>
        </section>

        <section className={styles.termsLayout}>
          <aside className={styles.summary}>
            <p className={styles.label}>PROVIDER INVENTORY</p>
            <p>Not every provider receives every request. The last column explains when a provider is used. A client Order or data-processing addendum may list additional project-specific providers.</p>
            <nav aria-label="Provider list sections">
              {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </aside>

          <article className={styles.document}>
            <section id="scope">
              <p className={styles.sectionNumber}>01</p>
              <h2>How to read this list</h2>
              <p>A service provider processes information to provide an operational function to Ajani. A subprocessor is a provider Ajani uses when processing personal information for a client. A user-selected or embedded service may act independently for its own account, platform, security, or media purposes.</p>
              <p>This page identifies the role a provider performs in the current product. It does not mean every provider receives all categories of information or participates in every client system.</p>
            </section>

            <section id="processors">
              <p className={styles.sectionNumber}>02</p>
              <h2>Core and conditional providers</h2>
              <div className={styles.providerList}>
                {providers.map((provider) => (
                  <article key={provider.name}>
                    <header><h3>{provider.name}</h3><span>{provider.use}</span></header>
                    <p><strong>Function.</strong> {provider.purpose}</p>
                    <p><strong>Information.</strong> {provider.data}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="independent">
              <p className={styles.sectionNumber}>03</p>
              <h2>User-selected and embedded services</h2>
              <div className={styles.providerList}>
                {independentServices.map((provider) => (
                  <article key={provider.name}>
                    <header><h3>{provider.name}</h3><span>Conditional</span></header>
                    <p><strong>Function.</strong> {provider.purpose}</p>
                    <p><strong>Information.</strong> {provider.data}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="client">
              <p className={styles.sectionNumber}>04</p>
              <h2>Client-specific providers</h2>
              <p>A client automation may connect to communications, scheduling, customer-relationship, payment, document, or industry-specific services selected with that client. Those services and the data they receive must be documented in the applicable Order or data-processing addendum before live processing begins.</p>
              <p>Regulated data requires a separately approved provider chain and contract. The general provider list does not authorize protected health information or other regulated information to enter a public intake or general-purpose AI route.</p>
            </section>

            <section id="changes">
              <p className={styles.sectionNumber}>05</p>
              <h2>Changes and questions</h2>
              <p>Ajani may update this list as the service changes. The date at the top identifies the current version. Where a client agreement requires advance notice or an objection process for a new subprocessor, that agreement controls.</p>
              <p>Questions about a provider or a client&apos;s processing path may be sent to <a href="mailto:olakunleajani@ajaniautomation.com?subject=Provider%20question">olakunleajani@ajaniautomation.com</a>.</p>
            </section>

            <section className={styles.relatedDocument}>
              <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
              <h2>Privacy Policy</h2>
              <p>The Privacy Policy explains the purposes, disclosures, retention, security, and rights that apply to these processing activities.</p>
              <Link href="/privacy">Read the Privacy Policy <span aria-hidden="true">→</span></Link>
            </section>
          </article>
        </section>
      </main>
      <SiteFoot />
    </div>
  );
}
