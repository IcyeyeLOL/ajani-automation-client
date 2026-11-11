import type { Metadata } from "next";
import Link from "next/link";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { loadPortalBilling, type PortalBillingData } from "@/lib/portal/dashboard";
import styles from "../portal.module.css";

export const metadata: Metadata = { title: "Billing | Ajani Automation" };
export const dynamic = "force-dynamic";

const emptyBilling: PortalBillingData = { available: true, invoices: [], subscriptions: [] };

export default async function BillingPage() {
  const data = hasClerkCredentials() ? await loadPortalBilling() : emptyBilling;
  const active = data.subscriptions.find((subscription) => subscription.status === "active") ?? data.subscriptions[0];

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>Billing / Account</p>
        <h1>Simple, approved, and in writing.</h1>
        <span>Build pricing and ongoing care only appear after they are reviewed and connected to your workspace.</span>
      </div>
    </header>

    {!data.available ? <div className={styles.dataNotice} role="status"><i /><span>Billing records are temporarily unavailable. No payment action is required.</span></div> : null}

    {active ? <section className={styles.billingHero}>
      <div>
        <p className={styles.eyebrow}>Current care plan</p>
        <span className={styles.billingStatus} data-status={active.status}><i />{active.statusLabel}</span>
        <h2>{active.amount}<small> / {active.interval}</small></h2>
        <p>Ongoing monitoring and tuning connected to your active Ajani systems.</p>
      </div>
      <dl>
        <div><dt>Status</dt><dd>{active.statusLabel}</dd></div>
        <div><dt>Next renewal</dt><dd>{active.renews ?? "Not scheduled"}</dd></div>
        <div><dt>Payment changes</dt><dd>Handled with Ajani</dd></div>
      </dl>
    </section> : <section className={styles.billingEmpty}>
      <div aria-hidden="true"><span>$</span><i /><i /></div>
      <p className={styles.eyebrow}>No active billing</p>
      <h2>Nothing is being charged through this workspace.</h2>
      <p>You approve the scope and price in writing before any build or ongoing care plan begins. When billing is connected, its status and invoices will appear here.</p>
      <Link href="/portal/builds">Review your requests <i aria-hidden="true">→</i></Link>
    </section>}

    <section className={styles.invoiceSection}>
      <header className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>Invoice history</p><h2>Every connected payment.</h2></div>
      </header>
      {data.invoices.length ? <div className={styles.invoiceList}>
        {data.invoices.map((invoice) => <article key={invoice.id}>
          <span>{invoice.issued}</span>
          <div><b>{invoice.amount}</b><small>Invoice {invoice.id.slice(0, 8).toUpperCase()}</small></div>
          <em data-status={invoice.status}>{invoice.statusLabel}</em>
          {invoice.href ? <a href={invoice.href} rel="noreferrer" target="_blank">Open invoice ↗</a> : <span>Receipt pending</span>}
        </article>)}
      </div> : <div className={styles.quietEmpty}>No invoices are connected to this workspace yet.</div>}
    </section>

    <section className={styles.billingNote}>
      <i aria-hidden="true">i</i>
      <div><b>Questions about a proposal or invoice?</b><span>Reply to the Ajani email attached to that build so the context stays together.</span></div>
      <a href="mailto:olakunleajani@ajaniautomation.com">Email Ajani →</a>
    </section>
  </div>;
}
