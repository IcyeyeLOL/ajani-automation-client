import type { Metadata } from "next";
import Image from "next/image";
import type { CSSProperties } from "react";
import { Reveal } from "@/components/home/reveal";
import { RecordNoteAction } from "@/components/record-note-action";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./stories.module.css";

export const metadata: Metadata = {
  title: "Stories · Ajani Automation",
  description: "A client testimonial and real Ajani Automation systems — what was getting lost, what we built, and what changed.",
};

/** A documented client build from the Ajani Automation project archive. */
const featured = {
  kicker: "Clinics & practices · Frederick’s dental practice",
  title: "The after-hours calls that stopped ending at voicemail.",
  lede: "Patients still called when the front desk was closed. The practice needed a response that could capture the reason for the call, understand urgency and leave the team with useful context.",
  body: "Ajani built a voice system for the practice that answers after hours, gathers the configured call context, supports insurance eligibility verification and routes urgent cases. The practice gets structured information instead of a voicemail somebody has to decode the next morning.",
  log: [
    { at: "After hours", event: "A patient calls while the front desk is closed", tone: "in" },
    { at: "On the call", event: "The voice agent answers and captures the reason for calling", tone: "act" },
    { at: "In system", event: "Details and insurance context are organized securely", tone: "act" },
    { at: "Handoff", event: "Urgent cases are routed with the full conversation attached", tone: "out" },
  ],
  outcomes: [
    "Patients reach a useful response outside normal office hours",
    "The front desk receives structured call context instead of loose voicemail notes",
    "Urgent cases are identified and routed without waiting for the next morning",
  ],
};

type Story = {
  kicker: string;
  title: string;
  before: string;
  after: string;
  route: [string, string, string];
  image: string;
  imageAlt: string;
  accent: string;
};

const stories: Story[] = [
  {
    kicker: "Clinics & practices",
    title: "The after-hours call that arrived team-ready.",
    before: "Patient calls outside office hours became voicemails, and the front desk had to reconstruct the request the next morning.",
    after: "A practice voice system captures the request, supports eligibility checks and routes urgent cases with context attached.",
    route: ["Call answered", "Context captured", "Case routed"],
    image: "/images/stories/clinics-practices.webp",
    imageAlt: "Clinic phone, patient intake card, and routing line showing an after-hours call becoming an organized handoff",
    accent: "#2d7867",
  },
  {
    kicker: "Salons & studios",
    title: "The regular who was quietly overdue.",
    before: "A client who rebooked every six weeks drifted to nine, and nobody had a list that would have shown it.",
    after: "The gap itself is the trigger. The nudge goes out timed, with the reason it is being sent attached.",
    route: ["Last visit", "Gap noticed", "Rebooked"],
    image: "/images/stories/salons-studios.webp",
    imageAlt: "Salon chair, appointment book, and comb connected by a rebooking route",
    accent: "#790018",
  },
  {
    kicker: "Agencies & consultants",
    title: "The kickoff that already knew the answers.",
    before: "Everything agreed on the sales calls lived in one thread and three inboxes, so delivery asked it all again.",
    after: "The brief is built from the conversation that already happened, decisions and non-negotiables included.",
    route: ["Signed", "Brief built", "Team ready"],
    image: "/images/stories/agencies-consultants.webp",
    imageAlt: "Conversation, signed document, briefing cards, and laptop connected as a delivery-ready agency handoff",
    accent: "#805f49",
  },
  {
    kicker: "Property & real estate",
    title: "The same 35 leads that started booking calls.",
    before: "A real-estate client was spending $800 a month for roughly 35 leads, but near-zero conversations were becoming booked calls.",
    after: "Ajani added immediate text follow-up, 24- and 48-hour nudges and a 21-day email sequence. The client reported six calls booked in the first month.",
    route: ["Lead arrives", "Follow-up runs", "Call booked"],
    image: "/images/stories/property-real-estate.webp",
    imageAlt: "House, phone, key, and appointment marker connected by a real-estate lead follow-up route",
    accent: "#a4763f",
  },
  {
    kicker: "Trades & field work",
    title: "The afternoon that rearranged itself.",
    before: "A job overran, two customers needed moving, and the rest of the day became calls made from the van.",
    after: "The affected customers are told, offered the next real slot, and the day is rebuilt without a phone call.",
    route: ["Overrun", "Customers told", "Day rebuilt"],
    image: "/images/stories/trades-field-work.webp",
    imageAlt: "Service van, wrench, and reordered schedule cards showing a field-work day being rebuilt",
    accent: "#4a5b7a",
  },
  {
    kicker: "Accountants & bookkeepers",
    title: "The deadline chase nobody had to run.",
    before: "Chasing records before a filing date was a person, a spreadsheet, and the same three emails every quarter.",
    after: "Each client is asked for exactly what is missing, on a schedule, and you see only what is still outstanding.",
    route: ["Deadline", "Chased", "Filed"],
    image: "/images/stories/accountants-bookkeepers.webp",
    imageAlt: "Records, deadline marker, calculator, and ledger connected as an automated filing workflow",
    accent: "#5c4a6b",
  },
];

