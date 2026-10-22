import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AudiencePicker } from "@/components/home/audience-picker";
import { ClientProofRoute } from "@/components/home/client-proof-route";
import { DeliveryTrust } from "@/components/home/delivery-trust";
import { FeaturedClientProof } from "@/components/home/featured-client-proof";
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
    value: "6 calls",
    label: "booked in month one",
    note: "Client-reported result · claim review before launch",
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

const solutions = [
  {
    number: "01",
    eyebrow: "Lead response",
    title: "Turn a new inquiry into an owned next step.",
    copy: "Capture the signal, qualify what matters, follow up on time, and route the conversation to a person before the opportunity goes cold.",
    route: ["Inquiry", "Qualification", "Human follow-up"],
  },
  {
    number: "02",
    eyebrow: "Client intake",
    title: "Collect the context delivery actually needs.",
    copy: "Replace scattered forms and inbox searches with one visible intake route, clear missing information, and an approval-ready brief.",
    route: ["Request", "Clarification", "Approved brief"],
  },
  {
    number: "03",
    eyebrow: "Operations handoff",
    title: "Move work between tools without losing the owner.",
    copy: "Connect the CRM, work manager, and inbox while keeping decisions, exceptions, and escalation points visible to the team.",
    route: ["Trigger", "System action", "Named owner"],
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

const caseFields = [
  ["Client", "Property and real-estate service business · identity not published"],
  ["Before", "$800 per month produced roughly 35 leads, but near-zero conversations became booked calls."],
  ["What Ajani built", "Immediate text follow-up, 24- and 48-hour nudges, and a 21-day email sequence."],
  ["Integrations", "Client CRM, SMS, and email · vendor names are not published for this case."],
  ["Delivery time", "Case-specific delivery time is not published; confirm before launch."],
  ["Human control", "The system creates follow-up and bookings; the client team owns the sales conversation."],
  ["Measured result", "The client reported six calls booked in the first month."],
  ["Client quote", "Direct quote awaiting client approval."],
] as const;

const executionEvents = [
  ["Lead arrives", "New inquiry enters the client CRM"],
  ["Immediately", "The first useful text follow-up is sent"],
  ["+24 / +48 hours", "Timed nudges continue if the lead has not booked"],
  ["Days 3–21", "Email follow-up keeps the opportunity visible"],
  ["Month one", "Six calls booked, as reported by the client"],
] as const;

const intakeSystem = [
  ["Trigger", "A client submits a voice note or written description"],
  ["Tools", "Clerk · Supabase · Deepgram · Vercel AI Gateway / Anthropic · Resend"],
  ["Owner", "The client owns approval; Ajani owns delivery follow-through"],
  ["Approval", "The proposed route can be edited before it is handed to delivery"],
  ["Output", "A durable, client-approved implementation brief"],
  ["Timeframe", "Note to reviewable route in the same session"],
  ["Result", "Delivery receives structured scope instead of an unbounded request"],
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
                  href="mailto:hello@ajaniautomation.com?subject=Workflow%20audit"
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
              <p className={styles.label}>Evidence, with the qualifier attached</p>
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

        <section className={`${styles.section} ${styles.caseSection}`} id="client-work">
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>Featured client work · pre-launch claim review</p>
              <h2>A named client story. <em>One measurable case.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>
                Client proof now lives here instead of replacing the hero animation. Each story names
                the client, build, controls, and result—or calls out what still needs approval.
              </p>
            </div>
          </Reveal>

          <Reveal className={styles.featuredClientPlacement} delay={60}>
            <FeaturedClientProof />
          </Reveal>

          <div className={styles.caseGrid}>
            <Reveal as="article" className={styles.caseCard} delay={70}>
              <div className={styles.caseTopline}>
                <span>Property &amp; real estate</span>
                <em>Identity not published</em>
              </div>
              <h3>The same leads started turning into booked calls.</h3>
              <dl className={styles.caseFacts}>
                {caseFields.map(([term, detail]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{detail}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            <Reveal as="aside" className={styles.executionCard} delay={140}>
              <header>
                <span><i aria-hidden="true" /> Delivered route</span>
                <em>Follow-up execution</em>
              </header>
              <ol>
                {executionEvents.map(([time, event], index) => (
                  <li key={time}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span><small>{time}</small>{event}</span>
                  </li>
                ))}
              </ol>
              <footer>
                <strong>Client-reported result</strong>
                <span>6 calls booked in the first month</span>
                <small>Evidence and publication permission must be confirmed before launch.</small>
              </footer>
            </Reveal>
          </div>
        </section>

        <section className={`${styles.section} ${styles.solutionsSection}`} id="solutions">
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>Solutions</p>
              <h2>Start with the expensive handoff, <em>not an AI shopping list.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>
                Each engagement begins with one operational bottleneck and ends with a route your
                team can inspect, own, and improve.
              </p>
            </div>
          </Reveal>

          <div className={styles.solutionGrid}>
            {solutions.map((solution, index) => (
              <Reveal as="article" className={styles.solutionCard} delay={index * 75} key={solution.number}>
                <div className={styles.solutionMeta}>
                  <span>{solution.number}</span>
                  <small>{solution.eyebrow}</small>
                </div>
                <h3>{solution.title}</h3>
                <p>{solution.copy}</p>
                <ol aria-label={`${solution.eyebrow} route`}>
                  {solution.route.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </Reveal>
            ))}
          </div>
          <Link className={styles.textLink} href="/demos">
            Explore the working demos <span aria-hidden="true">→</span>
          </Link>
        </section>

        <section className={`${styles.section} ${styles.audienceSection}`} id="industries">
          <Reveal className={styles.sectionHead}>
            <div className={styles.headMain}>
              <p className={styles.label}>Industries and use cases</p>
              <h2>Different businesses. <em>The same operational gap.</em></h2>
            </div>
            <div className={styles.headAside}>
              <p>
                Choose the business closest to yours. These are worked examples—not testimonials—showing
                where an inspectable workflow can replace a fragile handoff.
              </p>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <AudiencePicker />
          </Reveal>
        </section>

        <section className={`${styles.section} ${styles.systemSection}`} aria-labelledby="system-title">
          <Reveal className={styles.systemCopy}>
            <p className={styles.label}>Real production artifact · Ajani Flow</p>
            <h2 id="system-title">A working request system, <em>not a generic simulation.</em></h2>
            <p>
              This is the production intake route behind Ajani: a note becomes an editable workflow,
              the client approves it, and delivery receives a durable implementation brief. The website
              does not autonomously deploy a client automation.
            </p>
          </Reveal>

          <Reveal as="aside" className={styles.systemDossier} delay={120}>
            <header>
              <span><i aria-hidden="true" /> Production route</span>
              <em>Inspect the handoff</em>
            </header>
            <dl className={styles.systemFacts}>
              {intakeSystem.map(([term, detail]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
            <footer>
              <strong>Human approval remains visible</strong>
              <span>Request → route → review → delivery brief</span>
            </footer>
          </Reveal>
        </section>

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

        <TestimonialPipeline />

        <section className={`${styles.section} ${styles.additionalCases}`} aria-labelledby="additional-cases-title">
          <Reveal className={styles.additionalCaseCopy}>
            <p className={styles.label}>Additional client work</p>
            <h2 id="additional-cases-title">The route stays visible <em>where judgment matters.</em></h2>
            <p>
              A dental practice needed after-hours calls to arrive with useful context without
              automating the judgment that belongs to the team.
            </p>
            <Link className={styles.textLink} href="/stories">
              Review the client-work library <span aria-hidden="true">→</span>
            </Link>
          </Reveal>
          <ClientProofRoute className={styles.proofRoute} />
        </section>

        <DeliveryTrust />
      </main>

      <SiteFoot coverSafeArea />
    </div>
  );
}
