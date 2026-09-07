import type { Metadata } from "next";
import Link from "next/link";
import { LegalSwitcher } from "@/components/legal/legal-switcher";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import { LEGAL_EFFECTIVE_DATE_LABEL } from "@/lib/legal/policy-versions";
import styles from "./terms.module.css";

export const metadata: Metadata = {
  title: "Terms of Service · Ajani Automation",
  description: "The terms that govern Ajani's website, request tools, workspace, and automation services.",
};

const sections = [
  ["agreement", "Agreement and eligibility"],
  ["services", "Services and documents"],
  ["requests", "Build requests"],
  ["accounts", "Accounts"],
  ["content", "Content and recordings"],
  ["ai", "AI and human review"],
  ["responsibilities", "Client responsibilities"],
  ["communications", "Communications automation"],
  ["regulated-data", "Regulated data"],
  ["payment", "Payment and renewal"],
  ["ownership", "Ownership and confidentiality"],
  ["third-parties", "Third-party services"],
  ["acceptable-use", "Acceptable use"],
  ["warranties", "Warranties"],
  ["liability", "Liability and indemnity"],
  ["termination", "Suspension and termination"],
  ["disputes", "Disputes and general terms"],
  ["changes", "Changes, contact, access"],
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
              <span>Effective {LEGAL_EFFECTIVE_DATE_LABEL}</span>
              <p>Clear expectations for using the Ajani website, request tools, private workspace, and automation services.</p>
              <LegalSwitcher className={styles.legalSwitcher} current="terms" />
            </div>
          </div>
        </section>

        <section className={styles.termsLayout}>
          <aside className={styles.summary}>
            <p className={styles.label}>PLAIN-LANGUAGE GUIDE</p>
            <p>These Terms set the baseline for the website and request process. A signed proposal, statement of work, order form, or other project agreement controls the commercial details of paid work.</p>
            <nav aria-label="Terms sections">
              {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </aside>

          <article className={styles.document}>
            <section id="agreement">
              <p className={styles.sectionNumber}>01</p>
              <h2>Agreement, business use, and eligibility</h2>
              <p>These Terms of Service are an agreement between you and Ajani Automation (&ldquo;Ajani,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). They govern your access to the Ajani website, interactive demonstrations, account features, voice-note and request tools, client workspace, and related services.</p>
              <p>You must be at least 18 years old and have legal capacity to use the account and request tools. Ajani is offered for legitimate business use. If you act for an organization, you represent that you are authorized to accept these Terms and submit information for that organization.</p>
              <p>You accept the version presented to you when you affirmatively select a control accompanied by a notice that links to these Terms. If you do not agree, do not create an account or submit a request.</p>
            </section>

            <section id="services">
              <p className={styles.sectionNumber}>02</p>
              <h2>Services and document order</h2>
              <p>Ajani helps businesses identify repetitive or unreliable work and design, build, and support automation systems around that work. Website descriptions, interactive simulations, timelines, and examples are informational illustrations unless a signed project document expressly makes a commitment binding.</p>
              <p>A proposal, statement of work, order form, or similar written agreement (an &ldquo;Order&rdquo;) controls project scope, deliverables, fees, acceptance, delivery commitments, support, and project-specific ownership. A signed data-processing addendum controls covered personal-data obligations, and a signed business associate agreement controls protected health information. Those documents control if they conflict with these Terms on their subject matter.</p>
            </section>

            <section id="requests">
              <p className={styles.sectionNumber}>03</p>
              <h2>Build requests are requests for evaluation</h2>
              <p>A submitted note, proposed route, or approved build brief asks Ajani to evaluate potential work. It is not Ajani&apos;s acceptance of a project, a promise to deploy an automation, or authorization to charge you. A paid engagement begins only when Ajani and the client accept an Order.</p>
              <p>Delivery windows begin only after the applicable scope, access, content, payment, decisions, and third-party approvals are confirmed. Customer delay, scope changes, vendor review, security requirements, or provider outages may change an estimate. Ajani does not guarantee a particular revenue, savings, conversion rate, response time, or other business result.</p>
            </section>

            <section id="accounts">
              <p className={styles.sectionNumber}>04</p>
              <h2>Accounts and organization access</h2>
              <p>Provide accurate information, keep credentials secure, use an individual account rather than sharing credentials, and promptly report suspected unauthorized access. You are responsible for activity through your account except to the extent applicable law says otherwise.</p>
              <p>Organization administrators may invite or remove members and may be able to access information submitted for that organization. Your organization is responsible for maintaining current access and promptly offboarding people who should no longer have access.</p>
            </section>

            <section id="content">
              <p className={styles.sectionNumber}>05</p>
              <h2>Customer content, permissions, and recordings</h2>
              <p>You retain ownership of information, recordings, documents, instructions, and other materials you submit (&ldquo;Customer Content&rdquo;). You grant Ajani a nonexclusive license to host, copy, transmit, transcribe, format, and otherwise process Customer Content only as reasonably necessary to evaluate your request; provide, secure, and support the services; use contracted service providers for those purposes; and comply with law.</p>
              <p>You represent that you have the rights and authority needed to provide Customer Content and personal information. The public voice-note feature is intended for your own narration. Do not record or upload another person, a call, or a confidential communication unless you have provided every legally required notice and obtained every legally required permission.</p>
              <p>Do not submit passwords, full payment-card numbers, protected health information, government identifiers, biometric templates, or other regulated or highly sensitive information through the public request tools.</p>
            </section>

            <section id="ai">
              <p className={styles.sectionNumber}>06</p>
              <h2>AI-assisted suggestions and human review</h2>
              <p>Ajani may use artificial intelligence and rules-based systems to suggest questions, summarize Customer Content, classify a request, and propose an editable workflow. These outputs are probabilistic, may be incomplete or wrong, and remain preliminary until reviewed.</p>
              <p>Your approval authorizes Ajani to evaluate the proposed route; it does not deploy the route or authorize a charge. Before live use, the client must verify inputs, rules, recipients, permissions, and outputs; designate people to receive and act on handoffs; and maintain appropriate monitoring and fallback procedures.</p>
              <p>Ajani outputs are not legal, medical, financial, employment, insurance, tax, or other professional advice. The services may not be used as the sole basis for decisions that determine a person&apos;s legal rights, healthcare, employment, housing, credit, insurance, or similarly significant interests.</p>
            </section>

            <section id="responsibilities">
              <p className={styles.sectionNumber}>07</p>
              <h2>Client responsibilities and dependencies</h2>
              <p>You are responsible for accurate business rules, timely decisions, lawful accounts and licenses, current access credentials, client-controlled content, and people assigned to required human handoffs. You must review a workflow before launch and monitor its operation after launch.</p>
              <p>When you ask Ajani to connect a third-party system, you authorize Ajani to access and operate that system only to perform the agreed workflow and represent that you have authority to grant that access.</p>
            </section>

            <section id="communications">
              <p className={styles.sectionNumber}>08</p>
              <h2>Calls, texts, emails, and other communications</h2>
              <p>For any workflow that sends or initiates calls, texts, emails, direct messages, or similar communications, the client determines the lawful recipients, purpose, content, timing, and frequency. The client must maintain all required consents and permissions, accurate sender information, current suppression and do-not-contact records, and a working process that promptly honors revocation and opt-out requests.</p>
              <p>Ajani may require evidence of consent, limit a campaign, or suspend a workflow that presents legal, platform, security, or reputational risk. Each party remains responsible for laws that apply to its own conduct; these Terms do not transfer a legal duty that cannot lawfully be transferred.</p>
            </section>

            <section id="regulated-data">
              <p className={styles.sectionNumber}>09</p>
              <h2>Regulated and safety-critical workflows</h2>
              <p>Ajani will process protected health information or other regulated data for a project only after the parties sign the required Order and addendum and Ajani confirms that the configured systems and providers are approved for that use. The general website and public request tools are not an approved channel for that information.</p>
              <p>Ajani systems are not emergency services and must not be the sole method for requesting or delivering emergency, clinical, safety-critical, or legally required communications. Ajani does not diagnose, provide medical advice, or make clinical decisions.</p>
            </section>

            <section id="payment">
              <p className={styles.sectionNumber}>10</p>
              <h2>Fees, renewals, cancellation, and refunds</h2>
              <p>Ajani does not charge you for submitting or approving a public build request. Fees, deposits, payment milestones, taxes, cancellation rights, and refunds for a project will be disclosed in the applicable Order before payment is requested.</p>
              <p>Ajani does not currently offer online automatic-renewal checkout. Before any automatically renewing service is activated, the purchase flow or Order must disclose the amount, billing frequency, renewal term, cancellation deadline, and cancellation method and must support the consent, confirmation, notices, and cancellation process required by applicable law. Cancellation would stop future renewal but would not retroactively refund amounts already earned or paid unless the Order or law requires otherwise.</p>
            </section>

            <section id="ownership">
              <p className={styles.sectionNumber}>11</p>
              <h2>Ownership, confidentiality, and feedback</h2>
              <p>Each party retains the materials, brands, data, methods, systems, and intellectual property it owned before a project. Ajani retains its reusable tools, templates, components, processes, and general know-how. The applicable Order defines ownership or licensing of project-specific deliverables.</p>
              <p>Each party will use reasonable care to protect the other party&apos;s nonpublic business, technical, and commercial information and use it only to perform or receive the services. This duty does not cover information lawfully public, independently developed, already known without restriction, or lawfully received from another source. Required legal disclosure is permitted, with advance notice where legally allowed.</p>
              <p>If you voluntarily provide product feedback, Ajani may use it without restriction or payment, provided Ajani does not identify you publicly without permission.</p>
            </section>

            <section id="third-parties">
              <p className={styles.sectionNumber}>12</p>
              <h2>Third-party services</h2>
              <p>Ajani depends on third-party hosting, authentication, storage, transcription, AI, communications, payment, and integration providers. Those services may change, suspend, or discontinue features and may impose separate terms, fees, or limits.</p>
              <p>Ajani is not responsible for a third party&apos;s independent acts or availability, but remains responsible for Ajani&apos;s own obligations under these Terms and an applicable Order. Current provider categories are described in the <Link href="/privacy">Privacy Policy</Link> and <Link href="/subprocessors">Service Providers &amp; Subprocessors list</Link>.</p>
            </section>

            <section id="acceptable-use">
              <p className={styles.sectionNumber}>13</p>
              <h2>Acceptable use</h2>
              <p>You may not use Ajani to violate law or rights; send unlawful, deceptive, or unconsented communications; distribute malware; gain unauthorized access; evade security controls; facilitate fraud or harassment; create unsafe or discriminatory systems; or misrepresent an interactive simulation as a live result.</p>
              <p>The complete <Link href="/acceptable-use">Acceptable Use &amp; Client Communications Policy</Link> is incorporated into these Terms.</p>
            </section>

            <section id="warranties">
              <p className={styles.sectionNumber}>14</p>
              <h2>Service warranty and disclaimers</h2>
              <p>Ajani will provide paid professional services with reasonable care and skill. Any additional warranty or remedy will appear in the applicable Order.</p>
              <p>Except for express commitments in a signed Order and rights that cannot legally be excluded, the website, account tools, interactive simulations, preliminary outputs, and third-party integrations are provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; Ajani does not warrant uninterrupted operation, error-free output, continued third-party availability, or a particular business result.</p>
            </section>

            <section id="liability">
              <p className={styles.sectionNumber}>15</p>
              <h2>Limitation of liability and third-party claims</h2>
              <p>To the fullest extent permitted by law, Ajani will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, goodwill, data, or business opportunities. Ajani&apos;s total liability arising from a paid service will not exceed the amount paid to Ajani for the affected service during the six months before the event giving rise to the claim.</p>
              <p>You will defend and indemnify Ajani against a third-party claim arising from Customer Content you had no right to provide, your unlawful communications or recording practices, or your material violation of these Terms, except to the extent the claim was caused by Ajani. Ajani will provide reasonably prompt notice and reasonable cooperation; no settlement may impose fault, payment, or a continuing obligation on Ajani without Ajani&apos;s written consent.</p>
              <p>These limits do not exclude liability or remedies that applicable law does not allow the parties to limit or exclude.</p>
            </section>

            <section id="termination">
              <p className={styles.sectionNumber}>16</p>
              <h2>Suspension and termination</h2>
              <p>Ajani may immediately restrict access when reasonably necessary to address unlawful use, a security threat, third-party platform risk, nonpayment, or a risk of material harm. For other material breaches, Ajani will ordinarily provide notice and a reasonable opportunity to cure where appropriate.</p>
              <p>On termination, account access and connected credentials may be revoked. Any export period in an Order applies, and information is retained or deleted under the Privacy Policy. Accrued payment obligations and provisions that by nature should survive—including ownership, confidentiality, disclaimers, liability limits, and misuse restrictions—remain effective.</p>
            </section>

            <section id="disputes">
              <p className={styles.sectionNumber}>17</p>
              <h2>Disputes and general terms</h2>
              <p>Before filing a formal claim, contact <a href="mailto:hello@ajaniautomation.com">hello@ajaniautomation.com</a> with a description of the issue and the requested resolution. The parties will try in good faith to resolve it informally for 30 days. A signed Order controls any governing-law, venue, or dispute provision for that project; otherwise, applicable law and the rules of a court with lawful jurisdiction apply.</p>
              <p>You may not assign these Terms without Ajani&apos;s written consent, except in a merger or sale of substantially all relevant assets. Ajani may assign them in connection with a reorganization, merger, or sale. Neither party is responsible for delay caused by events outside reasonable control. If a provision is unenforceable, the remainder stays effective. Failure to enforce a provision is not a waiver.</p>
            </section>

            <section id="changes">
              <p className={styles.sectionNumber}>18</p>
              <h2>Changes, notices, contact, and accessibility</h2>
              <p>Ajani may update these Terms prospectively. The effective date identifies the current version. Any direct notice or renewed acceptance required by applicable law must be completed before Ajani enforces the change against that user. A change does not retroactively alter a signed Order or a dispute that arose before the change took effect.</p>
              <p>Questions, formal notices, or accessibility requests may be sent to <a href="mailto:hello@ajaniautomation.com">hello@ajaniautomation.com</a>. If you cannot use part of the website, Ajani will work with you to provide a reasonable alternative intake or document format.</p>
            </section>

            <section className={styles.relatedDocument}>
              <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
              <h2>Privacy Policy</h2>
              <p>The Privacy Policy explains what information Ajani collects, where providers fit, and how privacy requests work.</p>
              <Link href="/privacy">Read the Privacy Policy <span aria-hidden="true">→</span></Link>
            </section>
          </article>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}
