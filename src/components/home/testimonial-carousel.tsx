"use client";

import Image from "next/image";
import { type FocusEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { subscribeToMotionPreference } from "@/lib/motion/preference";
import styles from "./testimonial-pipeline.module.css";

const slideCount = 5;
const scrollSpeed = 58;
const cardGap = 16;

function ProjectRouteMedia({
  label,
  title,
  steps,
  tone,
  portraitSrc,
}: {
  label: string;
  title: string;
  steps: readonly string[];
  tone: "sage" | "plum";
  portraitSrc?: string;
}) {
  return (
    <div
      aria-label={portraitSrc ? undefined : `${title}: ${steps.join(", then ")}`}
      className={styles.workflowFrame}
      data-tone={tone}
      role={portraitSrc ? undefined : "img"}
    >
      <span className={styles.projectNumber}>{label}</span>
      <div className={portraitSrc ? styles.workflowWithPortrait : styles.workflowContent}>
        {portraitSrc && (
          <Image
            alt="Portrait of Devon, enhanced from a photo he supplied"
            className={styles.workflowPortrait}
            height={1254}
            sizes="(max-width: 620px) 96px, 126px"
            src={portraitSrc}
            width={1254}
          />
        )}
        <div aria-hidden={portraitSrc ? undefined : "true"} className={styles.workflowPanel}>
          <small>Illustrative route · client system private</small>
          <strong>{title}</strong>
          <ol>
            {steps.map((step, index) => (
              <li key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function LocalClientVideo({
  person,
  number,
  poster,
  source,
  captions,
  engaged,
  onPlay,
}: {
  person: string;
  number: string;
  poster: string;
  source: string;
  captions: string;
  engaged: boolean;
  onPlay: () => void;
}) {
  return (
    <div className={`${styles.videoFrame} ${styles.localVideoFrame}`}>
      {engaged ? (
        <video aria-label={`${person} client testimonial video`} autoPlay controls playsInline poster={poster} preload="metadata">
          <source src={source} type="video/mp4" />
          <track kind="captions" label="English" src={captions} srcLang="en" />
          Your browser does not support video playback.
        </video>
      ) : (
        <button
          aria-label={`Play ${person}'s client testimonial video`}
          className={`${styles.videoPoster} ${styles.localVideoPoster}`}
          onClick={onPlay}
          type="button"
        >
          <Image alt="" className={styles.localPosterBackdrop} fill sizes="(max-width: 620px) 100vw, 438px" src={poster} />
          <Image alt="" className={styles.localPosterImage} fill sizes="(max-width: 620px) 100vw, 438px" src={poster} />
          <span aria-hidden="true" className={styles.posterPlay}>
            <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z" /></svg>
          </span>
          <strong>Play {person}&apos;s client video</strong>
          <small>Scroll stops before playback</small>
        </button>
      )}
      <span className={styles.videoNumber}>{number} / Client video</span>
    </div>
  );
}

export function TestimonialCarousel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLOListElement>(null);
  const autoFrameRef = useRef<number | null>(null);
  const manualFrameRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const activeIndexRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; didDrag: boolean } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [focusPaused, setFocusPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [engagedVideo, setEngagedVideo] = useState<number | null>(null);

  useEffect(() => subscribeToMotionPreference(setPrefersReducedMotion), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const syncVisibility = () => setPageVisible(!document.hidden);
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.18 })
      : null;

    let fallbackTimeout: number | undefined;
    if (observer) observer.observe(root);
    else fallbackTimeout = window.setTimeout(() => setInView(true), 0);
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();

    return () => {
      observer?.disconnect();
      if (fallbackTimeout !== undefined) window.clearTimeout(fallbackTimeout);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  const positionCards = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>(":scope > li"));
    const cardWidth = cards[0]?.offsetWidth;
    if (!cardWidth) return;

    const step = cardWidth + cardGap;
    const cycle = step * slideCount;
    const offset = ((offsetRef.current % cycle) + cycle) % cycle;
    const pixelRatio = window.devicePixelRatio || 1;
    offsetRef.current = offset;

    for (const [index, card] of cards.entries()) {
      let x = index * step - offset;
      if (x < -cardWidth) x += cycle;
      const alignedX = Math.round(x * pixelRatio) / pixelRatio;
      card.style.transform = `translate3d(${alignedX}px, 0, 0)`;
    }

    const nearestIndex = Math.round(offset / step) % slideCount;
    if (nearestIndex !== activeIndexRef.current) {
      activeIndexRef.current = nearestIndex;
      setActiveIndex(nearestIndex);
    }
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(() => positionCards());
    observer.observe(rail);
    const frame = requestAnimationFrame(positionCards);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [positionCards]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (prefersReducedMotion) {
      const card = rail.querySelector<HTMLElement>(":scope > li");
      rail.scrollLeft = activeIndexRef.current * ((card?.offsetWidth ?? 0) + cardGap);
    } else {
      rail.scrollLeft = 0;
      positionCards();
    }
  }, [positionCards, prefersReducedMotion]);

  useEffect(() => () => {
    if (autoFrameRef.current !== null) cancelAnimationFrame(autoFrameRef.current);
    if (manualFrameRef.current !== null) cancelAnimationFrame(manualFrameRef.current);
  }, []);

  const goTo = useCallback((requestedIndex: number, behavior: ScrollBehavior = "smooth") => {
    const rail = railRef.current;
    const card = rail?.querySelector<HTMLElement>(":scope > li");
    if (!card) return;

    const nextIndex = (requestedIndex + slideCount) % slideCount;
    const step = card.offsetWidth + cardGap;
    const cycle = step * slideCount;
    const current = ((offsetRef.current % cycle) + cycle) % cycle;
    const destination = [nextIndex * step - cycle, nextIndex * step, nextIndex * step + cycle]
      .reduce((closest, candidate) => Math.abs(candidate - current) < Math.abs(closest - current) ? candidate : closest);

    if (manualFrameRef.current !== null) cancelAnimationFrame(manualFrameRef.current);
    manualFrameRef.current = null;
    setEngagedVideo(null);
    if (behavior === "auto" || prefersReducedMotion) {
      offsetRef.current = destination;
      positionCards();
      return;
    }

    const origin = current;
    const distance = destination - origin;
    let startedAt: number | null = null;
    const animate = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min((now - startedAt) / 460, 1);
      const eased = (1 - Math.cos(Math.PI * progress)) / 2;
      offsetRef.current = origin + distance * eased;
      positionCards();
      manualFrameRef.current = progress < 1 ? requestAnimationFrame(animate) : null;
    };
    manualFrameRef.current = requestAnimationFrame(animate);
  }, [positionCards, prefersReducedMotion]);

  const shouldAutoAdvance = autoPlay
    && !focusPaused
    && inView
    && pageVisible
    && engagedVideo === null
    && !prefersReducedMotion;
  const pauseReason = shouldAutoAdvance
    ? "none"
    : engagedVideo !== null
      ? "video"
      : !autoPlay
        ? "manual"
        : prefersReducedMotion
          ? "reduced-motion"
          : focusPaused
            ? "focus"
            : !inView
              ? "offscreen"
              : !pageVisible
                ? "tab-hidden"
                : "unknown";

  useEffect(() => {
    if (!shouldAutoAdvance) return;
    let lastTime: number | null = null;
    const tick = (now: number) => {
      if (lastTime !== null) offsetRef.current += Math.min(now - lastTime, 64) * scrollSpeed / 1000;
      lastTime = now;
      positionCards();
      autoFrameRef.current = requestAnimationFrame(tick);
    };
    autoFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (autoFrameRef.current !== null) cancelAnimationFrame(autoFrameRef.current);
      autoFrameRef.current = null;
    };
  }, [positionCards, shouldAutoAdvance]);

  const handlePointerDown = (event: PointerEvent<HTMLOListElement>) => {
    if (prefersReducedMotion || event.pointerType === "mouse" || (event.target as HTMLElement).closest("button, a, video, iframe")) return;
    if (manualFrameRef.current !== null) cancelAnimationFrame(manualFrameRef.current);
    manualFrameRef.current = null;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: offsetRef.current, didDrag: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLOListElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.didDrag && Math.abs(drag.startX - event.clientX) < 8) return;
    if (!drag.didDrag) {
      drag.didDrag = true;
      setAutoPlay(false);
    }
    offsetRef.current = drag.startOffset + drag.startX - event.clientX;
    positionCards();
  };

  const handlePointerEnd = (event: PointerEvent<HTMLOListElement>) => {
    const didDrag = dragRef.current?.pointerId === event.pointerId && dragRef.current.didDrag;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (didDrag) goTo(activeIndexRef.current);
  };

  const startVideo = (index: number) => {
    goTo(index, "auto");
    setAutoPlay(false);
    setFocusPaused(false);
    setEngagedVideo(index);
  };

  const handleCarouselBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusPaused(false);
  };

  return (
    <div
      aria-label="Client proof carousel"
      aria-roledescription="carousel"
      className={styles.carousel}
      data-active-index={activeIndex}
      data-carousel-state={shouldAutoAdvance ? "playing" : "paused"}
      data-pause-reason={pauseReason}
      data-testid="testimonial-carousel"
      onBlur={handleCarouselBlur}
      onFocus={() => setFocusPaused(true)}
      ref={rootRef}
      role="group"
    >
      <div className={styles.railHead}>
        <div>
          <p><strong>01–05</strong> Client proof library</p>
          <p>Three client videos and two named projects.</p>
        </div>

        <div aria-label="Client proof controls" className={styles.carouselControls} role="group">
          <span className={styles.carouselCount}>
            {String(activeIndex + 1).padStart(2, "0")} / {String(slideCount).padStart(2, "0")}
          </span>
          {prefersReducedMotion ? (
            <span className={styles.motionPreference}>Motion reduced</span>
          ) : (
            <button
              aria-label={autoPlay ? "Pause client proof scroll" : "Play client proof scroll"}
              aria-pressed={!autoPlay}
              className={`${styles.carouselButton} ${styles.rotationButton}`}
              data-carousel-control="rotation"
              onClick={() => {
                setFocusPaused(false);
                if (autoPlay) {
                  setAutoPlay(false);
                  setAnnouncement(`Showing client proof ${activeIndexRef.current + 1} of ${slideCount}.`);
                  goTo(activeIndexRef.current);
                } else {
                  if (manualFrameRef.current !== null) cancelAnimationFrame(manualFrameRef.current);
                  manualFrameRef.current = null;
                  setEngagedVideo(null);
                  setAutoPlay(true);
                }
              }}
              type="button"
            >
              {autoPlay ? (
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 4h3v12H6zm5 0h3v12h-3z" /></svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 8 6-8 6V4Z" /></svg>
              )}
              <span>{autoPlay ? "Pause" : "Play"}</span>
            </button>
          )}
        </div>
      </div>

      <p className={styles.carouselHint}>
        {engagedVideo !== null
          ? "Video active · automatic scroll is paused"
          : shouldAutoAdvance
          ? "Scrolling continuously · press pause to inspect a proof"
          : autoPlay && !prefersReducedMotion
            ? "Paused while you inspect this proof"
            : "Paused · press play to resume or swipe to explore"}
      </p>
      <span aria-live="polite" className={styles.srOnly}>{announcement}</span>

      <ol
        aria-label="Five client proof slides"
        className={styles.rail}
        data-reduced-motion={prefersReducedMotion}
        data-pause-carousel="true"
        data-testid="testimonial-rail"
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onScroll={(event) => {
          if (!prefersReducedMotion) return;
          const card = event.currentTarget.querySelector<HTMLElement>(":scope > li");
          const step = (card?.offsetWidth ?? 0) + cardGap;
          if (!step) return;
          const index = Math.min(slideCount - 1, Math.round(event.currentTarget.scrollLeft / step));
          activeIndexRef.current = index;
          setActiveIndex(index);
        }}
        onWheel={(event) => {
          if (prefersReducedMotion) return;
          if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
          if ((event.target as HTMLElement).closest("video, iframe")) return;
          setAutoPlay(false);
          offsetRef.current += event.deltaX;
          positionCards();
        }}
        ref={railRef}
      >
        <li className={styles.railItem} data-proof-slide-index="0">
          <article
            aria-label="1 of 5: Dexter Game4Good testimonial video"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.currentCard}`}
            data-active={activeIndex === 0 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <LocalClientVideo
              captions="/videos/testimonials/dexter-game4good.vtt"
              engaged={engagedVideo === 0}
              number="01"
              onPlay={() => startVideo(0)}
              person="Dexter"
              poster="/images/stories/dexter-game4good-poster.jpg"
              source="/videos/testimonials/dexter-game4good.mp4"
            />

            <div className={styles.cardBody}>
              <div className={styles.identityRow}>
                <span aria-hidden="true" className={styles.avatar}>D</span>
                <div>
                  <h3>Dexter</h3>
                  <p>CEO and founder · Game4Good</p>
                </div>
                <strong>Video available</strong>
              </div>

              <blockquote>
                “He&apos;s very talented at what he does. It&apos;s given me a lot of help.”
              </blockquote>

              <dl className={styles.resultRow}>
                <div>
                  <dt>System</dt>
                  <dd>Multiple AI agents and a cloud-backed operating workspace</dd>
                </div>
                <div>
                  <dt>Client-reported</dt>
                  <dd>Streamlined work and practical help, in Dexter&apos;s words</dd>
                </div>
              </dl>

              <div className={styles.cardFooter}>
                <a href="https://www.game4good.gg/" rel="noreferrer" target="_blank">
                  Visit Game4Good <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
          </article>
        </li>

        <li className={styles.railItem} data-proof-slide-index="1">
          <article
            aria-label="2 of 5: Machias Norwood testimonial video"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.currentCard}`}
            data-active={activeIndex === 1 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <LocalClientVideo
              captions="/videos/testimonials/machias-norwood.vtt"
              engaged={engagedVideo === 1}
              number="02"
              onPlay={() => startVideo(1)}
              person="Machias"
              poster="/images/stories/machias-norwood-poster.jpg"
              source="/videos/testimonials/machias-norwood.mp4"
            />

            <div className={styles.cardBody}>
              <div className={styles.identityRow}>
                <span aria-hidden="true" className={styles.avatar}>M</span>
                <div>
                  <h3>Machias Norwood</h3>
                  <p>Nonprofit team · email operations</p>
                </div>
                <strong>Video available</strong>
              </div>

              <blockquote>“The process was very easy to understand and apply.”</blockquote>

              <dl className={styles.resultRow}>
                <div>
                  <dt>System</dt>
                  <dd>Email agent for important messages, inbox organization, and draft replies</dd>
                </div>
                <div>
                  <dt>Client-reported</dt>
                  <dd>Easier, faster email triage, as described in Machias&apos;s video</dd>
                </div>
              </dl>

            </div>
          </article>
        </li>

        <li className={styles.railItem} data-proof-slide-index="2">
          <article
            aria-label="3 of 5: Karol client testimonial video"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.currentCard}`}
            data-active={activeIndex === 2 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <div className={styles.videoFrame}>
              {engagedVideo === 2 ? (
                <iframe
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  src="https://www.youtube-nocookie.com/embed/upEkMB8pYRA?autoplay=1&rel=0"
                  title="Karol client testimonial video in the client proof carousel"
                />
              ) : (
                <button
                  aria-label="Play Karol's client testimonial video"
                  className={styles.videoPoster}
                  onClick={() => startVideo(2)}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.posterPlay}>
                    <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z" /></svg>
                  </span>
                  <strong>Play Karol&apos;s client video</strong>
                  <small>Scroll stops before playback</small>
                </button>
              )}
              <span className={styles.videoNumber}>03 / Client video</span>
            </div>

            <div className={styles.cardBody}>
              <div className={styles.identityRow}>
                <span aria-hidden="true" className={styles.avatar}>K</span>
                <div>
                  <h3>Karol</h3>
                  <p>Granker&apos;s Team</p>
                </div>
                <strong>Video available</strong>
              </div>

              <blockquote>
                “He walks you through every step, keeps you in the loop, and delivers. You
                won&apos;t regret it.”
              </blockquote>

              <dl className={styles.resultRow}>
                <div>
                  <dt>System</dt>
                  <dd>Community, content, email, and connected workflow automation</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>Clear process · kept in the loop · delivered</dd>
                </div>
              </dl>

            </div>
          </article>
        </li>

        <li className={styles.railItem} data-proof-slide-index="3">
          <article
            aria-label="4 of 5: Devon Realtor research workspace"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.currentCard}`}
            data-active={activeIndex === 3 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <ProjectRouteMedia
              label="04 / Private workspace"
              portraitSrc="/images/stories/devon-portrait-enhanced.png"
              steps={["Import leads", "Research with sources", "Devon reviews"]}
              title="Realtor growth workspace"
              tone="sage"
            />

            <div className={styles.cardBody}>
              <div className={styles.identityRow}>
                <span aria-hidden="true" className={styles.avatar}>D</span>
                <div>
                  <h3>Devon</h3>
                  <p>Realtor Outreach · private workspace</p>
                </div>
                <strong>System built</strong>
              </div>

              <p className={styles.caseSummary}>
                Ajani built a workspace to import and research Realtor candidates, review source-backed
                briefs, and keep the next action visible to Devon&apos;s team.
              </p>

              <dl className={styles.resultRow}>
                <div>
                  <dt>Built</dt>
                  <dd>Lead import, scheduled research, and candidate review</dd>
                </div>
                <div>
                  <dt>Human control</dt>
                  <dd>Devon reviews fit and outreach before sending</dd>
                </div>
              </dl>

              <div className={styles.cardFooter}>
                <strong className={styles.privateStatus}>Private client workspace</strong>
              </div>
            </div>
          </article>
        </li>

        <li className={styles.railItem} data-proof-slide-index="4">
          <article
            aria-label="5 of 5: Tammy Ogar personal website"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.currentCard}`}
            data-active={activeIndex === 4 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <div className={styles.projectFrame}>
              <Image
                alt="Portrait of Tammy Ogar"
                className={styles.projectPortrait}
                fill
                sizes="(max-width: 640px) calc(100vw - 36px), (max-width: 1440px) 30.5vw, 438px"
                src="/images/stories/tammy-ogar-clean-cutout.png"
              />
              <span className={styles.projectNumber}>05 / Personal website</span>
            </div>

            <div className={styles.cardBody}>
              <div className={styles.identityRow}>
                <span aria-hidden="true" className={styles.avatar}>T</span>
                <div>
                  <h3>Tammy Ogar</h3>
                  <p>Otaakara Services · children&apos;s care</p>
                </div>
                <strong>Client personal website</strong>
              </div>

              <p className={styles.caseSummary}>
                Ajani built a responsive website that introduces Tammy, explains the care services and
                service area, and gives families a direct way to ask about availability.
              </p>

              <dl className={styles.resultRow}>
                <div>
                  <dt>Project</dt>
                  <dd>Care services, Tammy&apos;s story, frequently asked questions</dd>
                </div>
                <div>
                  <dt>Visitor path</dt>
                  <dd>Explore care options, then request availability by email or phone</dd>
                </div>
              </dl>

            </div>
          </article>
        </li>

      </ol>
    </div>
  );
}
