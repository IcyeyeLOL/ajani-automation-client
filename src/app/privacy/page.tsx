import type { Metadata } from "next";
import Link from "next/link";
import { LegalSwitcher } from "@/components/legal/legal-switcher";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import { LEGAL_EFFECTIVE_DATE_LABEL } from "@/lib/legal/policy-versions";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · Ajani Automation",
  description: "How Ajani collects, uses, discloses, secures, retains, and deletes personal information.",
};

const sections = [
  ["scope", "Scope and roles"],
  ["notice-at-collection", "Information collected"],
  ["purposes", "Purposes and legal bases"],
  ["voice", "Voice and transcription"],
  ["ai", "AI-assisted processing"],
  ["providers", "Providers and disclosures"],
  ["client-data", "Client-directed data"],
  ["storage", "Cookies and browser storage"],
  ["retention", "Retention"],
  ["security", "Security"],
  ["transfers", "International transfers"],
  ["rights", "Privacy rights"],
  ["state", "U.S. state disclosures"],
  ["children", "Children"],
  ["changes", "Changes and contact"],
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
              <span>Effective {LEGAL_EFFECTIVE_DATE_LABEL}</span>
              <p>How information moves through Ajani, why it is used, which providers receive it, and what choices you have.</p>
              <LegalSwitcher className={styles.legalSwitcher} current="privacy" />
            </div>
          </div>
        </section>

        <section className={styles.termsLayout}>
          <aside className={styles.summary}>
            <p className={styles.label}>PRIVACY AT A GLANCE</p>
            <p>Ajani uses information to operate accounts, evaluate requests, deliver client work, secure the service, and meet legal obligations. Ajani does not sell personal information or customer submissions, and does not share them for cross-context behavioral advertising.</p>
            <nav aria-label="Privacy sections">
              {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </aside>

          <article className={styles.document}>
            <section id="scope">
              <p className={styles.sectionNumber}>01</p>
              <h2>Who this policy covers and Ajani&apos;s role</h2>
              <p>Ajani Automation (&ldquo;Ajani,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the Ajani website, account and authentication features, voice-note and written-request flow, client workspace, and related service communications. For those activities, Ajani decides why and how the personal information described in this Policy is processed.</p>
              <p>When Ajani processes personal information solely on a client&apos;s instructions inside a client automation, that client generally determines the purpose and means of processing and Ajani acts as its processor or service provider. The client&apos;s privacy notice governs that processing. Direct requests about client-system data to the relevant client first; Ajani will assist as required by the applicable agreement and law.</p>
            </section>

            <section id="notice-at-collection">
              <p className={styles.sectionNumber}>02</p>
              <h2>Information Ajani collects and its sources</h2>
              <p>Ajani collects information directly from you; from your browser, device, and interactions with the service; from Clerk and an OAuth provider you select; from an authorized organization administrator; and, for client-directed workflows, from the client that operates the workflow.</p>
              <ul>
                <li><strong>Account and contact information:</strong> name, business name, email, phone, avatar, organization, role, and authentication identifiers.</li>
                <li><strong>Request and project content:</strong> written notes, audio recordings, transcripts, clarification answers, proposed routes, development and email briefs, documents, approvals, project messages, support records, and client-provided business rules.</li>
                <li><strong>Generated and derived information:</strong> suggested questions, summaries, classifications, workflows, provider and model identifiers, prompt versions, confidence, usage, and status metadata.</li>
                <li><strong>Device, security, and operational information:</strong> IP-derived security fingerprints, user agent and device information, timestamps, origin, cookies, session events, request limits, errors, and operational logs.</li>
                <li><strong>Billing information, when enabled:</strong> customer, subscription, invoice, amount, currency, and payment-status metadata. Ajani does not receive full payment-card numbers through the public request flow.</li>
              </ul>
              <p><strong>Notice when you submit a request.</strong> Ajani uses request content, contact details, device and security data, and generated workflow information to transcribe and structure the note, provide the requested intake and project services, prevent abuse, and maintain records. The providers in Section 06 receive only the information needed for their listed functions. Ajani does not sell this information or share it for cross-context behavioral advertising. The retention criteria in Section 09 apply.</p>
            </section>

            <section id="purposes">
              <p className={styles.sectionNumber}>03</p>
              <h2>Why Ajani uses information</h2>
              <p>Ajani uses information to provide requested pre-contract and contract services; create and administer accounts; transcribe and structure requests; suggest an editable route; deliver and support client systems; authenticate users; prevent fraud and abuse; troubleshoot and secure the service; send project and transactional communications; process approved billing; maintain records; comply with law; and improve service operations through limited internal reporting.</p>
              <p>Where European Economic Area or United Kingdom data-protection law applies, Ajani relies on performance of a contract or steps you request before a contract for intake and project services; legitimate interests in security, reliability, support, and limited business administration; legal obligations for required records; and consent where law requires it. You may withdraw consent for future processing at any time, but withdrawal does not make earlier lawful processing unlawful.</p>
            </section>

            <section id="voice">
              <p className={styles.sectionNumber}>04</p>
              <h2>Voice recording and transcription</h2>
              <p>When you choose Start voice note, your browser asks for microphone access. During recording, audio remains in memory in the active tab. If built-in speech recognition is available, your browser or operating-system provider may process speech under its own terms to draft live text.</p>
              <p>When you choose Finish note or Use this note, Ajani may send the audio through its server to Deepgram to create or confirm the editable transcript shown in the request flow, unless you already supplied enough written text. The supported request path requires the current processing acknowledgment before this provider call. Ajani configures Deepgram transcription requests to opt out of Deepgram&apos;s Model Improvement Program. The immediate transcription response is not cached by Ajani&apos;s endpoint.</p>
              <p>If you approve and send a request containing a recording, the original audio is uploaded to private Ajani storage and may be processed again to create or verify a durable transcript. You can edit the transcript before handoff or use the written option instead. Record only yourself unless you have provided all required notice and obtained all required permission from every other speaker.</p>
            </section>

            <section id="ai">
              <p className={styles.sectionNumber}>05</p>
              <h2>AI-assisted processing</h2>
              <p>Before a request is saved, Ajani may send the written note through Vercel AI Gateway or directly to Anthropic to suggest clarification questions. The supported request path requires the current processing acknowledgment before this provider call. After you confirm answers, Ajani may process the note and answers again to propose an editable workflow, outcome, protection statement, and internal email brief. When a request is saved, Ajani may process request context to classify business type and automation outcome for internal demand reporting. A local rules-based fallback keeps the flow usable if an AI provider is unavailable.</p>
              <p>Ajani configures AI Gateway requests to prohibit prompt training. Ajani does not train its own general-purpose model on your request. Direct Anthropic API processing and other provider processing are governed by Ajani&apos;s account settings and provider contracts. Do not submit sensitive or regulated personal information through the public intake.</p>
              <p>AI output can be incomplete or wrong. You can review and edit the proposed route, and a person remains responsible for deciding whether it should be built. Ajani does not use AI output as the sole basis for legal, medical, financial, employment, insurance, housing, credit, or similarly significant decisions.</p>
            </section>

            <section id="providers">
              <p className={styles.sectionNumber}>06</p>
              <h2>Service providers and other disclosures</h2>
              <p>Ajani discloses information only as needed to providers that support the service or a client-approved workflow. Current provider categories include Vercel for hosting, infrastructure, and AI routing; Clerk for authentication; Supabase for databases and private file storage; Deepgram for transcription; Anthropic for AI generation; and Resend for internal request-routing email. Stripe is inactive in the public flow and receives billing information only if billing is activated.</p>
              <p>Google or GitHub receives information when you choose its sign-in method. YouTube receives standard network and device information when its privacy-enhanced embedded player loads or when you interact with it. A browser or operating-system provider may receive speech data when its built-in recognition feature is used. Those services may act independently for their own account, platform, or security purposes.</p>
              <p>Ajani may also disclose information to professional advisers under confidentiality obligations; authorities when legally required; a successor in a merger, financing, reorganization, or sale subject to appropriate safeguards; or another recipient at your direction or with your consent. See the dated <Link href="/subprocessors">Service Providers &amp; Subprocessors list</Link>.</p>
            </section>

            <section id="client-data">
              <p className={styles.sectionNumber}>07</p>
              <h2>Client-directed processing</h2>
              <p>A client automation may process categories of information that are not collected by the public website. Those categories, purposes, instructions, providers, security measures, retention, and deletion terms belong in the client&apos;s Order and, where needed, a data-processing addendum.</p>
              <p>Ajani does not accept protected health information or other regulated data through the general public intake. A regulated workflow requires a written, approved process and the necessary contracts before information enters that workflow.</p>
            </section>

            <section id="storage">
              <p className={styles.sectionNumber}>08</p>
              <h2>Cookies and local browser storage</h2>
              <p>Ajani and Clerk use cookies or similar technologies necessary for authentication, session security, fraud prevention, and account operation. The public intake stores the written note, answers, generated route, current stage, processing-notice acknowledgment version, and a private draft capability in session storage so a refresh in the same tab does not erase the work. Raw recording blobs are not placed in browser storage.</p>
              <p>Session storage normally remains until the browser session closes or Ajani clears it after a completed handoff or deletion; browser behavior can vary. Ajani does not currently use advertising pixels or cross-site behavioral-advertising analytics on its public pages. Privacy-enhanced YouTube content may still receive network and device information when the embed loads.</p>
            </section>

            <section id="retention">
              <p className={styles.sectionNumber}>09</p>
              <h2>Retention and deletion</h2>
              <p>Ajani retains information only for the period reasonably necessary for the purpose described here, subject to legal holds, disputes, security needs, backups, and contractual or legal requirements.</p>
              <ul>
                <li><strong>Unfinished browser-session state:</strong> until submission, deletion, or the browser clears the session.</li>
                <li><strong>Unclaimed saved drafts and voice uploads:</strong> 30 days, then queued for scheduled batch deletion. A processing backlog may delay final removal.</li>
                <li><strong>Public abuse-prevention fingerprints:</strong> 7 days.</li>
                <li><strong>Failed administrative sign-in fingerprints:</strong> 30 days.</li>
                <li><strong>Processed authentication-webhook event metadata:</strong> 90 days.</li>
                <li><strong>Claimed requests, original recordings, account, project, approval, billing, and support records:</strong> for the active relationship and then for the period reasonably needed to provide the service, preserve agreed records, resolve disputes, and meet tax, legal, or contractual duties.</li>
              </ul>
              <p>Provider logs and backups may persist for a limited period after deletion. Deleting a Clerk identity does not automatically erase project records Ajani is legally or contractually required to retain. A verified privacy request initiates review across Ajani and applicable providers.</p>
            </section>

            <section id="security">
              <p className={styles.sectionNumber}>10</p>
              <h2>Security</h2>
              <p>Ajani uses administrative, technical, and organizational safeguards designed to protect personal information. Current measures include access controls, encrypted transport, private storage for voice uploads, scoped upload capabilities, randomized object paths, hashed draft capabilities, input and media validation, request limits, and abuse prevention.</p>
              <p>No system can guarantee absolute security. Do not submit passwords, full payment-card numbers, health information, government identifiers, biometric templates, or other sensitive data through the public request tools. Report a suspected security issue to <a href="mailto:olakunleajani@ajaniautomation.com">olakunleajani@ajaniautomation.com</a>.</p>
            </section>

            <section id="transfers">
              <p className={styles.sectionNumber}>11</p>
              <h2>International processing and transfers</h2>
              <p>Ajani is operated in the United States and uses providers that may process information in the United States and other countries. Those countries may have different data-protection laws from where you live. Before processing that requires an international-transfer mechanism, Ajani must document the mechanism and any supplementary safeguards in its provider or client agreements. Contact Ajani to ask which arrangement applies to a specific processing path.</p>
            </section>

            <section id="rights">
              <p className={styles.sectionNumber}>12</p>
              <h2>Your privacy choices and requests</h2>
              <p>Depending on where you live, you may have rights to know or access, correct, delete, or obtain a portable copy of personal information; object to or restrict processing; withdraw consent; opt out of sale, targeted advertising, or qualifying profiling; and appeal a denied request. Ajani does not discriminate against a person for exercising an applicable privacy right.</p>
              <p>Email <a href="mailto:olakunleajani@ajaniautomation.com?subject=Privacy%20request">olakunleajani@ajaniautomation.com</a> with &ldquo;Privacy request&rdquo; in the subject. You do not need an account. Ajani may verify your identity and authority and may retain or withhold information where law permits or requires it. An authorized agent should identify the person represented and provide evidence of authority. To appeal a decision, reply with &ldquo;Privacy appeal&rdquo; and explain the requested review.</p>
              <p>People in the EEA or UK may also complain to their local supervisory authority. If your request concerns information processed for an Ajani client, Ajani may direct you to that client or assist the client in responding.</p>
            </section>

            <section id="state">
              <p className={styles.sectionNumber}>13</p>
              <h2>U.S. state privacy disclosures</h2>
              <p>The categories collected during the preceding 12 months are described in Section 02; the sources and purposes appear in Sections 02 and 03; and the recipient categories appear in Section 06. Ajani does not sell personal information or share it for cross-context behavioral advertising, and does not offer a financial incentive in exchange for personal information.</p>
              <p>Ajani does not use the public voice feature for speaker identification or to create a voiceprint. The service transcribes the content of a note. Requests to access, correct, delete, or obtain a copy may be submitted through the method in Section 12, subject to verification, legal exceptions, and rights available in your state.</p>
            </section>

            <section id="children">
              <p className={styles.sectionNumber}>14</p>
              <h2>Children</h2>
              <p>Ajani is a business service and is not directed to children. You must be at least 18 to create an account or submit a request. If Ajani learns that personal information was collected from a child contrary to this restriction, contact Ajani and appropriate deletion steps will be taken.</p>
            </section>

            <section id="changes">
              <p className={styles.sectionNumber}>15</p>
              <h2>Changes and contact</h2>
              <p>Ajani may update this Policy as practices or legal obligations change. The effective date identifies the current version. Any direct notice or renewed acknowledgment required by applicable law must be completed before Ajani relies on the change. Changes apply prospectively unless applicable law permits otherwise.</p>
              <p>Questions, privacy requests, security reports, accessibility feedback, or requests for an accessible copy may be sent to <a href="mailto:olakunleajani@ajaniautomation.com">olakunleajani@ajaniautomation.com</a>. Do not include a diagnosis, medical record, password, or other sensitive information in the email. Ajani may request information needed to verify identity, authority, or the location of the relevant record.</p>
            </section>

            <section className={styles.relatedDocument}>
              <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
              <h2>Terms of Service</h2>
              <p>The Terms cover accounts, project formation, recordings, AI review, client responsibilities, communications, payment, and acceptable use.</p>
              <Link href="/terms">Read the Terms of Service <span aria-hidden="true">→</span></Link>
            </section>
          </article>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}
