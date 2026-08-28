import type { Metadata } from "next";
import Link from "next/link";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./terms.module.css";

export const metadata: Metadata = {
  title: "Terms of Service · Ajani Automation",
  description: "The terms that govern use of Ajani Automation's website, account tools, and automation services.",
};

const sections = [
  ["agreement", "Agreement"],
  ["services", "Services"],
  ["accounts", "Accounts"],
  ["submissions", "Your submissions"],
  ["projects", "Projects and payment"],
  ["ownership", "Ownership"],
  ["third-parties", "Third-party services"],
  ["acceptable-use", "Acceptable use"],
  ["warranties", "Warranties and liability"],
  ["termination", "Termination"],
  ["changes", "Changes and contact"],
] as const;

export default function TermsPage() {
  return (
    <div className={styles.shell}>
      <SiteTop />

      <main id="main-content" tabIndex={-1}>

      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div>
            <p className={styles.label}>AJANI / LEGAL</p>
            <h1>Terms of <em>Service.</em></h1>
          </div>
          <div className={styles.heroNote}>
            <span>Effective August 26, 2026</span>
            <p>Clear expectations for using the Ajani website, private workspace, and automation services.</p>
            <nav aria-label="Legal documents" className={styles.legalSwitcher}>
              <Link href="/legal">Overview</Link>
              <Link aria-current="page" href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
            </nav>
          </div>
        </div>
      </section>

      <section className={styles.termsLayout}>
        <aside className={styles.summary}>
          <p className={styles.label}>PLAIN-LANGUAGE GUIDE</p>
          <p>These website terms set the baseline. A signed proposal or service agreement controls the exact scope, pricing, delivery, support, and ownership for a client build.</p>
          <nav aria-label="Terms sections">
            {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
          </nav>
        </aside>

        <article className={styles.document}>
          <section id="agreement">
            <p className={styles.sectionNumber}>01</p>
            <h2>Agreement to these terms</h2>
            <p>These Terms of Service govern your access to and use of the Ajani Automation website, demos, account features, voice-note and request tools, client portal, and related services. By using those services, you agree to these terms.</p>
            <p>If you use Ajani on behalf of a business or other organization, you confirm that you have authority to accept these terms for that organization.</p>
          </section>

          <section id="services">
            <p className={styles.sectionNumber}>02</p>
            <h2>What Ajani provides</h2>
            <p>Ajani helps businesses identify repetitive or unreliable work and design, build, and support automation systems around that work. Website descriptions, demonstrations, timelines, and examples are informational. They are not a binding promise that every project will include the same features or produce the same outcome.</p>
            <p>The deliverables, schedule, fees, support period, and acceptance process for paid work will be stated in a proposal, statement of work, order form, or other written agreement. If that agreement conflicts with these website terms, the signed agreement controls for that project.</p>
          </section>

          <section id="accounts">
            <p className={styles.sectionNumber}>03</p>
            <h2>Accounts and access</h2>
            <p>You must provide accurate information, keep your sign-in credentials secure, and promptly notify Ajani if you believe your account has been accessed without permission. You are responsible for activity performed through your account unless applicable law provides otherwise.</p>
            <p>Ajani may use third-party identity providers to create accounts, verify contact information, and secure sessions. Your use of those providers is also subject to their terms and privacy practices.</p>
          </section>

          <section id="submissions">
            <p className={styles.sectionNumber}>04</p>
            <h2>Voice notes and other submissions</h2>
            <p>You retain ownership of the information, recordings, documents, and other materials you submit. You give Ajani permission to process those materials only as reasonably necessary to review your request, communicate with you, provide the requested services, secure the platform, and meet legal obligations.</p>
            <p>You confirm that you have the right to provide submitted materials and that doing so does not violate another person&apos;s rights. Do not submit passwords, payment-card data, protected health information, or other regulated or highly sensitive information unless Ajani has expressly agreed in writing to handle it through an approved secure process.</p>
          </section>

          <section id="projects">
            <p className={styles.sectionNumber}>05</p>
            <h2>Projects, approval, and payment</h2>
            <p>Ajani will confirm the proposed system, budget, and material assumptions before charging for a build, except where a written agreement says otherwise. You are responsible for timely feedback, access to agreed systems, accurate business rules, and any approvals needed to complete the work.</p>
            <p>Fees, deposits, payment dates, taxes, cancellation rights, refunds, and ongoing service charges are governed by the applicable written proposal or order. Delays in client access, information, or approval may change the delivery schedule.</p>
          </section>

          <section id="ownership">
            <p className={styles.sectionNumber}>06</p>
            <h2>Ownership and permitted use</h2>
            <p>Each party retains ownership of materials, systems, brands, data, methods, and intellectual property it owned before a project. Ajani retains its reusable tools, templates, components, processes, and general know-how. Ownership or licensing of project-specific deliverables will be defined in the applicable written agreement.</p>
            <p>You may not copy, resell, reverse engineer, or exploit the Ajani website or service components except as expressly permitted in writing or allowed by law.</p>
          </section>

          <section id="third-parties">
            <p className={styles.sectionNumber}>07</p>
            <h2>Third-party services and automation</h2>
            <p>Ajani systems may depend on third-party platforms, APIs, communications providers, artificial-intelligence services, and software selected with the client. Those providers may change, suspend, or discontinue their services and may impose separate terms or fees.</p>
            <p>Automation and AI-assisted outputs can be incomplete or incorrect. You remain responsible for reviewing important outputs, maintaining appropriate human oversight, and deciding whether an automated action is suitable for your business, customers, and legal obligations.</p>
          </section>

          <section id="acceptable-use">
            <p className={styles.sectionNumber}>08</p>
            <h2>Acceptable use</h2>
            <p>You may not use Ajani to break the law, infringe rights, send unlawful or deceptive communications, distribute malware, gain unauthorized access, interfere with service operation, evade security controls, or create systems intended to harm, discriminate against, or mislead people.</p>
            <p>Ajani may restrict or suspend access when reasonably necessary to protect users, third parties, the service, or the integrity of connected systems.</p>
          </section>

          <section id="warranties">
            <p className={styles.sectionNumber}>09</p>
            <h2>Warranties and limitation of liability</h2>
            <p>Ajani will provide paid services with reasonable care and skill. Except for express commitments in a written agreement and rights that cannot legally be excluded, the website, demos, and account tools are provided on an “as available” basis without other warranties.</p>
            <p>To the fullest extent permitted by law, Ajani will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, data, or business opportunities. Ajani&apos;s total liability arising from a paid service will not exceed the amount paid to Ajani for the service giving rise to the claim during the six months before the event that created the claim.</p>
          </section>

          <section id="termination">
            <p className={styles.sectionNumber}>10</p>
            <h2>Suspension and termination</h2>
            <p>You may stop using the website or account tools at any time. Ajani may suspend or terminate access for a material breach, unlawful use, security risk, nonpayment, or conduct that could harm Ajani, a client, a user, or a third party.</p>
            <p>Provisions that by their nature should continue—including payment obligations, ownership, disclaimers, liability limits, and restrictions on misuse—survive termination.</p>
          </section>

          <section id="changes">
            <p className={styles.sectionNumber}>11</p>
            <h2>Changes and contact</h2>
            <p>Ajani may update these terms as the service changes. The effective date at the top of this page will identify the current version. Material changes affecting an existing paid engagement will not override a signed agreement unless both parties agree in writing.</p>
            <p>Questions about these terms can be sent using the contact details in your Ajani proposal or through the communication channel used for your project.</p>
          </section>

          <section className={styles.relatedDocument} id="privacy">
            <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
            <h2>Looking for the Privacy Policy?</h2>
            <p>Privacy, data handling, cookies, AI processing, security, and deletion are now organized in a separate document.</p>
            <Link href="/privacy">Read the Privacy Policy <span aria-hidden="true">→</span></Link>
          </section>
        </article>
      </section>

      </main>

      <SiteFoot />
    </div>
  );
}
