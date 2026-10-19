"use client";

import Link from "next/link";
import { display, mono } from "./fonts";
import styles from "./error-state.module.css";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // This replaces the root layout, so it sets the font variables itself;
  // without them the headings' font-family is invalid and falls back to serif.
  return (
    <html className={`${display.variable} ${mono.variable}`} lang="en">
      <body>
        <main id="main-content" className={styles.page}>
          <section className={styles.card}>
            <p className={styles.eyebrow}>Ajani Automation</p>
            <h1>We could not load this page.</h1>
            <p>Nothing was submitted twice. Retry once, or return to the homepage.</p>
            <div className={styles.actions}>
              <button type="button" onClick={() => retry()}>Try again</button>
              <Link href="/">Return home</Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
