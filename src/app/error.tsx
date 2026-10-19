"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./error-state.module.css";

// retry() refreshes the page data before rendering again, so it can recover
// from a server error; reset() would only re-render what already failed.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
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
          <button type="button" onClick={() => retry()}>Try again</button>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}
