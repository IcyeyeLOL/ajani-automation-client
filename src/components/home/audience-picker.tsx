"use client";

import { useRef, useState } from "react";
import styles from "./audience-picker.module.css";

type Audience = {
  id: string;
  tab: string;
  headline: string;
  problem: string;
  system: string;
  route: [string, string, string];
  /**
   * A worked example of the moment, not a testimonial: what arrives, and what
   * Ajani sends back. `kind` is "message" when a person wrote in and "signal"
   * when nothing arrived at all and the gap itself is the trigger.
   */
  thread: {
    stamp: string;
    source: string;
    kind: "message" | "signal";
    inbound: string;
    out: string;
    outTo: string;
  };
};

const audiences: Audience[] = [
  {
    id: "home-services",
    tab: "Home services",
    headline: "The quote that never got followed up.",
    problem:
      "Someone asks for a price on a Friday afternoon. You mean to chase it Monday, the week fills up, and the job quietly goes to whoever answered first.",
    system: "Ajani replies while the enquiry is warm, captures what the job actually is, and puts the quote back in front of you when it needs a decision.",
    route: ["Enquiry", "Quote sent", "Chased"],
    thread: {
      stamp: "Fri 16:52",
      source: "Website form",
      kind: "message",
      inbound: "Hi, can you give me a price for a new boiler? Semi-detached, 3 bed.",
      out: "Thanks for getting in touch. That’ll be a straight swap or a combi — which is it? Either way I can get you a figure today.",
      outTo: "Sent to the customer · 16:52",
    },
  },
  {
    id: "clinics",
    tab: "Clinics & practices",
    headline: "The appointment nobody confirmed.",
    problem:
      "Bookings come in across phone, email and the website. Reminders go out when someone remembers, and the no-shows are the ones that never got a second touch.",
    system: "Ajani confirms, reminds, and reschedules in one thread, and tells your front desk only about the ones that need a person.",
    route: ["Booking", "Confirmed", "Reminded"],
    thread: {
      stamp: "Tue 19:20",
      source: "Missed call",
      kind: "message",
      inbound: "Trying to move my Thursday appointment, is there anything next week?",
      out: "No problem. Thursday 10:15 and Friday 14:00 are both free — reply with one and I’ll move it.",
      outTo: "Sent to the patient · 19:21",
    },
  },
  {
    id: "salons",
    tab: "Salons & studios",
    headline: "The client who just stopped coming.",
    problem:
      "A regular drifts off after eight weeks. There is no list of who is overdue, so the rebooking depends on whether someone happens to notice.",
    system: "Ajani watches the gap since the last visit and sends a genuinely timed nudge, with the reason it is being sent attached.",
    route: ["Last visit", "Gap noticed", "Rebooked"],
    thread: {
      stamp: "Week nine",
      source: "No booking since 12 June",
      kind: "signal",
      inbound: "Rebooks every six weeks. Nine have passed with no appointment and no contact.",
      out: "It’s been a while. Your usual Thursday 6pm is free next week if you’d like it.",
      outTo: "Sent to the client · 09:10",
    },
  },
  {
    id: "agencies",
    tab: "Agencies & consultants",
    headline: "The kickoff that started from scratch.",
    problem:
      "You had the whole conversation in the sales call. Then delivery asks the client the same questions again, and the relationship starts on the back foot.",
    system: "Ajani carries the context from first contact into the project brief, so the team starts knowing what you already know.",
    route: ["Call", "Brief built", "Team briefed"],
    thread: {
      stamp: "Mon 11:04",
      source: "Proposal accepted",
      kind: "signal",
      inbound: "Northgate signed. Everything agreed on the sales calls is spread across one thread and three emails.",
      out: "Brief built: scope, the decisions already made, and the two things they said were non-negotiable.",
      outTo: "Sent to your delivery team · 11:05",
    },
  },
  {
    id: "real-estate",
    tab: "Property & real estate",
    headline: "The enquiry answered four hours late.",
    problem:
      "Portal leads arrive in bulk at all hours. The first agent to reply usually gets the viewing, and by the evening the good ones are already booked elsewhere.",
    system: "Ajani answers immediately with the detail they asked for, qualifies the timeline, and hands you the ones worth your Saturday.",
    route: ["Portal lead", "Answered", "Viewing booked"],
    thread: {
      stamp: "Sat 07:41",
      source: "Portal enquiry",
      kind: "message",
      inbound: "Is the Elm Road flat still available? Could I see it this weekend?",
      out: "Still available. Sunday 11:00 and 14:30 are open — which suits? Floorplan and EPC attached.",
      outTo: "Sent to the buyer · 07:41",
    },
  },
  {
    id: "trades",
    tab: "Trades & field work",
    headline: "The day that got rearranged by phone.",
    problem:
      "A job overruns, two customers need moving, and the whole afternoon becomes a string of calls made from a van between sites.",
    system: "Ajani tells the affected customers, offers the next real slot, and updates the day without you touching the phone.",
    route: ["Overrun", "Customers told", "Day rebuilt"],
    thread: {
      stamp: "Wed 14:15",
      source: "Job overran",
      kind: "signal",
      inbound: "The morning call took three hours. Two afternoon appointments can no longer be met.",
      out: "Running behind today, sorry. I can come at 16:30, or first thing tomorrow — reply 1 or 2.",
      outTo: "Sent to both customers · 14:16",
    },
  },
];

export function AudiencePicker() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (index: number) => {
    const next = (index + audiences.length) % audiences.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  const onKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight") { event.preventDefault(); move(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(index - 1); }
    if (event.key === "Home") { event.preventDefault(); move(0); }
    if (event.key === "End") { event.preventDefault(); move(audiences.length - 1); }
  };

  const current = audiences[active];

  return (
    <div className={styles.picker}>
      <div aria-label="Choose a kind of business" className={styles.tabs} role="tablist">
        {audiences.map((audience, index) => (
          <button
            aria-controls="audience-panel"
            aria-selected={index === active}
            className={styles.tab}
            id={`audience-tab-${audience.id}`}
            key={audience.id}
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKey(event, index)}
            ref={(node) => { tabs.current[index] = node; }}
            role="tab"
            tabIndex={index === active ? 0 : -1}
            type="button"
          >
            {audience.tab}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`audience-tab-${current.id}`}
        className={styles.panel}
        id="audience-panel"
        key={current.id}
        role="tabpanel"
        tabIndex={0}
      >
        <figure className={styles.shot}>
          <figcaption className={styles.shotHead}>
            <span className={styles.shotTag}>Example</span>
            <span className={styles.shotStamp}>{current.thread.stamp} · {current.thread.source}</span>
          </figcaption>
          <div className={styles.thread}>
            <div className={`${styles.bubble} ${styles.inbound}`}>
              <p>
                {current.thread.kind === "message"
                  ? `\u201c${current.thread.inbound}\u201d`
                  : current.thread.inbound}
              </p>
              <span>{current.thread.kind === "message" ? "Incoming" : "Nobody wrote in — Ajani noticed"}</span>
            </div>
            <div className={`${styles.bubble} ${styles.outbound}`}>
              <p>{current.thread.out}</p>
              <span>{current.thread.outTo}</span>
            </div>
          </div>
        </figure>

        <div className={styles.copy}>
          <h3>{current.headline}</h3>
          <p className={styles.problem}>{current.problem}</p>
          <p className={styles.system}>{current.system}</p>
          <div className={styles.route}>
            {current.route.map((step, index) => (
              <span key={step}>
                {step}
                {index < current.route.length - 1 ? <i aria-hidden="true">→</i> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
