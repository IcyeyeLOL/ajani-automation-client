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
  /** What to shoot or source for this slot. Replace the slot with a real image. */
  photo: string;
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
    photo: "A contractor or installer on site, phone in hand",
  },
  {
    id: "clinics",
    tab: "Clinics & practices",
    headline: "The appointment nobody confirmed.",
    problem:
      "Bookings come in across phone, email and the website. Reminders go out when someone remembers, and the no-shows are the ones that never got a second touch.",
    system: "Ajani confirms, reminds, and reschedules in one thread, and tells your front desk only about the ones that need a person.",
    route: ["Booking", "Confirmed", "Reminded"],
    photo: "A receptionist at a practice desk, mid-conversation",
  },
  {
    id: "salons",
    tab: "Salons & studios",
    headline: "The client who just stopped coming.",
    problem:
      "A regular drifts off after eight weeks. There is no list of who is overdue, so the rebooking depends on whether someone happens to notice.",
    system: "Ajani watches the gap since the last visit and sends a genuinely timed nudge, with the reason it is being sent attached.",
    route: ["Last visit", "Gap noticed", "Rebooked"],
    photo: "A stylist or studio owner with a client, warm interior",
  },
  {
    id: "agencies",
    tab: "Agencies & consultants",
    headline: "The kickoff that started from scratch.",
    problem:
      "You had the whole conversation in the sales call. Then delivery asks the client the same questions again, and the relationship starts on the back foot.",
    system: "Ajani carries the context from first contact into the project brief, so the team starts knowing what you already know.",
    route: ["Call", "Brief built", "Team briefed"],
    photo: "A small team around a laptop, working session",
  },
  {
    id: "real-estate",
    tab: "Property & real estate",
    headline: "The enquiry answered four hours late.",
    problem:
      "Portal leads arrive in bulk at all hours. The first agent to reply usually gets the viewing, and by the evening the good ones are already booked elsewhere.",
    system: "Ajani answers immediately with the detail they asked for, qualifies the timeline, and hands you the ones worth your Saturday.",
    route: ["Portal lead", "Answered", "Viewing booked"],
    photo: "An agent showing a property, or on the phone outside a house",
  },
  {
    id: "trades",
    tab: "Trades & field work",
    headline: "The day that got rearranged by phone.",
    problem:
      "A job overruns, two customers need moving, and the whole afternoon becomes a string of calls made from a van between sites.",
    system: "Ajani tells the affected customers, offers the next real slot, and updates the day without you touching the phone.",
    route: ["Overrun", "Customers told", "Day rebuilt"],
    photo: "A tradesperson at a van, tools visible, checking a phone",
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
        {/* Image slot — swap this whole figure for a next/image once photography exists. */}
        <figure className={styles.shot}>
          <div className={styles.shotFrame}>
            <span className={styles.shotBadge}>Photo</span>
            <p>{current.photo}</p>
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
