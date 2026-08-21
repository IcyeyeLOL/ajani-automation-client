"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import styles from "./audience-picker.module.css";

type Audience = {
  id: string;
  tab: string;
  headline: string;
  problem: string;
  /**
   * Path under /public once real photography exists for this business type.
   * Leave it out and the card is the thread alone — the layout works either
   * way, so images can land one at a time.
   */
  photo?: string;
  /** Alt text for that photo. Required whenever `photo` is set. */
  photoAlt?: string;
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
    photo: "/audiences/home-services.jpg",
    photoAlt: "A business owner at a desk, working through an enquiry on a laptop",
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
        data-photo={current.photo ? "yes" : "no"}
        id="audience-panel"
        key={current.id}
        role="tabpanel"
        tabIndex={0}
      >
        {/* The photo keeps the shape it was shot in — a fixed 3:2 frame rather
            than one stretched to match the copy, which cropped both sides off.
            Where there is no photo yet the example takes the left column, so
            the panel is the same two-column shape either way. */}
        {current.photo ? (
          <figure className={styles.shotPhoto}>
            <Image
              alt={current.photoAlt ?? ""}
              fill
              sizes="(max-width: 900px) 100vw, 46vw"
              src={current.photo}
            />
          </figure>
        ) : (
          <Example thread={current.thread} />
        )}

        <div className={styles.copy}>
          <h3>{current.headline}</h3>
          <p className={styles.problem}>{current.problem}</p>
          {current.photo ? <Example thread={current.thread} /> : null}
          <Link className={styles.panelCta} href="/record">
            Record a note about this <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function Example({ thread }: { thread: Audience["thread"] }) {
  return (
    <figure className={styles.example}>
      <figcaption>
        <b>Example</b>
        <span>{thread.stamp} · {thread.source}</span>
      </figcaption>
      <p className={styles.exampleIn}>
        {thread.kind === "message" ? `\u201c${thread.inbound}\u201d` : thread.inbound}
      </p>
      <p className={styles.exampleOut}>
        {thread.out}
        <span>{thread.outTo}</span>
      </p>
    </figure>
  );
}
