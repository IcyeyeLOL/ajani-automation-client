"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { RecordNoteAction } from "@/components/record-note-action";
import styles from "./audience-picker.module.css";

type Direction = "forward" | "backward";

/** Set to false to restore the original Automation in practice card exactly. */
const ENABLE_AUTOMATION_IN_PRACTICE_PROTOTYPE = true;

type Audience = {
  id: string;
  tab: string;
  headline: string;
  problem: string;
  /** Completed workspace-card export from Figma. */
  photo?: string;
  /** Intrinsic dimensions preserve each card's intended framing. */
  photoWidth?: number;
  photoHeight?: number;
  /** Visible artwork bounds when the exported canvas includes transparent padding. */
  frameWidth?: number;
  frameHeight?: number;
  /** Alt text for that workspace card. Required whenever `photo` is set. */
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
    headline: "The lead that became a ready-to-send contract.",
    problem:
      "A new lead lands while you are on a job. Ajani captures what they need, pulls the right details together, and prepares the contract before the follow-up slips.",
    photo: "/audiences/workspace-code-plumber-v2.png",
    photoWidth: 1200,
    photoHeight: 902,
    frameWidth: 1008,
    frameHeight: 687,
    photoAlt: "Home services workspace showing a new lead becoming a prepared contract",
    thread: {
      stamp: "Fri 16:52",
      source: "New website lead",
      kind: "message",
      inbound: "Need a replacement boiler for a three-bed semi. Straight swap, ideally next week.",
      out: "Lead details captured, job terms inserted, and a customer-ready contract prepared for review.",
      outTo: "Contract ready for approval · 16:53",
    },
  },
  {
    id: "clinics",
    tab: "Clinics & practices",
    headline: "The cancellation that reopened its own slot.",
    problem:
      "A cancelled appointment should not leave a quiet hole in the diary. Ajani reopens the time and offers it to the right patients while the slot is still useful.",
    photo: "/audiences/clinics-practices.png",
    photoWidth: 1296,
    photoHeight: 667,
    photoAlt: "Clinic workspace showing a booking, cancellation, and newly opened slot",
    thread: {
      stamp: "Tue 19:20",
      source: "Missed call",
      kind: "message",
      inbound: "I need to cancel my Thursday 10:15 appointment. Sorry for the late notice.",
      out: "The appointment was cancelled, Thursday 10:15 reopened, and matching waitlist patients were offered the slot.",
      outTo: "Slot offered automatically · 19:21",
    },
  },
  {
    id: "salons",
    tab: "Salons & studios",
    headline: "The booking that handled its own follow-up.",
    problem:
      "Every booking can trigger the follow-up your team usually has to remember. Ajani sends the right aftercare and nudges the client when it is time to rebook.",
    photo: "/audiences/salons-studios-v2.png",
    photoWidth: 1296,
    photoHeight: 667,
    photoAlt: "Salon workspace showing a booking, automated follow-up, and rebooking reminder",
    thread: {
      stamp: "Thu 18:00",
      source: "Client booking",
      kind: "signal",
      inbound: "Maya books her usual colour appointment for Thursday at 6pm.",
      out: "Confirmation sent now, aftercare queued for Thursday evening, and a six-week rebooking nudge scheduled.",
      outTo: "Follow-up sequence scheduled",
    },
  },
  {
    id: "agencies",
    tab: "Agencies & consultants",
    headline: "The approved scope that invoiced itself.",
    problem:
      "Once a piece of work clears the agreed scope check, billing should not wait for someone to rebuild the details. Ajani turns that approval into the right invoice automatically.",
    photo: "/audiences/agencies-consultants.png",
    photoWidth: 1008,
    photoHeight: 692,
    photoAlt: "Consulting workspace showing a scope check becoming an automated invoice",
    thread: {
      stamp: "Mon 11:04",
      source: "Scope approved",
      kind: "signal",
      inbound: "Northgate approves phase one. The deliverables and payment milestone match the signed scope.",
      out: "Scope verified, billing details pulled from the project, and the phase-one invoice created and sent.",
      outTo: "Invoice sent automatically · 11:05",
    },
  },
  {
    id: "real-estate",
    tab: "Property & real estate",
    headline: "The request that found the right person automatically.",
    problem:
      "A tenant request should not sit in a shared inbox waiting to be interpreted. Ajani identifies the property, the issue, and the right person to handle it, then routes it instantly.",
    photo: "/audiences/trades-field-work.png",
    photoWidth: 1008,
    photoHeight: 692,
    photoAlt: "Property workspace showing a service request being automatically routed",
    thread: {
      stamp: "Tue 08:12",
      source: "Tenant portal",
      kind: "message",
      inbound: "The kitchen tap at Elm Road is leaking badly and the cabinet underneath is getting wet.",
      out: "Tagged as urgent plumbing, matched to Elm Road, and assigned to the approved maintenance contractor.",
      outTo: "Routed to maintenance · 08:13",
    },
  },
  {
    id: "trades",
    tab: "Trades & field work",
    headline: "The lead source you can finally tie to revenue.",
    problem:
      "Calls, ads, and referrals all create work, but most trade businesses cannot see which source actually pays. Ajani tags every lead, tracks the job, and keeps the ROI report current.",
    photo: "/audiences/property-real-estate.png",
    photoWidth: 1296,
    photoHeight: 667,
    photoAlt: "Field-work workspace showing a lead being tagged, tracked, and reported",
    thread: {
      stamp: "Mon 09:06",
      source: "Google Ads lead",
      kind: "message",
      inbound: "New boiler enquiry from a paid-search campaign becomes a quoted job, then a completed installation.",
      out: "Tagged as Paid Search, tracked from quote to completion, and the £3,200 job attributed to the campaign.",
      outTo: "ROI report updated automatically",
    },
  },
];