export default function StoriesPage() {
  return (
    <div className={styles.shell}>
      <SiteTop active="stories" />

      <main id="main-content" tabIndex={-1}>

      {/* Dark opening, the same ground the homepage opens on */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <Reveal className={styles.heroCopy}>
            <p className={styles.label}>Stories</p>
            <h1>The work is the proof. <em>Here is the work.</em></h1>
            <p>
              Every build starts with a moment that keeps slipping. These are those
              moments — what arrives, what the system does about it, and what the
              owner sees the next morning.
            </p>
          </Reveal>
          <Reveal as="aside" className={styles.note} delay={130}>
            <p className={styles.label}>How to read this page</p>
            <p>
              The video below is a testimonial from Karol at Granker&apos;s Team. Every
              story that follows comes from a real client system Ajani built. Some
              names and identifying details stay private, but the work is real.
            </p>
          </Reveal>
        </div>
      </section>

      {/* The testimonial leads into the client systems it helps substantiate. */}
      <section aria-labelledby="client-story-heading" className={`${styles.section} ${styles.clientSection}`}>
        <Reveal className={styles.sectionHead}>
          <div className={styles.headMain}>
            <h2 id="client-story-heading">Hear it from someone <em>who hired us.</em></h2>
          </div>
          <div className={styles.headAside}>
            <p>Karol brought Ajani into Granker&apos;s Team for community and content automation. This is his account of the work.</p>
          </div>
        </Reveal>

        <div className={styles.clientProof}>
          <Reveal className={styles.clientVideo} delay={80}>
            <div className={styles.videoHead}>
              <span><i aria-hidden="true" /> Client video</span>
              <em>Granker&apos;s Team</em>
            </div>
            <div className={styles.videoFrame}>
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                src="https://www.youtube-nocookie.com/embed/upEkMB8pYRA?rel=0&modestbranding=1"
                title="Karol from Granker's Team shares his experience working with Ajani"
              />
            </div>
            <div className={styles.videoFoot}>
              <span className={styles.clientAvatar} aria-hidden="true">K</span>
              <span><b>Karol · Granker&apos;s Team</b><small>Community &amp; content automation</small></span>
              <span aria-label="Five out of five stars" className={styles.stars}>★★★★★</span>
            </div>
          </Reveal>

          <Reveal as="aside" className={styles.clientQuote} delay={150}>
            <p className={styles.label}>In the client&apos;s words</p>
            <blockquote>
              “He walks you through every step, keeps you in the loop, and delivers.
              You won&apos;t regret it.”
            </blockquote>
            <p>
              Karol describes the work as transparent and hands-on, with the system
              covering content, email, and the wider workflow instead of stopping at
              a single isolated task.
            </p>
            <div className={styles.proofTags} aria-label="What the testimonial verifies">
              <span>Clear process</span>
              <span>Kept in the loop</span>
              <span>Delivered</span>
            </div>
            <a href="https://youtu.be/upEkMB8pYRA" rel="noreferrer" target="_blank">
              Watch the client story on YouTube <span aria-hidden="true">↗</span>
            </a>
          </Reveal>
        </div>
      </section>

      {/* One documented client system, given the room a lead story deserves. */}
      <section className={styles.section}>
        <Reveal className={`${styles.sectionHead} ${styles.clientSystemHead}`}>
          <div className={styles.headMain}>
            <p className={styles.label}>Real client system</p>
            <h2>Inside Frederick&apos;s <em>after-hours route.</em></h2>
            <p className={styles.clientSystemIntro}>A documented healthcare-client build where the call comes in, the system gathers what matters, and the right context reaches the practice. Public intake is not approved for health information.</p>
          </div>
        </Reveal>

        <div className={styles.feature}>
          <Reveal className={styles.featureLog} delay={90}>
            <div className={styles.logHead}>
              <span>Client system</span>
              <em>After-hours patient calls</em>
            </div>
            <ol className={styles.log}>
              {featured.log.map((entry) => (
                <li data-tone={entry.tone} key={entry.at + entry.event}>
                  <b>{entry.at}</b>
                  <span>{entry.event}</span>
                  <i aria-hidden="true" />
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal className={styles.featureCopy} delay={150}>
            <p className={styles.kicker}>{featured.kicker}</p>
            <h3>{featured.title}</h3>
            <p className={styles.lede}>{featured.lede}</p>
            <p>{featured.body}</p>
          </Reveal>
        </div>

        <Reveal as="ul" className={styles.outcomes} delay={90}>
          {featured.outcomes.map((outcome) => (
            <li key={outcome}><i aria-hidden="true">✓</i>{outcome}</li>
          ))}
        </Reveal>
      </section>

      {/* The client shelf continues without a generic worked-example divider. */}
      <section aria-label="More real client systems" className={`${styles.section} ${styles.sectionEnd}`}>
        <div className={styles.grid}>
          {stories.map((story, index) => (
            <Reveal
              as="article"
              className={styles.card}
              delay={(index % 3) * 90}
              key={story.title}
              style={{ "--accent": story.accent } as CSSProperties}
            >
              <div className={styles.cardMedia}>
                <Image
                  alt={story.imageAlt}
                  fill
                  sizes="(max-width: 620px) calc(100vw - 32px), (max-width: 1040px) calc((100vw - 62px) / 2), 400px"
                  src={story.image}
                />
              </div>
              <div className={styles.cardBody}>
                <p className={styles.kicker}>{story.kicker}</p>
                <h3>{story.title}</h3>
                <div className={styles.comparison}>
                  <p className={styles.before}><b>Before</b><span>{story.before}</span></p>
                  <p className={styles.after}><b>Now</b><span>{story.after}</span></p>
                </div>
                <div aria-label={`${story.kicker} route`} className={styles.route} role="list">
                  {story.route.map((step, position) => (
                    <span key={step} role="listitem">
                      <small>0{position + 1}</small>
                      <b>{step}</b>
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Same close as the homepage, so every route ends at the recorder. The
          panel answers the question a reader actually has here: what do I say? */}
      <section className={styles.close}>
        <div className={styles.closeInner}>
          <Reveal className={styles.closeCopy}>
            <p className={styles.label}>Your turn</p>
            <h2>None of these started as a brief. <em>They started as a sentence.</em></h2>
            <p>Tell us the moment that keeps slipping in your week. We work out what the system should be.</p>
            <RecordNoteAction className={styles.primaryCta}>
              Record a note <span aria-hidden="true">→</span>
            </RecordNoteAction>
          </Reveal>

          <Reveal as="aside" className={styles.sample} delay={130}>
            <p className={styles.label}>What a note sounds like</p>
            <blockquote>
              “So the thing that keeps happening is people message us on a Friday
              asking for a price, and I don’t get back to them until Monday, and
              by then half of them have gone somewhere else. I don’t know what to
              do about it really.”
            </blockquote>
            <p className={styles.sampleFoot}>
              That is enough. You do not need to know what the automation should be —
              working that out is the job.
            </p>
          </Reveal>
        </div>
      </section>

      </main>

      <SiteFoot />
    </div>
  );
}
