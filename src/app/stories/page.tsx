import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Reveal } from "@/components/home/reveal";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./stories.module.css";

export const metadata: Metadata = {
  title: "Stories · Ajani Automation",
  description: "The systems we build, told through the moment they fix — what arrives, what Ajani does, and what the owner sees.",
};

/** The featured build, told as the log it actually leaves behind. */
const featured = {
  kicker: "Home services",
  title: "The Friday quote that stopped going cold.",
  lede: "An enquiry lands at ten to five on a Friday. It is a good job and a real budget, and by the time anyone opens it on Monday the customer has three other prices.",
  body: "The system answers in the same minute, asks the one question that decides the price, and hands the owner a job on Monday that is already qualified. Nothing about the work changed. The gap between the question and the answer did.",
  log: [
    { at: "Fri 16:52", event: "Enquiry lands in the website form", tone: "in" },
    { at: "Fri 16:52", event: "Ajani replies and asks what is there now", tone: "act" },
    { at: "Fri 17:04", event: "Customer answers; the detail is attached to the job", tone: "in" },
    { at: "Mon 09:10", event: "Owner opens a job that is already priced-ready", tone: "out" },
  ],
  outcomes: [
    "The first reply goes out while the customer is still looking at their phone",
    "The question that sets the price gets asked once, not on the third call",
    "Monday starts with a job to quote, not a message to chase",
  ],
};

type Story = {
  kicker: string;
  title: string;
  before: string;
  after: string;
  route: [string, string, string];
  accent: string;
  tint: string;
};

const stories: Story[] = [
  {
    kicker: "Clinics & practices",
    title: "The appointment that confirms itself.",
    before: "Bookings arrived by phone, email and the website, and reminders went out whenever someone remembered.",
    after: "One thread confirms, reminds and reschedules. The front desk only hears about the ones that need a person.",
    route: ["Booking", "Confirmed", "Reminded"],
    accent: "#2d7867",
    tint: "rgba(45, 120, 103, .10)",
  },
  {
    kicker: "Salons & studios",
    title: "The regular who was quietly overdue.",
    before: "A client who rebooked every six weeks drifted to nine, and nobody had a list that would have shown it.",
    after: "The gap itself is the trigger. The nudge goes out timed, with the reason it is being sent attached.",
    route: ["Last visit", "Gap noticed", "Rebooked"],
    accent: "#790018",
    tint: "rgba(121, 0, 24, .09)",
  },
  {
    kicker: "Agencies & consultants",
    title: "The kickoff that already knew the answers.",
    before: "Everything agreed on the sales calls lived in one thread and three inboxes, so delivery asked it all again.",
    after: "The brief is built from the conversation that already happened, decisions and non-negotiables included.",
    route: ["Signed", "Brief built", "Team ready"],
    accent: "#805f49",
    tint: "rgba(128, 95, 73, .11)",
  },
  {
    kicker: "Property & real estate",
    title: "The 7am portal lead that got the viewing.",
    before: "Portal enquiries arrived in bulk overnight, and whoever replied first on Saturday took the viewing.",
    after: "The answer goes out immediately with the detail they asked for, and the timeline is qualified before you read it.",
    route: ["Portal lead", "Answered", "Viewing booked"],
    accent: "#a4763f",
    tint: "rgba(164, 118, 63, .11)",
  },
  {
    kicker: "Trades & field work",
    title: "The afternoon that rearranged itself.",
    before: "A job overran, two customers needed moving, and the rest of the day became calls made from the van.",
    after: "The affected customers are told, offered the next real slot, and the day is rebuilt without a phone call.",
    route: ["Overrun", "Customers told", "Day rebuilt"],
    accent: "#4a5b7a",
    tint: "rgba(74, 91, 122, .10)",
  },
  {
    kicker: "Accountants & bookkeepers",
    title: "The deadline chase nobody had to run.",
    before: "Chasing records before a filing date was a person, a spreadsheet, and the same three emails every quarter.",
    after: "Each client is asked for exactly what is missing, on a schedule, and you see only what is still outstanding.",
    route: ["Deadline", "Chased", "Filed"],
    accent: "#5c4a6b",
    tint: "rgba(92, 74, 107, .11)",
  },
];

/** Three beats on a line — the same shape as the route strips elsewhere. */
function RouteMark() {
  return (
    <svg aria-hidden="true" className={styles.mark} viewBox="0 0 172 48">
      <line className={styles.markLine} x1="24" x2="148" y1="24" y2="24" />
      <circle className={styles.markNode} cx="24" cy="24" r="9" />
      <circle className={styles.markNode} cx="86" cy="24" r="9" />
      <circle className={styles.markNode} cx="148" cy="24" r="9" />
      <circle className={styles.markLive} cx="86" cy="24" r="4" />
    </svg>
  );
}

export default function StoriesPage() {
  return (
    <main className={styles.shell}>
      <SiteTop active="stories" />

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
            <p className={styles.label}>Read this first</p>
            <p>
              Ajani is new, so these are worked examples of the systems we build
              rather than named client stories. Nothing here is a customer quote or
              a measured result. As clients are ready to be named, their stories
              take these slots.
            </p>
          </Reveal>
        </div>
      </section>

      {/* The featured build, given the room a lead story deserves */}
      <section className={styles.section}>
        <Reveal className={styles.sectionHead}>
          <div className={styles.headMain}>
            <p className={styles.label}>Featured</p>
            <h2>One build, <em>start to finish.</em></h2>
          </div>
          <div className={styles.headAside}>
            <p>The clearest way to explain what we hand over is to follow a single job through it.</p>
          </div>
        </Reveal>

        <div className={styles.feature}>
          <Reveal className={styles.featureLog} delay={90}>
            <div className={styles.logHead}>
              <span>Worked example</span>
              <em>Lead response</em>
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

      {/* The rest of the shelf */}
      <section className={`${styles.section} ${styles.sectionEnd}`}>
        <Reveal className={styles.sectionHead}>
          <div className={styles.headMain}>
            <p className={styles.label}>More of the work</p>
            <h2>Different trades, <em>the same shape.</em></h2>
          </div>
          <div className={styles.headAside}>
            <p>Six more builds, each one a moment that used to depend on somebody remembering.</p>
          </div>
        </Reveal>

        <div className={styles.grid}>
          {stories.map((story, index) => (
            <Reveal
              as="article"
              className={styles.card}
              delay={(index % 3) * 90}
              key={story.title}
              style={{ "--accent": story.accent, "--tint": story.tint } as CSSProperties}
            >
              <div className={styles.cardMark}><RouteMark /></div>
              <div className={styles.cardBody}>
                <p className={styles.kicker}>{story.kicker}</p>
                <h3>{story.title}</h3>
                <p className={styles.before}><b>Before</b>{story.before}</p>
                <p className={styles.after}><b>Now</b>{story.after}</p>
                <div className={styles.route}>
                  {story.route.map((step, position) => (
                    <span key={step}>
                      {step}
                      {position < story.route.length - 1 ? <i aria-hidden="true">→</i> : null}
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
            <Link className={styles.primaryCta} href="/record">
              Record a note <span aria-hidden="true">→</span>
            </Link>
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

      <SiteFoot />
    </main>
  );
}
