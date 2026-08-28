"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./error-state.module.css";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Ajani route error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main id="main-content" className={styles.page}>
      <section className={styles.card} aria-labelledby="error-title">
        <p className={styles.eyebrow}>Something interrupted the page</p>
        <h1 id="error-title">Your work is still safe.</h1>
        <p>Try loading this step again. If the problem continues, return to the homepage and retry in a moment.</p>
        <div className={styles.actions}>
          <button type="button" onClick={reset}>Try again</button>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}
