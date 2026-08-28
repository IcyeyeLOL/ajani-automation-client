import type { Metadata } from "next";
import Link from "next/link";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { emptyPortal, loadPortalDashboard } from "@/lib/portal/dashboard";
import styles from "../portal.module.css";

export const metadata: Metadata = { title: "Systems | Ajani Automation" };
export const dynamic = "force-dynamic";

export default async function SystemsPage() {
  const data = hasClerkCredentials() ? await loadPortalDashboard() : emptyPortal();
  const healthy = data.systems.filter((system) => system.health === "healthy").length;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>Systems / Operations</p>
        <h1>The work running without the chase.</h1>
        <span>Every live automation stays connected to its original request, current health, and latest recorded run.</span>
      </div>
      <Link className={styles.headerAction} href="/record">Request another system <i aria-hidden="true">→</i></Link>
    </header>

    <section aria-label="System summary" className={styles.systemSummary}>
      <div><span>Provisioned</span><b>{String(data.systems.length).padStart(2, "0")}</b></div>
      <div><span>Healthy</span><b>{String(healthy).padStart(2, "0")}</b></div>
      <div><span>Needs review</span><b>{String(data.systems.length - healthy).padStart(2, "0")}</b></div>
      <p><i />System health changes only when a real run or operator update is recorded.</p>
    </section>

    {!data.available ? <div className={styles.dataNotice} role="status"><i /><span>System health is temporarily unavailable.</span></div> : null}

    {data.systems.length ? <section className={styles.systemPageGrid}>
      {data.systems.map((system) => <article className={styles.systemPageCard} key={system.id}>
        <header>
          <span className={styles.healthBadge} data-health={system.health}><i />{system.healthLabel}</span>
          <small>{system.statusLabel}</small>
        </header>
        <div className={styles.systemRoute} aria-hidden="true"><i /><span /><i /><span /><i /></div>
        <p className={styles.eyebrow}>Automation system</p>
        <h2>{system.name}</h2>
        <strong>{system.metric}</strong>
        <p>{system.lastRun}</p>
        <footer>
          <span>Source request</span>
          {system.buildRequestId ? <Link href={"/portal/builds/" + system.buildRequestId}>Open build <i aria-hidden="true">→</i></Link> : <b>Not linked</b>}
        </footer>
      </article>)}
    </section> : <section className={styles.systemEmpty}>
      <div className={styles.systemEmptyVisual} aria-hidden="true">
        <span><i />Request</span><b>→</b><span><i />Build</span><b>→</b><span><i />Live system</span>
      </div>
      <p className={styles.eyebrow}>Your systems desk is ready</p>
      <h2>Your first approved build will become a system here.</h2>
      <p>Ajani will show its health, last successful run, and source request only after the automation is actually provisioned—no placeholder data.</p>
      <div><Link href="/portal/builds">Review your requests</Link><Link href="/record">Start a new request <i aria-hidden="true">→</i></Link></div>
    </section>}

    <section className={styles.operationsPromise}>
      <div><p className={styles.eyebrow}>What you will always know</p><h2>Operational clarity, not another dashboard to manage.</h2></div>
      <ol>
        <li><i>01</i><div><b>Is it running?</b><span>Health stays visible without opening another tool.</span></div></li>
        <li><i>02</i><div><b>What did it come from?</b><span>Every system links back to the request and approved route.</span></div></li>
        <li><i>03</i><div><b>Does Ajani need me?</b><span>Exceptions are called out; routine operation stays quiet.</span></div></li>
      </ol>
    </section>
  </div>;
}
