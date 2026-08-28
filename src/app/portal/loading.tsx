import styles from "./portal.module.css";

export default function PortalLoading() {
  return <div aria-label="Preparing your workspace" className={styles.loadingPage} role="status">
    <div className={styles.loadingHeader}><i /><i /><i /></div>
    <div className={styles.loadingMetrics}>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div>
    <div className={styles.loadingGrid}><i /><i /></div>
    <span>Preparing your workspace…</span>
  </div>;
}
