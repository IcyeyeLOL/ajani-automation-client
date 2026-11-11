"use client";

import Link from "next/link";
import { type FocusEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./testimonial-pipeline.module.css";

const pendingSlots = ["03", "04", "05", "06"] as const;
const slideCount = 2 + pendingSlots.length;
const rotationDelay = 7_500;

function ArrowIcon({ direction }: { direction: "next" | "previous" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d={direction === "next" ? "M4 10h11m-4-4 4 4-4 4" : "M16 10H5m4-4-4 4 4 4"} />
    </svg>
  );
}

export function TestimonialCarousel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLOListElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [videoEngaged, setVideoEngaged] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

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

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const goTo = useCallback((requestedIndex: number, behavior: ScrollBehavior = "smooth") => {
    const rail = railRef.current;
    if (!rail) return;

    const nextIndex = (requestedIndex + slideCount) % slideCount;
    const slide = rail.querySelector<HTMLElement>(`[data-proof-slide-index="${nextIndex}"]`);
    if (!slide) return;

    const railBounds = rail.getBoundingClientRect();
    const slideBounds = slide.getBoundingClientRect();
    rail.scrollTo({
      behavior: prefersReducedMotion ? "auto" : behavior,
      left: rail.scrollLeft + slideBounds.left - railBounds.left,
    });
    if (nextIndex !== 1) setVideoEngaged(false);
    setActiveIndex(nextIndex);
  }, [prefersReducedMotion]);

  const shouldAutoAdvance = autoPlay
    && !hoverPaused
    && !focusPaused
    && inView
    && pageVisible
    && !videoEngaged
    && !prefersReducedMotion;
  const pauseReason = shouldAutoAdvance
    ? "none"
    : videoEngaged
      ? "video"
      : !autoPlay
        ? "manual"
        : prefersReducedMotion
          ? "reduced-motion"
          : hoverPaused
            ? "hover"
            : focusPaused
              ? "focus"
              : !inView
                ? "offscreen"
                : !pageVisible
                  ? "tab-hidden"
                  : "unknown";

  useEffect(() => {
    if (!shouldAutoAdvance) return;
    const timeout = window.setTimeout(() => goTo(activeIndex + 1), rotationDelay);
    return () => window.clearTimeout(timeout);
  }, [activeIndex, goTo, shouldAutoAdvance]);

  const syncActiveSlide = () => {
    const rail = railRef.current;
    if (!rail || scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const railLeft = rail.getBoundingClientRect().left;
      const slides = Array.from(rail.querySelectorAll<HTMLElement>("[data-proof-slide-index]"));
      let closestIndex = activeIndex;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const slide of slides) {
        const distance = Math.abs(slide.getBoundingClientRect().left - railLeft);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = Number(slide.dataset.proofSlideIndex ?? activeIndex);
        }
      }

      setActiveIndex((current) => current === closestIndex ? current : closestIndex);
    });
  };

  const pauseForManualNavigation = (index: number) => {
    const nextIndex = (index + slideCount) % slideCount;
    setAutoPlay(false);
    setAnnouncement(`Showing client proof ${nextIndex + 1} of ${slideCount}.`);
    goTo(nextIndex);
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
          <p><strong>01–06</strong> Client proof library</p>
          <p>One measured case, one current video, and four approval-ready positions.</p>
        </div>

        <div aria-label="Client proof controls" className={styles.carouselControls} role="group">
          <span className={styles.carouselCount}>
            {String(activeIndex + 1).padStart(2, "0")} / {String(slideCount).padStart(2, "0")}
          </span>
          <button
            aria-label="Previous client proof"
            className={styles.carouselButton}
            data-carousel-control="previous"
            onClick={() => pauseForManualNavigation(activeIndex - 1)}
            type="button"
          >
            <ArrowIcon direction="previous" />
          </button>
          <button
            aria-label="Next client proof"
            className={styles.carouselButton}
            data-carousel-control="next"
            onClick={() => pauseForManualNavigation(activeIndex + 1)}
            type="button"
          >
            <ArrowIcon direction="next" />
          </button>
          {prefersReducedMotion ? (
            <span className={styles.motionPreference}>Motion reduced</span>
          ) : (
            <button
              aria-label={autoPlay ? "Pause client proof rotation" : "Play client proof rotation"}
              className={`${styles.carouselButton} ${styles.rotationButton}`}
              data-carousel-control="rotation"
              onClick={() => {
                setFocusPaused(false);
                setAutoPlay((current) => {
                  if (!current) setVideoEngaged(false);
                  return !current;
                });
              }}
              type="button"
            >
              {autoPlay ? (
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 4h3v12H6zm5 0h3v12h-3z" /></svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 8 6-8 6V4Z" /></svg>
              )}
            </button>
          )}
        </div>
      </div>

      <p className={styles.carouselHint}>
        {videoEngaged
          ? "Video active · automatic rotation is paused"
          : shouldAutoAdvance
          ? "Advancing automatically · hover, focus, swipe, or use an arrow to pause"
          : autoPlay && !prefersReducedMotion
            ? "Paused while you inspect this proof"
            : "Manual navigation · use the arrows, scrollbar, or swipe"}
      </p>
      <span aria-live="polite" className={styles.srOnly}>{announcement}</span>

      <ol
        aria-label="Six client proof slides"
        className={styles.rail}
        data-pause-carousel="true"
        data-testid="testimonial-rail"
        onMouseEnter={() => setHoverPaused(true)}
        onMouseLeave={() => setHoverPaused(false)}
        onPointerDown={() => {
          setAutoPlay(false);
          setVideoEngaged(false);
        }}
        onScroll={syncActiveSlide}
        onWheel={() => {
          setAutoPlay(false);
          setVideoEngaged(false);
        }}
        ref={railRef}
      >
        <li className={styles.railItem} data-proof-slide-index="0">
          <article
            aria-label="1 of 6: property and real-estate client result"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.resultCard}`}
            data-active={activeIndex === 0 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <div className={styles.caseVisual}>
              <span>01 / Measured case</span>
              <p>Property &amp; real estate</p>
              <strong>6 calls booked</strong>
              <small>Client-reported · month one</small>
            </div>

            <div className={styles.cardBody}>
              <div className={styles.placeholderStatus}>
                <div>
                  <span>Stronger result story</span>
                  <h3>Lead follow-up that created booked conversations</h3>
                </div>
                <strong>Identity withheld</strong>
              </div>

              <p className={styles.caseSummary}>
                Roughly 35 monthly leads and near-zero bookings became a visible follow-up route:
                immediate SMS, 24- and 48-hour nudges, then a 21-day email sequence.
              </p>

              <dl className={styles.resultRow}>
                <div>
                  <dt>Before</dt>
                  <dd>$800 per month in lead spend with near-zero booked calls</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>Six calls booked in the first month, as reported by the client</dd>
                </div>
              </dl>

              <div className={styles.cardFooter}>
                <Link href="/stories">
                  Inspect the client-work library <span aria-hidden="true">→</span>
                </Link>
                <small>Identity withheld; evidence and publication permission require launch review.</small>
              </div>
            </div>
          </article>
        </li>

        <li className={styles.railItem} data-proof-slide-index="1">
          <article
            aria-label="2 of 6: Karol client testimonial video"
            aria-roledescription="slide"
            className={`${styles.card} ${styles.currentCard}`}
            data-active={activeIndex === 1 ? "true" : "false"}
            data-testimonial-status="current"
          >
            <div className={styles.videoFrame}>
              {videoEngaged ? (
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
                  onClick={() => {
                    setAutoPlay(false);
                    setFocusPaused(false);
                    setVideoEngaged(true);
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.posterPlay}>
                    <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z" /></svg>
                  </span>
                  <strong>Play Karol&apos;s client video</strong>
                  <small>Rotation stops before playback</small>
                </button>
              )}
              <span className={styles.videoNumber}>02 / Current video</span>
            </div>

            <div className={styles.cardBody}>
              <div className={styles.identityRow}>
                <span aria-hidden="true" className={styles.avatar}>K</span>
                <div>
                  <h3>Karol</h3>
                  <p>Granker&apos;s Team · role not published</p>
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

              <div className={styles.cardFooter}>
                <Link href="/stories#client-story-heading">
                  Open the full client story <span aria-hidden="true">→</span>
                </Link>
                <small>Confirm publicity release and claim record before launch.</small>
              </div>
            </div>
          </article>
        </li>

        {pendingSlots.map((slot, pendingIndex) => {
          const slideIndex = pendingIndex + 2;
          return (
            <li className={styles.railItem} data-proof-slide-index={slideIndex} key={slot}>
              <article
                aria-label={`${slideIndex + 1} of ${slideCount}: future testimonial placeholder`}
                aria-roledescription="slide"
                className={`${styles.card} ${styles.placeholderCard}`}
                data-active={activeIndex === slideIndex ? "true" : "false"}
                data-testimonial-status="placeholder"
              >
                <div className={styles.mediaPlaceholder}>
                  <span>{slot} / Video position</span>
                  <strong>Awaiting approved client video</strong>
                  <small>16:9 video or client-approved image</small>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.placeholderStatus}>
                    <div>
                      <span>Internal preview</span>
                      <h3>Testimonial slot {slot}</h3>
                    </div>
                    <strong>Not for launch until approved</strong>
                  </div>

                  <div className={styles.placeholderIdentity}>
                    <p><span>Client</span> Approved name or explicit anonymity label</p>
                    <p><span>Role</span> Approved role and organization</p>
                  </div>

                  <blockquote>
                    Approved client wording will appear here. No endorsement has been entered.
                  </blockquote>

                  <dl className={styles.resultRow}>
                    <div>
                      <dt>System</dt>
                      <dd>Delivered workflow and named integrations</dd>
                    </div>
                    <div>
                      <dt>Result</dt>
                      <dd>Supported metric or clearly labeled client-reported outcome</dd>
                    </div>
                  </dl>

                  <footer className={styles.placeholderFooter}>
                    <i aria-hidden="true" /> Awaiting approved client material
                  </footer>
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
