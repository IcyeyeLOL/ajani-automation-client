import type { Metadata } from "next";
import Link from "next/link";
import { LegalSwitcher } from "@/components/legal/legal-switcher";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import { LEGAL_EFFECTIVE_DATE_LABEL } from "@/lib/legal/policy-versions";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Accessibility Statement · Ajani Automation",
  description: "Ajani's accessibility commitments, current approach, and help channel.",
};

const sections = [
  ["commitment", "Commitment"],
  ["approach", "Current approach"],
  ["alternatives", "Alternative access"],
  ["motion", "Motion and media"],
  ["testing", "Testing and improvement"],
  ["feedback", "Feedback"],
] as const;

export default function AccessibilityPage() {
  return (
    <div className={styles.shell}>
      <SiteTop />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <p className={styles.label}>AJANI / LEGAL</p>
              <h1>Accessibility <em>Statement.</em></h1>
            </div>
            <div className={styles.heroNote}>
              <span>Effective {LEGAL_EFFECTIVE_DATE_LABEL}</span>
              <p>How Ajani approaches access, alternative formats, motion, feedback, and ongoing improvement.</p>
              <LegalSwitcher className={styles.legalSwitcher} current="overview" />
            </div>
          </div>
        </section>

        <section className={styles.termsLayout}>
          <aside className={styles.summary}>
            <p className={styles.label}>ACCESS FIRST</p>
            <p>Ajani is working to make the website and request process usable across devices, input methods, and assistive technologies. This statement describes the current approach without claiming formal conformance that has not yet been independently certified.</p>
            <nav aria-label="Accessibility sections">
              {sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </aside>

          <article className={styles.document}>
            <section id="commitment">
              <p className={styles.sectionNumber}>01</p>
              <h2>Commitment</h2>
              <p>Ajani aims to provide a website and service experience that people can perceive, understand, navigate, and operate with a range of abilities and technologies. Accessibility is treated as ongoing product work, not a one-time badge.</p>
              <p>Ajani uses the Web Content Accessibility Guidelines as a design and testing reference. This statement does not represent that every page or interaction has completed an independent conformance audit.</p>
            </section>

            <section id="approach">
              <p className={styles.sectionNumber}>02</p>
              <h2>Current product approach</h2>
              <ul>
                <li>Semantic landmarks, headings, labels, and accessible names for key controls.</li>
                <li>A skip link, visible keyboard focus, and keyboard-operable navigation and forms.</li>
                <li>Responsive layouts designed to reflow across mobile and desktop widths.</li>
                <li>Text alternatives for meaningful images and status messages for changing workflow states.</li>
                <li>Written intake as an alternative to the microphone-based request path.</li>
                <li>Pause and manual controls for major interactive demonstrations where available.</li>
              </ul>
            </section>

            <section id="alternatives">
              <p className={styles.sectionNumber}>03</p>
              <h2>Alternative access and formats</h2>
              <p>You do not have to use the voice recorder. The request flow includes a written option, and Ajani can provide another reasonable way to submit a request if the standard flow is not usable for you.</p>
              <p>If you need a legal document, project message, or other Ajani information in a different format, email <a href="mailto:hello@ajaniautomation.com?subject=Accessibility%20request">hello@ajaniautomation.com</a>. Describe the page or information, the barrier, and the format or method that would help.</p>
            </section>

            <section id="motion">
              <p className={styles.sectionNumber}>04</p>
              <h2>Motion, demonstrations, and media</h2>
              <p>Major interactive demonstrations provide pause or manual controls where the experience continues automatically. Ajani respects the operating system&apos;s reduced-motion preference by default and is continuing to review experiences that may still present more movement than a person prefers.</p>
              <p>Embedded third-party video may have controls and accessibility behavior supplied by that provider. A direct link is provided when available. Contact Ajani if you need the substance of a video or demonstration in another format.</p>
            </section>

            <section id="testing">
              <p className={styles.sectionNumber}>05</p>
              <h2>Testing and improvement</h2>
              <p>Ajani uses automated checks and targeted manual review for keyboard access, focus, reflow, target size, labels, status communication, and layout regressions. Automated tools do not identify every barrier, so manual and assistive-technology review remains part of the improvement plan.</p>
              <p>Known or reported barriers are prioritized by impact, frequency, and whether an immediate alternative is available. Material accessibility claims will be updated only after the supporting review is documented.</p>
            </section>

            <section id="feedback">
              <p className={styles.sectionNumber}>06</p>
              <h2>Report a barrier</h2>
              <p>Email <a href="mailto:hello@ajaniautomation.com?subject=Accessibility%20feedback">hello@ajaniautomation.com</a> with &ldquo;Accessibility feedback&rdquo; in the subject. Include the page address, what you were trying to do, what happened, and any assistive technology or browser involved if you are comfortable sharing it. Do not include a diagnosis, medical record, or other sensitive information.</p>
              <p>Ajani reviews accessibility reports and, when feasible and appropriate, works to provide a reasonable alternative. Accessibility feedback is used to improve the product and is handled under the <Link href="/privacy">Privacy Policy</Link>.</p>
            </section>

            <section className={styles.relatedDocument}>
              <p className={styles.sectionNumber}>RELATED DOCUMENT</p>
              <h2>Legal Center</h2>
              <p>Return to the Legal Center for Ajani&apos;s Terms, Privacy Policy, acceptable-use rules, and provider list.</p>
              <Link href="/legal">Open the Legal Center <span aria-hidden="true">→</span></Link>
            </section>
          </article>
        </section>
      </main>
      <SiteFoot />
    </div>
  );
}
