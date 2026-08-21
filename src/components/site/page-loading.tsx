import styles from "./page-loading.module.css";

export function PageLoading() {
  return (
    <div aria-atomic="true" aria-live="polite" className={styles.screen} role="status">
      <div className={styles.desk}>
        <span className={styles.brand}>ajani<i>.</i></span>
        <div className={styles.copy}>
          <b>Loading your next view</b>
          <span>Preparing the live desk</span>
        </div>
        <div className={styles.route} aria-hidden="true">
          <i /><i /><i /><i />
        </div>
      </div>
    </div>
  );
}
