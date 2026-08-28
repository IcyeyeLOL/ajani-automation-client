import type { Metadata } from "next";
import Link from "next/link";
import styles from "./error-state.module.css";

export const metadata: Metadata = { title: "Page not found | Ajani Automation" };

export default function NotFound() {
  return (
    <main id="main-content" className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>404</p>
        <h1>That page is not here.</h1>
        <p>The link may be old, but your Ajani workspace has not been changed.</p>
        <div className={styles.actions}>
          <Link href="/">Return home</Link>
          <Link href="/record">Record a note</Link>
        </div>
      </section>
    </main>
  );
}
