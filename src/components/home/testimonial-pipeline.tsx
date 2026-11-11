import { TestimonialCarousel } from "./testimonial-carousel";
import styles from "./testimonial-pipeline.module.css";

export function TestimonialPipeline() {
  return (
    <section aria-labelledby="client-work-title" className={styles.section} id="client-work">
      <div className={styles.inner}>
        <header className={styles.sectionHead}>
          <div className={styles.headingCopy}>
            <p className={styles.eyebrow}>Client proof library</p>
            <h2 id="client-work-title">
              Client proof library. <em>See the work move.</em>
            </h2>
          </div>
        </header>

        <TestimonialCarousel />

        <p className={styles.railNote}>
          The five proofs scroll in a continuous loop. Press Pause to inspect the nearest card,
          or swipe to explore on a touch screen.
        </p>
      </div>
    </section>
  );
}
