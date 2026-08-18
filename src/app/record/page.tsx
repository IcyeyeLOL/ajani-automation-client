import type { Metadata } from "next";
import Link from "next/link";
import { RecordFlow } from "@/components/record/record-flow";
import styles from "./record.module.css";

export const metadata: Metadata = {
  title: "Record a note · Ajani Automation",
  description: "Five steps from a voice note to a system you have approved. Nothing is charged, and no account is needed to start.",
};

export default function RecordPage() {
  return (
    <main className={styles.shell}>
      {/* The funnel keeps its own stripped header: one way back, no nav, because
          every extra link here is an exit. */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/">ajani<i>.</i></Link>
          <Link className={styles.back} href="/">← Back to home</Link>
        </div>
      </header>

      <RecordFlow />

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} Ajani Automation</span>
          <div className={styles.footerLinks}>
            <Link href="/">Home</Link>
            <Link href="/stories">Stories</Link>
            <Link href="/portal">Client portal</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
