import type { Metadata } from "next";
import { DemoGrid } from "@/components/demo-grid";
import { Reveal } from "@/components/home/reveal";
import { RecordNoteAction } from "@/components/record-note-action";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./demos.module.css";

export const metadata: Metadata = {
  title: "Automation demos | Ajani Automation",
  description: "Run interactive examples of the business systems Ajani Automation designs and builds.",
};

export default function DemosPage() {
  return (
    <div className={styles.shell}>
      <SiteTop active="demos" tone="light" />

      <main className={styles.main} id="main-content" tabIndex={-1}>

      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <Reveal className={styles.heroCopy}>
            <p className={styles.label}>The workflow collection / 01—03</p>
            <h1>Watch the system work. <em>Then decide if it fits.</em></h1>
            <p>
              A late-night inquiry. A scattered brief. A client ready to return.
              See how a small signal becomes something your team can act on.
            </p>
          </Reveal>

        </div>
      </section>

      <section className={styles.demoSection}>
        <DemoGrid />
      </section>

      <section className={styles.close}>
        <div className={styles.closeInner}>
          <Reveal className={styles.closeCopy}>
            <p className={styles.label}>Your route</p>
            <h2>The useful demo is the one built around <em>your actual work.</em></h2>
            <p>
              Record the moment that keeps slipping. You do not need to describe
              the automation—working out the route is our job.
            </p>
            <RecordNoteAction className={styles.primaryCta}>
              Record a note <span aria-hidden="true">→</span>
            </RecordNoteAction>
          </Reveal>

          <Reveal as="aside" className={styles.promise} delay={130}>
            <p className={styles.label}>What happens after</p>
            <p>
              We turn the note into a route you can review, change, and price
              before anything gets built.
            </p>
            <div>
              <span>Voice note</span><i aria-hidden="true">→</i>
              <span>System route</span><i aria-hidden="true">→</i>
              <span>Build scope</span>
            </div>
          </Reveal>
        </div>
      </section>

      </main>

      <SiteFoot />
    </div>
  );
}
