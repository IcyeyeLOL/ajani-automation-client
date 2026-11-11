import Link from "next/link";
import { RecordNoteAction } from "@/components/record-note-action";
import { Reveal } from "./reveal";
import styles from "./delivery-trust.module.css";

const engagementSteps = [
  {
    marker: "01",
    title: "Start with the process, not a package.",
    detail:
      "Submitting and approving a public build request does not create a charge. The first job is to make the costly process, its owners, and its human decisions visible.",
  },
  {
    marker: "02",
    title: "Review the written scope before payment.",
    detail:
      "A project Order defines the deliverables, fees, acceptance, delivery commitments, support, and project-specific ownership before paid work begins.",
  },
  {
    marker: "03",
    title: "Treat 7–10 days as a target, not a promise.",
    detail:
      "That is the target window shown in Ajani’s request flow. Timing starts after scope, access, content, payment, decisions, and required third-party approvals are confirmed.",
  },
  {
    marker: "04",
    title: "Put ownership and ongoing care in writing.",
    detail:
      "You retain the materials you submit. Ajani retains its pre-existing and reusable tools; the Order defines ownership or licensing for project-specific deliverables and the support that follows launch.",
  },
] as const;

const commercialReadiness = [
  {
    label: "Starting range / pricing model",
    detail: "Not published yet. Add the approved range or project-pricing explanation before launch.",
  },
  {
    label: "Training and handoff",
    detail: "The public repository does not define a training format, session count, or handoff package.",
  },
  {
    label: "Maintenance and post-launch support",
    detail: "Support is controlled by the project Order; publish the standard care options once they are approved.",
  },
] as const;

const securityControls = [
  {
    marker: "Access",
    title: "Accounts and organizations",
    detail:
      "Clerk sessions and organization membership protect account routes. Supabase row-level security separates tenant-owned records.",
  },
  {
    marker: "Credentials",
    title: "Authorized, least-privilege connections",
    detail:
      "A client authorizes access to each connected system for the agreed workflow. Privileged service access stays in trusted server modules, and precise credentials do not belong in the public intake.",
  },
  {
    marker: "Storage",
    title: "Private voice and scoped draft access",
    detail:
      "Voice uploads use private storage and short-lived signed access. Anonymous draft capabilities are random, scoped, and stored as hashes.",
  },
  {
    marker: "Vendors",
    title: "Named service providers",
    detail:
      "Current provider categories include Vercel, Clerk, Supabase, Deepgram, Anthropic, and Resend. A public provider inventory explains what each one does.",
  },
  {
    marker: "Control",
    title: "Logs, approvals, and human owners",
    detail:
      "Operational events and errors are recorded for service operation. The client reviews the proposed route, and sensitive decisions retain named approval, exception, and handoff owners.",
  },
  {
    marker: "Limits",
    title: "Work Ajani will not hand to a black box",
    detail:
      "Automated output cannot be the sole basis for high-impact eligibility, rights, or treatment decisions. The public intake also excludes regulated and highly sensitive data.",
  },
] as const;

const identityGaps = [
  {
    title: "Co-founder profile",
    detail: "Add the co-founder’s name, portrait, role, LinkedIn profile, and the work they personally deliver.",
  },
  {
    title: "Roles and delivery ownership",
    detail: "Confirm each person’s title, relevant background, and day-to-day responsibility before launch.",
  },
  {
    title: "Team photography and location",
    detail: "Supply approved portraits and the public city or operating location Ajani is comfortable publishing.",
  },
  {
    title: "Legal company identity",
    detail: "Confirm the registered entity name and business address or jurisdiction for the public company record.",
  },
] as const;

