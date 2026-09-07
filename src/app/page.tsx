import type { Metadata } from "next";
import Link from "next/link";
import { AudiencePicker } from "@/components/home/audience-picker";
import { ClientProofRoute } from "@/components/home/client-proof-route";
import { HowItWorksTimeline } from "@/components/home/how-it-works-timeline";
import { HowItWorksDialog } from "@/components/home/how-it-works-dialog";
import { Reveal } from "@/components/home/reveal";
import { SystemAnimation } from "@/components/home/system-animation";
import { RecordNoteAction } from "@/components/record-note-action";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./home.module.css";

const homepageTitle = "Ajani Automation";
const homepageDescription = "Operational systems that make the work move.";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: homepageTitle,
    title: homepageTitle,
    description: homepageDescription,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Ajani Automation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: homepageTitle,
    description: homepageDescription,
    images: ["/og.png"],
  },
};

const stages = [
  {
    when: "Now",
    title: "You talk",
    detail: "Two minutes about the work that keeps slipping. No form to decode and no technical brief to write.",
  },
  {
    when: "Same session",
    title: "Ajani clarifies",
    detail: "We ask only for the missing detail that materially changes the route.",
  },
  {
    when: "Same session",
    title: "You approve",
    detail: "You see the proposed system, change what is wrong, and decide whether it should move forward.",
  },
  {
    when: "7–10 days",
    title: "It runs",
    detail: "The approved route goes live in the channels your team already uses, then we tune it with you.",
  },
];

const model = [
  {
    number: "01",
    label: "Signal",
    title: "Start with the stuck moment.",
    detail: "A voice note or a few plain sentences is enough. Describe the work as it actually happens.",
  },
  {
    number: "02",
    label: "System",
    title: "See the route, not a black box.",
    detail: "Ajani turns the note into triggers, actions, decisions, and handoffs your team can inspect.",
  },
  {
    number: "03",
    label: "Delivery",
    title: "Build quickly. Deliver with care.",
    detail: "Ajani turns the approved route into a polished working system, with every important handoff checked before it reaches your team.",
  },
];

const trustSignals = [
  {
    number: "01",
    title: "Source attached",
    detail: "The request that started the route stays visible beside the system it becomes.",
  },
  {
    number: "02",
    title: "Decisions named",
    detail: "You can see what Ajani inferred, what changed, and what still needs an answer.",
  },
  {
    number: "03",
    title: "Human boundary",
    detail: "The route pauses for approval. A person—not an animation—decides what moves forward.",
  },
  {
    number: "04",
    title: "Scope before payment",
    detail: "The proposed build and budget stay clear before work begins or anything is charged.",
  },
];

export default function Home() {
  return (
    <div className={styles.shell}>
      <SiteTop active="home" tone="light" />

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Reveal className={styles.heroCopy}>
              <p className={styles.label}>Done for you workflows</p>
              <h1>
                <span>Tell us where</span>
                <span className={styles.heroWorkLine}>the work sucks.</span>
                <em>We fix it.</em>
              </h1>
              <p className={styles.heroLede}>
                Ajani turns the part of your business that keeps slipping into a clear route your
                team can review. You describe the mess; we map, build, and run the system around it.
              </p>
              <div className={styles.heroActions}>
                <RecordNoteAction className={styles.primaryCta}>
                  Record a note <span aria-hidden="true">→</span>
                </RecordNoteAction>
                <HowItWorksDialog triggerClassName={styles.secondaryCta} />
              </div>
              <p className={styles.heroProof}>From voice note to visible workflow in minutes.</p>
            </Reveal>

            <Reveal as="aside" className={styles.heroVisual} delay={140}>
              <SystemAnimation />
            </Reveal>
          </div>
        </section>

        <section className={`${styles.section} ${styles.modelSection}`}>
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>The model</p>
              <h2>Automation starts with the work, <em>not the software.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>
                You should not have to arrive with a workflow diagram. Bring the frustrating moment;
                Ajani makes the system visible before anything gets built.
              </p>
            </div>
          </Reveal>

          <div className={styles.modelRail}>
            {model.map((item, index) => (
              <Reveal as="article" className={styles.modelStep} delay={index * 90} key={item.number}>
                <div className={styles.modelStepTop}>
                  <span>{item.number}</span>
                  <i aria-hidden="true" />
                  <small>{item.label}</small>
                </div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className={`${styles.section} ${styles.audienceSection}`}>
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>The work in context</p>
              <h2>Different businesses, <em>the same gap.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>
                Pick the business closest to yours. The exact task changes, but the opportunity is the same:
                turn a fragile handoff into a visible, reliable route.
              </p>
            </div>
          </Reveal>
          <Reveal delay={110}>
            <AudiencePicker />
          </Reveal>
        </section>

        <section className={`${styles.section} ${styles.proofSection}`}>
          <Reveal className={styles.proofCopy}>
            <p className={styles.label}>Human control / real client work</p>
            <h2>The work is <em>the proof.</em></h2>
            <p>
              Frederick&apos;s dental practice needed after-hours calls to arrive with useful context,
              without automating the judgement that belongs to the team. Ajani built the route and
              kept the handoff visible.
            </p>
            <Link className={styles.textLink} href="/stories">
              Read the client story <span aria-hidden="true">→</span>
            </Link>
          </Reveal>

          <ClientProofRoute className={styles.proofRoute} />
        </section>

        <section className={`${styles.section} ${styles.processSection}`} id="how">
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>After you send it</p>
              <h2 id="how-it-works-title">You will know exactly <em>what happens next.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>No black box and no long discovery process. Four clear moments, with your decision in the middle.</p>
            </div>
          </Reveal>

          <HowItWorksTimeline
            labelledBy="how-it-works-title"
            railClassName={styles.steps}
            stages={stages}
            stepClassName={styles.step}
            stepIndexClassName={styles.stepIndex}
            stepWhenClassName={styles.stepWhen}
          />
        </section>

        <section className={styles.trustSection}>
          <div className={styles.trustInner}>
            <Reveal className={styles.trustCopy}>
              <p className={styles.label}>Evidence / approach &amp; privacy</p>
              <h2>Private by default. <em>Clear by design.</em></h2>
              <p>
                The source, decisions, route, and protection stay visible from the first note to
                handoff. You should always know what Ajani has and what happens next.
              </p>
              <Link className={styles.textLink} href="/privacy">
                Read how Ajani handles your data <span aria-hidden="true">→</span>
              </Link>
            </Reveal>

            <div className={styles.trustMatrix}>
              {trustSignals.map((signal, index) => (
                <Reveal as="article" delay={index * 70} key={signal.number}>
                  <b>{signal.number}</b>
                  <h3>{signal.title}</h3>
                  <p>{signal.detail}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

      </main>

      <SiteFoot />
    </div>
  );
}
