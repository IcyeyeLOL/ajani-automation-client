"use client";

import Link from "next/link";
import styles from "./error-state.module.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main id="main-content" className={styles.page}>
          <section className={styles.card}>
            <p className={styles.eyebrow}>Ajani Automation</p>
            <h1>We could not load this page.</h1>
            <p>Nothing was submitted twice. Retry once, or return to the homepage.</p>
            <div className={styles.actions}>
              <button type="button" onClick={reset}>Try again</button>
              <Link href="/">Return home</Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
