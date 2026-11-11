import type { Metadata } from "next";
import Link from "next/link";
import { LegalSwitcher } from "@/components/legal/legal-switcher";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import { LEGAL_EFFECTIVE_DATE_LABEL } from "@/lib/legal/policy-versions";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Acceptable Use & Client Communications · Ajani Automation",
  description: "Rules for safe, lawful use of Ajani systems and automated communications.",
};

const sections = [
  ["principles", "Core rules"],
  ["security", "Security and abuse"],
  ["communications", "Client communications"],
  ["recordings", "Recordings and consent"],
  ["high-impact", "High-impact uses"],
  ["regulated", "Regulated data"],
  ["client-controls", "Client controls"],
  ["enforcement", "Enforcement and reporting"],
] as const;

export default function AcceptableUsePage() {
  return (
    <div className={styles.shell}>
      <SiteTop />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <p className={styles.label}>AJANI / LEGAL</p>
              <h1>Acceptable <em>Use.</em></h1>
            </div>
            <div className={styles.heroNote}>
              <span>Effective {LEGAL_EFFECTIVE_DATE_LABEL}</span>
              <p>Safety, consent, and human-control rules for Ajani services and client communications.</p>
              <LegalSwitcher className={styles.legalSwitcher} current="terms" />
            </div>
          </div>
        </section>

        <section className={styles.termsLayout}>
          <aside className={styles.summary}>
            <p className={styles.label}>OPERATING STANDARD</p>
            <p>This Policy is part of the Terms of Service. It applies to website tools, client systems, connected accounts, and anyone acting through an Ajani workspace.</p>
            <nav aria-label="Acceptable use sections">
              {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </aside>

          <article className={styles.document}>
            <section id="principles">
              <p className={styles.sectionNumber}>01</p>
              <h2>Use Ajani for legitimate, authorized work</h2>
              <p>You may use Ajani only for lawful business purposes and only with data, accounts, systems, recipients, and instructions you are authorized to use. You must not use Ajani to violate law, another person&apos;s rights, a platform rule that applies to you, or a contract that governs a connected service.</p>
              <p>Do not use Ajani to facilitate fraud, deception, harassment, stalking, exploitation, discrimination, violence, or other material harm; impersonate a person or organization; conceal the source or commercial nature of a message; or create false evidence of a live system, client result, endorsement, or human action.</p>
            </section>

            <section id="security">
              <p className={styles.sectionNumber}>02</p>
              <h2>Security and service integrity</h2>
              <p>Do not introduce malware, probe or bypass security, scrape or access accounts without authorization, interfere with service operation, overwhelm an endpoint, reverse engineer protected components except where law permits, expose credentials, or help another person do any of those things.</p>
              <p>Promptly report suspected unauthorized access, exposed credentials, abusive automation, or a security weakness to <a href="mailto:olakunleajani@ajaniautomation.com?subject=Security%20report">olakunleajani@ajaniautomation.com</a>. Do not publicly disclose a vulnerability before Ajani has a reasonable opportunity to investigate and reduce harm.</p>
            </section>

            <section id="communications">
              <p className={styles.sectionNumber}>03</p>
              <h2>Calls, texts, emails, and direct messages</h2>
              <p>Before a workflow contacts someone, the client must have the legal right and any required consent to contact that person through that channel for that purpose. Recipient lists must be current and lawfully obtained. Sender identity, subject lines, caller information, message content, timing, and frequency must be accurate and not misleading.</p>
              <p>Clients must maintain and apply do-not-contact, suppression, and revocation records; include required identification and opt-out instructions; promptly honor STOP, unsubscribe, and other valid revocations; and comply with applicable calling hours, frequency limits, telemarketing, do-not-call, email, carrier, and platform rules.</p>
              <p>Ajani may require consent records or campaign details before enabling a route. Approval by Ajani does not replace the client&apos;s legal review, and neither party may contract away duties that law places on its own conduct.</p>
            </section>

            <section id="recordings">
              <p className={styles.sectionNumber}>04</p>
              <h2>Voice, calls, and recording consent</h2>
              <p>The public recorder is intended for your own narration. Do not record or upload another speaker, a phone call, a meeting, or confidential audio unless you have provided all required notice and obtained all required permission in every applicable jurisdiction.</p>
              <p>A client system that records, transcribes, analyzes, or generates voice requires a project-specific review of consent, disclosure, retention, access, and vendor obligations before launch. Do not use Ajani to identify a person from their voice or create a biometric voiceprint unless Ajani has expressly approved a separate written process.</p>
            </section>

            <section id="high-impact">
              <p className={styles.sectionNumber}>05</p>
              <h2>Human review and high-impact decisions</h2>
              <p>AI or automated output may not be the sole basis for a decision that determines a person&apos;s eligibility, access, rights, or treatment in healthcare, employment, housing, education, credit, lending, insurance, legal services, government benefits, or another similarly significant area.</p>
              <p>Clients must designate accountable people, verify material output, monitor live workflows, provide an appropriate appeal or human-contact path, and maintain a fallback for failures. Ajani systems are not emergency services and must not be the sole route for emergency, clinical, safety-critical, or legally required communication.</p>
            </section>

            <section id="regulated">
              <p className={styles.sectionNumber}>06</p>
              <h2>Sensitive and regulated information</h2>
              <p>Do not place protected health information, full payment-card numbers, government identifiers, biometric templates, precise credentials, children&apos;s data, or other regulated or highly sensitive information into the public intake or a general-purpose AI route.</p>
              <p>A project may process regulated information only after Ajani confirms in writing that the use case, provider chain, security controls, data-processing terms, and any required industry addendum are approved. A warning or client instruction cannot make an unapproved provider eligible for regulated data.</p>
            </section>

            <section id="client-controls">
              <p className={styles.sectionNumber}>07</p>
              <h2>Controls clients must maintain</h2>
              <ul>
                <li>Accurate business rules, lawful source data, and current recipient permissions.</li>
                <li>Named owners for approvals, exceptions, escalations, and human handoffs.</li>
                <li>Least-privilege credentials and prompt removal of former team members.</li>
                <li>Testing before launch, ongoing monitoring, and documented fallback procedures.</li>
                <li>Records supporting consent, opt-outs, claims, client instructions, and required notices.</li>
                <li>Prompt reporting of errors, complaints, unauthorized use, or changed legal requirements.</li>
              </ul>
            </section>

            <section id="enforcement">
              <p className={styles.sectionNumber}>08</p>
              <h2>Review, restriction, and reporting</h2>
              <p>Ajani may investigate suspected violations; request information or evidence; pause a message, integration, or workflow; restrict access; or terminate use when reasonably necessary to protect people, clients, providers, platforms, or Ajani. Ajani will ordinarily give notice and an opportunity to correct a non-urgent issue when appropriate.</p>
              <p>Report suspected abuse to <a href="mailto:olakunleajani@ajaniautomation.com?subject=Acceptable%20use%20report">olakunleajani@ajaniautomation.com</a>. Include the affected workflow or account, what occurred, and any time-sensitive risk. Ajani may preserve relevant records while investigating or meeting legal duties.</p>
            </section>

            <section className={styles.relatedDocument}>
              <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
              <h2>Terms of Service</h2>
              <p>The Terms explain project formation, client responsibilities, ownership, third-party services, warranties, and liability.</p>
              <Link href="/terms">Read the Terms <span aria-hidden="true">→</span></Link>
            </section>
          </article>
        </section>
      </main>
      <SiteFoot />
    </div>
  );
}
