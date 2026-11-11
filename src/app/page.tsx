import type { Metadata, Viewport } from "next";
import { DeliveryTrust } from "@/components/home/delivery-trust";
import { HowItWorksTimeline } from "@/components/home/how-it-works-timeline";
import { IntegrationMarquee } from "@/components/home/integration-marquee";
import { Reveal } from "@/components/home/reveal";
import { SystemAnimation } from "@/components/home/system-animation";
import { TestimonialPipeline } from "@/components/home/testimonial-pipeline";
import { RecordNoteAction } from "@/components/record-note-action";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./home.module.css";

const homepageTitle = "AI Workflow Systems for Service Businesses | Ajani Automation";
const homepageDescription =
  "Ajani maps costly operational processes, connects the tools a service team already uses, and ships documented workflow systems with human approval built in.";

export const metadata: Metadata = {
  title: homepageTitle,
  description: homepageDescription,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Ajani Automation",
    title: homepageTitle,
    description: homepageDescription,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Ajani Automation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: homepageTitle,
    description: homepageDescription,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbfaf7",
};

const proofFacts = [
  {
    value: "5 examples",
    label: "of named client work",
    note: "Three client videos and two named projects",
  },
  {
    value: "7–10 days",
    label: "target first-build window",
    note: "Final commitment belongs in the written project order",
  },
  {
    value: "5 platforms",
    label: "named integration experience",
    note: "Plus custom APIs and webhooks",
  },
  {
    value: "Human approval",
    label: "before build handoff",
    note: "The client reviews and changes the proposed route",
  },
] as const;

const stages = [
  {
    when: "Now",
    title: "Map the costly process",
    detail: "Bring the moment that wastes time, loses leads, or creates avoidable follow-up. No technical brief required.",
  },
  {
    when: "Same session",
    title: "Clarify the route",
    detail: "Ajani asks only for the details that change the trigger, decision, owner, or output.",
  },
  {
    when: "Before build",
    title: "Approve scope and price",
    detail: "You inspect the proposed system and written project order before paid work begins.",
  },
  {
    when: "Target: 7–10 days",
    title: "Launch and tune",
    detail: "After access and decisions are confirmed, the system is built, checked, documented, and tuned with your team.",
  },
] as const;

export default function Home() {
  return (
    <div className={styles.shell}>
      <SiteTop active="home" coverSafeArea tone="light" />

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Reveal className={styles.heroCopy}>
              <p className={styles.label}>AI workflow systems · built for service businesses</p>
              <h1>
                <span>AI workflow systems</span>
                <em>for service businesses.</em>
              </h1>
              <p className={styles.heroLede}>
                We map one costly process, connect the tools your team already uses, add human
                approval points, and ship a documented production system.
              </p>
              <div className={styles.heroActions}>
                <a
                  className={styles.primaryCta}
                  href="mailto:olakunleajani@ajaniautomation.com?subject=Workflow%20audit"
                >
                  Discuss a workflow <span aria-hidden="true">→</span>
                </a>
                <RecordNoteAction className={styles.secondaryCta}>
                  Record a note <span aria-hidden="true">↗</span>
                </RecordNoteAction>
              </div>
              <p className={styles.heroProof}>
                Scope before payment · human approval before build · direct access to the delivery team
              </p>
            </Reveal>

            <Reveal as="aside" className={styles.heroVisual} delay={120}>
              <SystemAnimation />
            </Reveal>
          </div>
        </section>

        <section aria-labelledby="proof-rail-title" className={styles.proofBand}>
          <div className={styles.proofBandInner}>
            <header>
              <p className={styles.label}>Client work and delivery</p>
              <h2 id="proof-rail-title">Proof you can inspect.</h2>
            </header>
            <dl>
              {proofFacts.map((fact) => (
                <div key={fact.value}>
                  <dt>{fact.value}</dt>
                  <dd>{fact.label}</dd>
                  <small>{fact.note}</small>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <IntegrationMarquee />

        <TestimonialPipeline />

        <section className={`${styles.section} ${styles.processSection}`} id="process">
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>Delivery process</p>
              <h2 id="delivery-process-title">You know the route <em>before the build begins.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>
                Submission is free and does not authorize a charge. Scope, price, support, ownership,
                and the committed timeline belong in the written project order.
              </p>
            </div>
          </Reveal>
          <HowItWorksTimeline
            labelledBy="delivery-process-title"
            railClassName={styles.steps}
            stages={stages}
            stepClassName={styles.step}
            stepIndexClassName={styles.stepIndex}
            stepWhenClassName={styles.stepWhen}
          />
        </section>

        <DeliveryTrust />
      </main>

      <SiteFoot coverSafeArea />
    </div>
  );
}
