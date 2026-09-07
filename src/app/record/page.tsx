import type { Metadata } from "next";
import { RecordFlow } from "@/components/record/record-flow";
import { SiteFoot, SiteTop } from "@/components/site/chrome";
import styles from "./record.module.css";

export const metadata: Metadata = {
  title: "Record a note · Ajani Automation",
  description: "Five private steps from a voice note to a system you have approved. Nothing is charged before you approve.",
};

export default function RecordPage() {
  return (
    <div className={styles.shell}>
      <SiteTop subtitle="Private build request" tone="light" variant="funnel" />

      <main id="main-content" tabIndex={-1}>
        <RecordFlow />
      </main>

      <SiteFoot />
    </div>
  );
}