const frequentlyAsked = [
  {
    question: "What do I need to bring to the first conversation?",
    answer:
      "Bring one process that loses time, leads, context, or follow-through. You can write it down, record it in ordinary language, or email Ajani. You do not need to arrive with a workflow diagram or software specification.",
  },
  {
    question: "Does submitting a request cost anything?",
    answer:
      "No. Ajani’s Terms say there is no charge for submitting or approving a public build request. Any fee, deposit, milestone, cancellation term, or refund term must appear in the applicable written Order before payment is requested.",
  },
  {
    question: "How long does a workflow build take?",
    answer:
      "The current request flow shows a 7–10 day target window. It is an estimate, not a universal commitment. The clock begins only after the agreed scope, access, content, payment, decisions, and third-party approvals are in place.",
  },
  {
    question: "Which tools can Ajani work with?",
    answer:
      "The current integration list includes HubSpot, GoHighLevel, monday.com, Gmail, Microsoft Outlook, custom APIs, and webhooks. The exact connection and permissions are confirmed in the project scope.",
  },
  {
    question: "Who owns the finished system?",
    answer:
      "You retain the content and materials you provide. Ajani retains its pre-existing tools, templates, components, processes, and general know-how. Ownership or licensing of project-specific deliverables is defined in the written Order.",
  },
  {
    question: "What happens after launch?",
    answer:
      "Every workflow needs an owner, monitoring, and a fallback. The project Order defines the agreed support and maintenance. Ajani has not yet published a standard training or ongoing-care package, so those details must be confirmed before launch.",
  },
  {
    question: "How does Ajani handle access and data?",
    answer:
      "Access is limited by account and organization, voice uploads use private storage, and client connections require authorization for the agreed workflow. The Privacy Policy and provider inventory explain the current processing and retention paths in detail.",
  },
  {
    question: "What will Ajani not automate?",
    answer:
      "Ajani does not permit automated output to be the sole basis for high-impact decisions about healthcare, employment, housing, education, credit, insurance, legal services, government benefits, or similar rights. Sensitive or regulated data also does not belong in the public intake.",
  },
] as const;

