import type { Metadata } from "next";
import Link from "next/link";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · Ajani Automation",
  description: "How Ajani Automation collects, uses, protects, retains, and deletes personal information.",
};

const sections = [
  ["scope", "Scope"],
  ["information", "Information collected"],
  ["use", "How information is used"],
  ["ai", "AI and transcription"],
  ["providers", "Service providers"],
  ["cookies", "Cookies and storage"],
  ["security", "Security"],
  ["retention", "Retention and deletion"],
  ["choices", "Your choices"],
] as const;

export default function PrivacyPage() {
  return (
    <div className={styles.shell}>
      <SiteTop />

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <p className={styles.label}>AJANI / LEGAL</p>
              <h1>Privacy <em>Policy.</em></h1>
            </div>
            <div className={styles.heroNote}>
              <span>Effective August 26, 2026</span>
              <p>How Ajani collects, uses, shares, secures, retains, and deletes personal information.</p>
              <nav aria-label="Legal documents" className={styles.legalSwitcher}>
                <Link href="/legal">Overview</Link>
                <Link href="/terms">Terms</Link>
                <Link aria-current="page" href="/privacy">Privacy</Link>
              </nav>
            </div>
          </div>
        </section>

        <section className={styles.termsLayout}>
          <aside className={styles.summary}>
            <p className={styles.label}>PRIVACY AT A GLANCE</p>
            <p>Ajani uses information to operate accounts, review requests, deliver automation work, secure the service, and meet legal obligations. Ajani does not sell personal information or customer submissions.</p>
            <nav aria-label="Privacy sections">
              {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </aside>

          <article className={styles.document}>
            <section id="scope">
              <p className={styles.sectionNumber}>01</p>
              <h2>Scope of this policy</h2>
              <p>This Privacy Policy applies to the Ajani website, account and authentication features, voice-note and written-request flow, client portal, and related service communications. It explains what Ajani collects, why it is used, when service providers receive it, and how retention and deletion work.</p>
            </section>

            <section id="information">
              <p className={styles.sectionNumber}>02</p>
              <h2>Information Ajani collects</h2>
              <p><strong>Information you provide</strong> may include your name, business name, email address, phone number, organization and account details, written requests, voice recordings, confirmed written versions, clarification answers, proposed system routes, project communications, documents, approvals, and billing or transaction information.</p>
              <p><strong>Information collected during use</strong> may include IP-derived security fingerprints, browser and device information, session and authentication events, request timestamps, error and operational logs, and interactions needed to prevent abuse and keep the service reliable. Ajani does not currently place third-party advertising pixels or behavioral-advertising analytics on its public pages.</p>
            </section>

            <section id="use">
              <p className={styles.sectionNumber}>03</p>
              <h2>How the information is used</h2>
              <p>Ajani uses information to create and secure accounts, receive and review requests, prepare and deliver automation work, maintain the client workspace, communicate about projects, process approved payments, prevent abuse, troubleshoot the service, meet legal obligations, and improve the reliability of Ajani&apos;s own processes. Ajani does not sell personal information or customer submissions.</p>
            </section>

            <section id="ai">
              <p className={styles.sectionNumber}>04</p>
              <h2>AI, transcription, and automated processing</h2>
              <p>Before a request is saved, Ajani may send the written note through Vercel AI Gateway or directly to an AI model provider such as Anthropic to suggest clarification questions. After you confirm those answers, the note and answers may be processed again to propose an editable workflow, outcome, and email brief. If an AI provider is unavailable, a local rules-based fallback keeps the flow usable. When you save a completed request, Ajani may also process the written request, confirmed answers, development brief, and proposed workflow steps to classify the business type and requested automation outcome for internal demand reporting. Ajani records provider, model, prompt version, status, and aggregate classification details so that processing is auditable.</p>
              <p>When you finish a voice note, the audio is sent securely to Ajani&apos;s server and Deepgram to create the editable transcript shown in Clarify. The audio is not placed in browser storage. It is saved to Ajani&apos;s private voice-upload storage only when you approve the handoff. You can correct the transcript before continuing or use the written option instead.</p>
              <p>Client projects may use artificial-intelligence, transcription, classification, or generation services when the proposed system calls for them. Ajani uses those services only for the requested workflow, with appropriate human review and the safeguards agreed for the project. Ajani does not intentionally use customer submissions to train a public-facing AI model. AI-assisted outputs can be wrong and should not be used as the sole basis for legal, medical, financial, employment, or similarly high-impact decisions.</p>
            </section>

            <section id="providers">
              <p className={styles.sectionNumber}>05</p>
              <h2>Service providers and third-party collection</h2>
              <p>Ajani shares information only as needed with service providers that operate the product or a client-approved workflow. Current categories include Clerk for authentication; Google or GitHub when you choose their sign-in method; Supabase for database and private file storage; hosting, security, and infrastructure providers; YouTube for the privacy-enhanced testimonial embed; the browser or operating-system provider when its built-in speech-recognition feature is available; payment processors when billing is activated; and transcription or AI providers when a requested workflow enables them.</p>
              <p>Those providers may receive standard network data such as an IP address, device information, cookies, or authentication identifiers in addition to the information required for their function. Their own terms and privacy notices govern their independent processing. Ajani may also disclose information when required by law, to protect rights or security, in connection with a business transfer, or with your direction or consent.</p>
            </section>

            <section id="cookies">
              <p className={styles.sectionNumber}>06</p>
              <h2>Cookies and local browser storage</h2>
              <p>Ajani and its authentication providers use cookies or similar technologies that are necessary for sign-in, session security, fraud prevention, and account operation. The recorder stores non-audio, unfinished form progress in session storage so a refresh in the same tab does not erase it. Raw recording blobs are not placed in browser storage. Embedded content, including YouTube&apos;s privacy-enhanced player, may still receive network and device information when it loads or when you interact with it.</p>
            </section>

            <section id="security">
              <p className={styles.sectionNumber}>07</p>
              <h2>Private storage and security</h2>
              <p>User voice uploads are stored in a Supabase bucket explicitly configured as private, not public. The browser receives a narrowly scoped, signed upload capability; there is no anonymous client policy that permits people to list or read the bucket. Ajani also uses randomized object paths, file-size and media-type limits, server-side container checks, hashed draft capabilities, access controls, and encrypted transport. No security measure can guarantee absolute protection, so do not submit passwords, payment-card data, protected health information, or other regulated information unless Ajani has approved a specific secure process in writing.</p>
            </section>

            <section id="retention">
              <p className={styles.sectionNumber}>08</p>
              <h2>Retention and deletion</h2>
              <p>Unfinished progress kept only in the browser session remains until the tab or browser session clears it, or until the request is saved. Unclaimed saved requests and their voice uploads expire after 30 days and are removed by a daily cleanup process, ordinarily during the next cleanup run after expiration. An unclaimed draft and its upload can also be deleted using its private draft capability.</p>
              <p>After a request is claimed or becomes a client project, Ajani keeps account, project, approval, billing, and support records for as long as reasonably necessary to provide the service, protect the parties, resolve disputes, enforce agreements, and meet tax or legal requirements. Provider backups and security logs may persist for a limited period after deletion. Ajani will delete or de-identify information when it is no longer reasonably needed, subject to legal and contractual retention duties.</p>
            </section>

            <section id="choices">
              <p className={styles.sectionNumber}>09</p>
              <h2>Your choices and requests</h2>
              <p>You may ask to access, correct, export, or delete personal information, object to or restrict certain processing, or withdraw consent where consent is the legal basis. Ajani may need to verify your identity and may retain information that the law or a binding agreement requires. Send a privacy request through the communication channel used for your project or the contact details in your Ajani proposal. Ajani does not knowingly offer the service to children under 13 or intentionally collect their personal information.</p>
            </section>

            <section className={styles.relatedDocument}>
              <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
              <h2>Terms of Service</h2>
              <p>The Terms of Service cover account access, client projects, acceptable use, ownership, warranties, and liability.</p>
              <Link href="/terms">Read the Terms of Service <span aria-hidden="true">→</span></Link>
            </section>
          </article>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}