export function AudiencePicker() {
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState<Direction>("forward");
  const [loadedPhotos, setLoadedPhotos] = useState<Set<string>>(() => new Set());
  const [requestedPhotos, setRequestedPhotos] = useState<Set<number>>(() => new Set([0]));
  const [proofManuallyPaused, setProofManuallyPaused] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number, nextDirection: Direction) => {
    const next = (index + audiences.length) % audiences.length;
    if (next === active) return;
    setRequestedPhotos((requested) => new Set(requested).add(next));
    setDirection(nextDirection);
    setActive(next);
  };

  const move = (index: number, nextDirection: Direction) => {
    const next = (index + audiences.length) % audiences.length;
    select(next, nextDirection);
    tabs.current[next]?.focus();
  };

  const onKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight") { event.preventDefault(); move(index + 1, "forward"); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(index - 1, "backward"); }
    if (event.key === "Home") { event.preventDefault(); move(0, "backward"); }
    if (event.key === "End") { event.preventDefault(); move(audiences.length - 1, "forward"); }
  };

  const current = audiences[active];

  const markPhotoLoaded = (id: string) => {
    setLoadedPhotos((loaded) => {
      if (loaded.has(id)) return loaded;
      const next = new Set(loaded);
      next.add(id);
      return next;
    });
  };

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
            onClick={() => select(index, index > active ? "forward" : "backward")}
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
        data-direction={direction}
        data-photo={current.photo ? "yes" : "no"}
        id="audience-panel"
        role="tabpanel"
        tabIndex={0}
      >
        {current.photo ? (
          <div
            className={styles.shotStage}
            data-ready={loadedPhotos.has(current.id)}
            style={{ aspectRatio: `${current.frameWidth ?? current.photoWidth ?? 1} / ${current.frameHeight ?? current.photoHeight ?? 1}` }}
          >
            {audiences.map((audience, index) => audience.photo && requestedPhotos.has(index) ? (
              <figure
                aria-hidden={index !== active}
                className={styles.shotPhoto}
                data-active={index === active}
                data-audience={audience.id}
                data-ready={loadedPhotos.has(audience.id)}
                key={audience.id}
              >
                <Image
                  alt={audience.photoAlt ?? ""}
                  height={audience.photoHeight ?? 1}
                  loading={index === active && index !== 0 ? "eager" : "lazy"}
                  onLoad={() => markPhotoLoaded(audience.id)}
                  sizes="(max-width: 620px) calc(100vw - 32px), (max-width: 900px) calc(100vw - 48px), 46vw"
                  src={audience.photo}
                  width={audience.photoWidth ?? 1}
                />
              </figure>
            ) : null)}
          </div>
        ) : (
          <Example
            audienceId={current.id}
            manuallyPaused={proofManuallyPaused}
            onToggleManualPause={() => setProofManuallyPaused((value) => !value)}
            thread={current.thread}
          />
        )}

        <div className={styles.copy} data-audience-copy data-direction={direction} key={current.id}>
          <h3>{current.headline}</h3>
          <p className={styles.problem}>{current.problem}</p>
          <RecordNoteAction className={styles.panelCta}>
            Record a note about this <span aria-hidden="true">→</span>
          </RecordNoteAction>
        </div>

        {current.photo ? (
          <Example
            audienceId={current.id}
            key={`proof-${current.id}`}
            manuallyPaused={proofManuallyPaused}
            onToggleManualPause={() => setProofManuallyPaused((value) => !value)}
            thread={current.thread}
          />
        ) : null}
      </div>
    </div>
  );
}