export function DeliveryTrust() {
  return (
    <div className={styles.root}>
      <section aria-labelledby="engagement-title" className={`${styles.section} ${styles.engagement}`} id="engagement">
        <Reveal className={styles.sectionHead}>
          <div>
            <p className={styles.label}>Commercial engagement</p>
            <h2 id="engagement-title">Know what is agreed <em>before the build begins.</em></h2>
          </div>
          <p className={styles.sectionIntro}>
            The website can explain the operating model, but the written Order is where scope,
            price, delivery, support, and project-specific ownership become commitments.
          </p>
        </Reveal>

        <div className={styles.engagementGrid}>
          {engagementSteps.map((step, index) => (
            <Reveal as="article" className={styles.engagementCard} delay={(index % 2) * 80} key={step.marker}>
              <span>{step.marker}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </Reveal>
          ))}
        </div>

        <Reveal as="aside" className={styles.readiness} delay={90}>
          <div className={styles.readinessHeading}>
            <p className={styles.label}>Pre-launch commercial details</p>
            <strong>Three decisions still need approved public copy.</strong>
          </div>
          <ul>
            {commercialReadiness.map((item) => (
              <li key={item.label}>
                <span>Confirm before launch</span>
                <b>{item.label}</b>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
          <Link href="/terms">Read the current service terms <span aria-hidden="true">→</span></Link>
        </Reveal>
      </section>

      <section aria-labelledby="security-title" className={styles.security} id="security">
        <div className={styles.securityInner}>
          <Reveal className={styles.securityHead}>
            <div>
              <p className={styles.label}>Practical security</p>
              <h2 id="security-title">The controls should be as visible <em>as the workflow.</em></h2>
            </div>
            <p>
              Ajani’s public policies describe the current access, storage, vendor, approval,
              retention, and incident-reporting boundaries. They do not claim that risk disappears.
            </p>
          </Reveal>

          <div className={styles.securityGrid}>
            {securityControls.map((control, index) => (
              <Reveal as="article" className={styles.securityCard} delay={(index % 3) * 70} key={control.marker}>
                <span>{control.marker}</span>
                <h3>{control.title}</h3>
                <p>{control.detail}</p>
              </Reveal>
            ))}
          </div>

          <Reveal className={styles.securityFoot} delay={90}>
            <p>
              Unclaimed saved drafts and voice uploads are scheduled for deletion after 30 days.
              Retention for claimed project records follows the active relationship and applicable
              contractual, legal, security, and dispute needs.
            </p>
            <nav aria-label="Security and data details">
              <Link href="/privacy">Privacy</Link>
              <Link href="/subprocessors">Service providers</Link>
              <Link href="/acceptable-use">Automation boundaries</Link>
              <a href="mailto:hello@ajaniautomation.com?subject=Security%20report">Report a security concern</a>
            </nav>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="about-title" className={`${styles.section} ${styles.about}`} id="about">
        <Reveal className={styles.sectionHead}>
          <div>
            <p className={styles.label}>About / inspectability</p>
            <h2 id="about-title">Know who is behind the system <em>and what is still missing.</em></h2>
          </div>
          <p className={styles.sectionIntro}>
            The current source supports one public profile link, a direct email, and the Ajani Automation
            name. The remaining identity fields are marked plainly rather
            than filled with invented biographies.
          </p>
        </Reveal>

        <div className={styles.aboutGrid}>
          <Reveal as="article" className={styles.identityCard} delay={70}>
            <div className={styles.identityTop}>
              <span aria-hidden="true" className={styles.avatar}>OA</span>
              <p><small>Public profile</small><b>Olakunle Ajani</b></p>
            </div>
            <p>
              Ajani’s currently published LinkedIn destination. A formal title and delivery
              responsibility still need approved public wording.
            </p>
            <a href="https://www.linkedin.com/in/olakunleajani/" rel="noreferrer" target="_blank">
              View the public LinkedIn profile <span aria-hidden="true">↗</span>
            </a>
          </Reveal>

          <Reveal as="article" className={styles.companyCard} delay={110}>
            <p className={styles.label}>Company facts currently published</p>
            <h3>Ajani Automation</h3>
            <dl>
              <div><dt>Operating location</dt><dd><span>Confirm before launch</span></dd></div>
              <div><dt>Direct contact</dt><dd><a href="mailto:hello@ajaniautomation.com">hello@ajaniautomation.com</a></dd></div>
              <div><dt>Service</dt><dd>Design, build, and support of business automation systems</dd></div>
              <div><dt>Legal entity</dt><dd><span>Confirm before launch</span></dd></div>
            </dl>
          </Reveal>
        </div>

        <Reveal as="aside" className={styles.identityReadiness} delay={120}>
          <header>
            <p className={styles.label}>Team profile checklist</p>
            <h3>Required before this becomes a finished public team section.</h3>
          </header>
          <ul>
            {identityGaps.map((gap) => (
              <li key={gap.title}>
                <span>Pre-launch</span>
                <b>{gap.title}</b>
                <p>{gap.detail}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      <section aria-labelledby="faq-title" className={styles.faq} id="faq">
        <div className={styles.faqInner}>
          <Reveal className={styles.faqIntro}>
            <p className={styles.label}>Frequently asked</p>
            <h2 id="faq-title">The practical questions, <em>answered plainly.</em></h2>
          </Reveal>

          <div className={styles.faqList}>
            {frequentlyAsked.map((item) => (
              <details key={item.question}>
                <summary>
                  <span>{item.question}</span>
                  <i aria-hidden="true">+</i>
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="contact-title" className={styles.contact} id="contact">
        <div className={styles.contactInner}>
          <Reveal className={styles.contactCopy}>
            <p className={styles.label}>Contact</p>
            <h2 id="contact-title">Bring the process that keeps slipping. <em>We will make the route discussable.</em></h2>
            <p>
              Start with the real operating problem. A diagram and a software shopping list are not required.
            </p>
          </Reveal>

          <Reveal as="aside" className={styles.contactActions} delay={100}>
            <p><span>Direct email</span><a href="mailto:hello@ajaniautomation.com">hello@ajaniautomation.com</a></p>
            <div>
              <a className={styles.primaryCta} href="mailto:hello@ajaniautomation.com?subject=Discuss%20a%20workflow">
                Discuss a workflow <span aria-hidden="true">→</span>
              </a>
              <RecordNoteAction className={styles.secondaryCta}>
                Record a note <span aria-hidden="true">↗</span>
              </RecordNoteAction>
            </div>
            <small>No charge to submit or approve a public build request.</small>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
