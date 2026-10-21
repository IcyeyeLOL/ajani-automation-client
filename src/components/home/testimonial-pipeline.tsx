import { TestimonialCarousel } from "./testimonial-carousel";
import styles from "./testimonial-pipeline.module.css";

export function TestimonialPipeline() {
  return (
    <section aria-labelledby="client-voices-title" className={styles.section} id="client-voices">
      <div className={styles.inner}>
        <header className={styles.sectionHead}>
          <div className={styles.headingCopy}>
            <p className={styles.eyebrow}>Client proof / prelaunch layout</p>
            <h2 id="client-voices-title">
              Start with the stronger result. <em>Click through the proof.</em>
            </h2>
            <p>
              The measurable lead-follow-up case now opens the carousel. Karol&apos;s video remains
              available as the second story, followed by four positions for approved client videos.
            </p>
          </div>

          <aside aria-label="Publishing status" className={styles.launchGuard} role="note">
            <span>Internal preview</span>
            <strong>Four slots are intentionally unfinished.</strong>
            <p>
              Replace every placeholder with approved video, identity, wording, and a supportable
              result. A blank slot is not a client endorsement.
            </p>
          </aside>
        </header>

        <TestimonialCarousel />

        <p className={styles.railNote}>
          The arrows make every proof reachable without a long vertical stack. Automatic movement
          stops while a visitor inspects a card and can be disabled at any time.
        </p>
      </div>
    </section>
  );
}
