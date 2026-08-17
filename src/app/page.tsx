import Link from "next/link";
import { InlineAutomation } from "@/components/home/inline-automation";
import { VoiceRecorder } from "@/components/home/voice-recorder";
import styles from "./home.module.css";

const routes = [
  {
    number: "01",
    kicker: "Lead response",
    title: "Reply while the intent is still alive.",
    detail: "An enquiry that lands at 9pm gets a useful answer before it goes cold, and you still see every thread.",
  },
  {
    number: "02",
    kicker: "Client handoff",
    title: "Keep the context attached to the work.",
    detail: "Notes, files, and decisions travel with the job, so nobody restarts a conversation you already had.",
  },
  {
    number: "03",
    kicker: "Returning clients",
    title: "Make follow-up feel timely, not random.",
    detail: "The moment a past client is worth reaching out to, the reason is already written down for you.",
  },
];

// Commitments, not metrics. Swap these for real client outcomes as soon as
// there are numbers we can stand behind on a call.
const promises = [
  ["7–10 days", "from voice note to a live system"],
  ["One question", "before we build anything"],
  ["30 days", "of refinement after launch"],
];

const stages = [
  { when: "Now", title: "You talk", detail: "Two minutes about the work that keeps slipping. No forms, no brief to write." },
  { when: "1 day", title: "One question", detail: "We ask the single thing that changes the shape of the system — nothing else." },
  { when: "3 days", title: "You approve", detail: "We reflect the system back in plain language, with the scope and the price." },
  { when: "7–10 days", title: "It runs", detail: "The route goes live in your real channels, and we tune it for a month." },
];

export default function Home() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/">ajani<i>.</i></Link>
          <nav className={styles.headerNav}>
            <Link className={styles.headerLink} href="/stories">Stories</Link>
            <Link className={styles.headerLink} href="/portal">Sign in</Link>
            <a className={styles.headerCta} href="#record">Record a note</a>
          </nav>
        </div>
      </header>

      {/* Band 1 — the proposition and the control, side by side */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.label}>Done-for-you automation</p>
            <h1>Tell us where the work sticks. <em>We build the system.</em></h1>
            <p>
              Ajani builds operational systems for small businesses. Record a two-minute
              voice note about the part of the work that keeps slipping — we turn it into
              a system that handles it, and you approve the scope and price before
              anything gets built.
            </p>
            <div className={styles.heroMeta}>
              <span><i>✓</i> No account to start</span>
              <span><i>✓</i> Price before you commit</span>
              <span><i>✓</i> Built for you, not by you</span>
            </div>
          </div>
          <VoiceRecorder id="record" />
        </div>
      </section>

      {/* Band 2 — what we commit to, until there are real outcome numbers */}
      <section className={styles.proof}>
        <div className={styles.proofInner}>
          {promises.map(([value, caption]) => (
            <div className={styles.stat} key={value}>
              <b>{value}</b>
              <span>{caption}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Band 3 — recognition, not a fork: no per-card links */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.label}>Where it usually goes wrong</p>
          <h2>Three places good work <em>quietly slips.</em></h2>
          <p>Most businesses lose the same three moments. If one of these sounds like yours, that is the note to record.</p>
        </div>
        <div className={styles.routes}>
          {routes.map((route) => (
            <article className={styles.route} key={route.number}>
              <div className={styles.routeHead}>
                <p className={styles.label}>{route.kicker}</p>
                <b>{route.number}</b>
              </div>
              <h3>{route.title}</h3>
              <p>{route.detail}</p>
              <div className={styles.routeFlow}>
                <span>Understand</span><i>→</i><span>Route</span><i>→</i><span>Resolve</span>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.sectionCta}>
          <a className={styles.ghostCta} href="#record">Record your note <span aria-hidden="true">→</span></a>
        </div>
      </section>

      {/* Band 4 — the product, moving */}
      <section className={styles.showcase}>
        <div className={styles.showcaseInner}>
          <div className={styles.sectionHead}>
            <p className={styles.label}>A system, running</p>
            <h2>This is what we <em>actually hand over.</em></h2>
            <p>An after-hours lead, from the moment it arrives to the moment your team knows what to do about it.</p>
          </div>
          <div className={styles.showcaseBody}>
            <InlineAutomation />
          </div>
        </div>
      </section>

      {/* Band 5 — what happens after the memo */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.label}>After you send it</p>
          <h2>You will know exactly <em>what happens next.</em></h2>
          <p>No black box, no long discovery process. Four steps, and you can stop at any of them.</p>
        </div>
        <div className={styles.steps}>
          {stages.map((stage) => (
            <article className={styles.step} key={stage.title}>
              <p className={styles.stepWhen}>{stage.when}</p>
              <h3>{stage.title}</h3>
              <p>{stage.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Band 6 — the same control, once more */}
      <section className={styles.close}>
        <div className={styles.closeInner}>
          <div className={styles.closeCopy}>
            <p className={styles.label}>Start here</p>
            <h2>The system you keep meaning to build. <em>Just say it out loud.</em></h2>
            <p>You do not need to know what the automation should be. That is the part we work out for you.</p>
            <div className={styles.priceRow}>
              <div className={styles.priceItem}><span>Typical build</span><b>$2,400 – $3,800</b></div>
              <div className={styles.priceItem}><span>Time to live</span><b>7–10 days</b></div>
              <div className={styles.priceItem}><span>You pay</span><b>After you approve the scope</b></div>
            </div>
          </div>
          <VoiceRecorder />
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} Ajani Automation</span>
          <div className={styles.footerLinks}>
            <Link href="/stories">Stories</Link>
            <Link href="/portal">Client portal</Link>
            <a href="#record">Record a note</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
