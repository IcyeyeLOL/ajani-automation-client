import styles from "./featured-client-proof.module.css";

type FeaturedClientProofProps = {
  className?: string;
};

const proofDetails = [
  {
    label: "The problem",
    detail: "Content, email, and the wider workflow were disconnected.",
  },
  {
    label: "What Ajani built",
    detail: "A connected workflow spanning community, content, and email.",
  },
  {
    label: "The result",
    detail: "Transparent, hands-on delivery that kept Karol in the loop and delivered the connected workflow.",
  },
] as const;

export function FeaturedClientProof({ className }: FeaturedClientProofProps) {
  return (
    <article
      aria-labelledby="featured-client-proof-title"
      className={[styles.card, className].filter(Boolean).join(" ")}
    >
      <header className={styles.header}>
        <span className={styles.proofLabel}>
          <i aria-hidden="true" /> Client proof
        </span>
        <span>Granker&apos;s Team</span>
      </header>

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

      <div className={styles.body}>
        <div className={styles.identity}>
          <span aria-hidden="true" className={styles.avatar}>K</span>
          <div>
            <h2 id="featured-client-proof-title">Karol</h2>
            <p>Granker&apos;s Team · Community &amp; content automation client</p>
          </div>
        </div>

        <blockquote>
          “He walks you through every step, keeps you in the loop, and delivers. You won&apos;t regret it.”
        </blockquote>

        <dl className={styles.details}>
          {proofDetails.map((item, index) => (
            <div key={item.label}>
              <dt><span aria-hidden="true">0{index + 1}</span>{item.label}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>

        <a
          className={styles.link}
          href="https://youtu.be/upEkMB8pYRA"
          rel="noreferrer"
          target="_blank"
        >
          Watch Karol&apos;s client story on YouTube <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
