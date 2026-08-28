import { AudiencePicker } from "@/components/home/audience-picker";
import { HowItWorksDialog } from "@/components/home/how-it-works-dialog";
import { Reveal } from "@/components/home/reveal";
import { RecordNoteAction } from "@/components/record-note-action";
import { SystemAnimation } from "@/components/home/system-animation";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./home.module.css";

const stages = [
  { when: "Now", title: "You talk", detail: "Two minutes about the work that keeps slipping. No forms, no brief to write." },
  { when: "Same session", title: "One question", detail: "Ajani reviews your note and asks the single thing that changes the system — nothing else." },
  { when: "Same session", title: "You approve", detail: "Your answer updates the route automatically. You review it and give the go-ahead." },
  { when: "7–10 days", title: "It runs", detail: "The route goes live in your real channels, and we tune it for a month." },
];

export default function Home() {
  return (
    <div className={styles.shell}>
      <SiteTop active="home" />

      <main id="main-content" tabIndex={-1}>

      {/* Band 1 — dark. The proposition, with the system assembling beside it. */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <Reveal className={styles.heroCopy}>
            <p className={styles.label}>Done-for-you automation</p>
            <h1>Tell us where the work sucks. <em>We build the system that fixes it.</em></h1>
            <p>
              Show us what is wasting time, losing leads, or making your team chase work.
              Ajani turns that mess into an automation system that handles it for you,
              so your team gets hours back and increases revenue.
            </p>
            <div className={styles.heroActions}>
              <RecordNoteAction className={styles.primaryCta}>
                Record a note <span aria-hidden="true">→</span>
              </RecordNoteAction>
              <HowItWorksDialog triggerClassName={styles.secondaryCta} />
            </div>
            <div className={styles.heroMeta}>
              <span><i>✓</i> Takes two minutes</span>
              <span><i>✓</i> Secure account access</span>
              <span><i>✓</i> Built around your business</span>
            </div>
          </Reveal>
          <Reveal className={styles.heroVisual} delay={140}>
            <div className={styles.heroVisualHead}>
              <span>Ajani / system preview</span>
              <em aria-label="System preview running">
                <i aria-hidden="true" />
                <span aria-hidden="true" className={styles.previewStatus}>
                  <b className={styles.statusListening}>Listening</b>
                  <b className={styles.statusMapping}>Mapping</b>
                  <b className={styles.statusRouting}>Routing</b>
                  <b className={styles.statusReady}>System ready</b>
                </span>
              </em>
            </div>
            <div className={styles.heroVisualBody}>
              <SystemAnimation />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Bands 2 and 3 share one light ground, so scrolling never flips between
          grounds. Each opens with the same two-column head — title left, the
          supporting line and any action right — so the page keeps using its
          full width instead of narrowing into a left-hand column. */}

      {/* Band 2 — one selector covering every kind of business, no extra links */}
      <section className={styles.section}>
        <Reveal className={styles.sectionHead}>
          <div className={styles.headMain}>
            <p className={styles.label}>Who this is for</p>
            <h2>Different businesses, <em>the same gap.</em></h2>
          </div>
          <div className={styles.headAside}>
            <p>Pick the one closest to yours. The work is different; the moment it slips is not.</p>
          </div>
        </Reveal>
        <Reveal delay={110}>
          <AudiencePicker />
        </Reveal>
      </section>

      {/* Band 3 — what happens after the memo */}
      <section className={`${styles.section} ${styles.sectionEnd}`} id="how">
        <Reveal className={styles.sectionHead}>
          <div className={styles.headMain}>
            <p className={styles.label}>After you send it</p>
            <h2>You will know exactly <em>what happens next.</em></h2>
          </div>
          <div className={styles.headAside}>
            <p>No black box, no long discovery process. Four steps, and you can stop at any of them.</p>
          </div>
        </Reveal>
        <div className={styles.steps}>
          {stages.map((stage, index) => (
            <Reveal as="article" className={styles.step} delay={index * 85} key={stage.title}>
              <p className={styles.stepWhen}>{stage.when}</p>
              <h3>{stage.title}</h3>
              <p>{stage.detail}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Band 4 — dark again. The close mirrors the hero. */}
      <section className={styles.close}>
        <div className={styles.closeInner}>
          <Reveal className={styles.closeCopy}>
            <p className={styles.label}>Ready when you are</p>
            <h2>The system you keep meaning to build. <em>Just say it out loud.</em></h2>
            <p>You do not need to know what the automation should be. That is the part we work out for you.</p>
            <RecordNoteAction className={styles.primaryCta}>
              Record a note <span aria-hidden="true">→</span>
            </RecordNoteAction>
          </Reveal>
          <Reveal as="aside" className={styles.priceCard} delay={130}>
            <p className={styles.label}>What it costs</p>
            <div className={styles.priceRow}>
              <div className={styles.priceItem}><span>Typical build</span><b>Based on your budget</b></div>
              <div className={styles.priceItem}><span>Time to live</span><b>7–10 days</b></div>
              <div className={styles.priceItem}><span>You pay</span><b>After you approve</b></div>
            </div>
            <small>You approve the build and budget before anything is charged.</small>
          </Reveal>
        </div>
      </section>

      </main>

      <SiteFoot />
    </div>
  );
}
