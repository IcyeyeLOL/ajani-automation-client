import type { Metadata } from "next";
import Link from "next/link";
import { RecordFlow } from "@/components/record/record-flow";
import { SiteFoot } from "@/components/site/chrome";
import styles from "./record.module.css";

export const metadata: Metadata = {
  title: "Record a note · Ajani Automation",
  description: "Five private steps from a voice note to a system you have approved. Nothing is charged before you approve.",
};

export default function RecordPage() {
  return (
    <div className={styles.shell}>
      {/* The funnel keeps its own stripped header: one way back, no nav, because
          every extra link here is an exit. */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/">ajani<i>.</i></Link>
          <Link className={styles.back} href="/">Home</Link>
        </div>
      </header>

      <main>
        <RecordFlow />
      </main>

      <SiteFoot />
    </div>
  );
}