function Example({
  audienceId,
  manuallyPaused,
  onToggleManualPause,
  thread,
}: {
  audienceId: string;
  manuallyPaused: boolean;
  onToggleManualPause: () => void;
  thread: Audience["thread"];
}) {
  if (!ENABLE_AUTOMATION_IN_PRACTICE_PROTOTYPE) {
    return <LegacyExample audienceId={audienceId} thread={thread} />;
  }

  return (
    <GuidedHandoffTrace
      audienceId={audienceId}
      manuallyPaused={manuallyPaused}
      onToggleManualPause={onToggleManualPause}
      thread={thread}
    />
  );
}

function GuidedHandoffTrace({
  audienceId,
  manuallyPaused,
  onToggleManualPause,
  thread,
}: {
  audienceId: string;
  manuallyPaused: boolean;
  onToggleManualPause: () => void;
  thread: Audience["thread"];
}) {
  const proof = useRef<HTMLElement>(null);
  const [hasEntered, setHasEntered] = useState(false);
  const [environmentPaused, setEnvironmentPaused] = useState(true);
  const paused = environmentPaused || manuallyPaused;

  useEffect(() => {
    const element = proof.current;
    if (!element) return;

    let inView = false;
    let frame: number | undefined;

    const syncEnvironmentPause = () => {
      setEnvironmentPaused(document.hidden || !inView);
    };

    document.addEventListener("visibilitychange", syncEnvironmentPause);

    if (typeof IntersectionObserver !== "function") {
      frame = requestAnimationFrame(() => {
        inView = true;
        setHasEntered(true);
        setEnvironmentPaused(document.hidden);
      });

      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        document.removeEventListener("visibilitychange", syncEnvironmentPause);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) setHasEntered(true);
        syncEnvironmentPause();
      },
      { threshold: 0.15 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncEnvironmentPause);
    };
  }, []);

  return (
    <figure
      className={`${styles.example} ${styles.examplePrototype}`}
      data-audience-proof={audienceId}
      data-story-active={String(hasEntered)}
      data-story-motion="true"
      data-story-paused={String(paused)}
      data-testid="audience-proof"
      ref={proof}
    >
      <figcaption>
        <span className={styles.exampleHeading}>
          <b><i aria-hidden="true" /> Automation in practice</b>
          <small>Illustrative</small>
        </span>
        <span className={styles.exampleMeta}>
          <span>{thread.stamp} · {thread.source}</span>
          <button
            aria-label={manuallyPaused ? "Play automation example" : "Pause automation example"}
            data-control-state={manuallyPaused ? "paused" : "playing"}
            onClick={onToggleManualPause}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 18 18">
              {manuallyPaused ? (
                <path d="m6.5 5 6.5 4-6.5 4z" />
              ) : (
                <path d="M6.5 5.2v7.6M11.5 5.2v7.6" />
              )}
            </svg>
          </button>
        </span>
      </figcaption>

      <div className={styles.exampleRoute}>
        <div className={styles.exampleStep} data-proof-stage="input">
          <b>01</b>
          <div>
            <small>{thread.kind === "message" ? "New input" : "Trigger detected"}</small>
            <p>{thread.inbound}</p>
          </div>
        </div>
        <div className={styles.exampleConnector} data-proof-connector="true">
          <i aria-hidden="true" />
          <span>Ajani handles the next step</span>
        </div>
        <div className={`${styles.exampleStep} ${styles.exampleAction}`} data-proof-stage="action">
          <b>02</b>
          <div>
            <small>Prepared action</small>
            <p>{thread.out}</p>
          </div>
        </div>
      </div>

      <footer data-proof-stage="result">
        <span aria-hidden="true" className={styles.outcomeMark} />
        <span className={styles.outcomeCopy}>
          <small>Example outcome</small>
          <strong>{thread.outTo}</strong>
        </span>
        <span aria-hidden="true" className={styles.outcomeRail}><i /></span>
      </footer>
    </figure>
  );
}

function LegacyExample({ audienceId, thread }: { audienceId: string; thread: Audience["thread"] }) {
  return (
    <figure className={styles.example} data-audience-proof={audienceId} data-testid="audience-proof">
      <figcaption>
        <b><i aria-hidden="true" /> Automation in practice</b>
        <span>{thread.stamp} · {thread.source}</span>
      </figcaption>
      <div className={styles.exampleRoute}>
        <div className={styles.exampleStep}>
          <b>01</b>
          <div>
            <small>{thread.kind === "message" ? "New input" : "Trigger detected"}</small>
            <p>{thread.inbound}</p>
          </div>
        </div>
        <div className={styles.exampleConnector}><i aria-hidden="true" /><span>Ajani handles the next step</span></div>
        <div className={`${styles.exampleStep} ${styles.exampleAction}`}>
          <b>02</b>
          <div>
            <small>Automated action</small>
            <p>{thread.out}</p>
          </div>
        </div>
      </div>
      <footer><i aria-hidden="true" />{thread.outTo}</footer>
    </figure>
  );
}
