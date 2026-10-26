import { currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { PendingRequestResumer } from "@/components/portal/pending-request-resumer";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { loadPortalDashboard, unconfiguredPortal, type PortalBuild } from "@/lib/portal/dashboard";
import styles from "./portal.module.css";

export const metadata: Metadata = { title: "My portal | Ajani Automation" };
export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const configured = hasClerkCredentials();
  const [user, data] = configured
    ? await Promise.all([currentUser(), loadPortalDashboard()])
    : [null, unconfiguredPortal()];
  const firstName = user?.firstName || user?.fullName?.split(" ")[0] || "there";
  const openBuilds = data.builds.filter((build) => !["live", "cancelled"].includes(build.status));
  const healthySystems = data.systems.filter((system) => system.health === "healthy");
  // An unanswered question from Ajani is the client's next move, wherever the build is.
  // A "Needs input" build the client already replied to is Ajani's move, not theirs.
  const questionBuild = data.builds.find((build) => build.openQuestions > 0);
  const decisionBuild = questionBuild ?? data.builds.find((build) => build.needsClient) ?? openBuilds[0] ?? data.builds[0];
  const decisionNeeded = Boolean(decisionBuild?.needsClient);
  const decisionCount = data.builds.filter((build) => build.needsClient).length;

  return <div className={styles.page}>
    {configured ? <PendingRequestResumer /> : null}
    {!data.available ? <div className={styles.dataNotice} role="status">
      <i aria-hidden="true" />
      <span><b>Your workspace is connected.</b> Live project data is taking longer than expected; refresh in a moment.</span>
    </div> : null}

    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>Overview / {data.businessName}</p>
        <h1>Good to see you, {firstName}.</h1>
        <span>Everything Ajani is reviewing, building, and running for you—in one clear place.</span>
      </div>
      <Link className={styles.headerAction} href="/record">Start a new request <i aria-hidden="true">→</i></Link>
    </header>

    <section aria-label="Workspace summary" className={styles.metricGrid}>
      <Metric copy={openBuilds.length === 1 ? "request moving" : "requests moving"} label="Open requests" value={String(openBuilds.length).padStart(2, "0")} />
      <Metric copy={healthySystems.length + " running normally"} label="Live systems" value={String(data.systems.length).padStart(2, "0")} />
      <Metric copy={data.nextBillingDate ? "renews " + data.nextBillingDate : "no active subscription"} label="Monthly care" value={data.monthlyRetainer} />
      <Metric copy={questionBuild ? "question from Ajani" : decisionBuild ? decisionBuild.statusLabel : "nothing waiting"} label="Next decision" value={decisionNeeded ? String(decisionCount).padStart(2, "0") : "—"} tone={decisionNeeded ? "attention" : undefined} />
    </section>

    <section className={styles.dashboardGrid}>
      <div className={styles.buildDesk}>
        <SectionHeading action={{ href: "/portal/builds", label: "View all requests" }} eyebrow="Build desk" title="What is moving now." />
        {data.builds.length ? <div className={styles.buildList}>
          {data.builds.slice(0, 4).map((build) => <BuildRow build={build} key={build.id} />)}
        </div> : <EmptyState
          action={{ href: "/record", label: "Start your first request" }}
          copy="Tell Ajani where work is slipping. Your approved workflow and every delivery update will stay here."
          title="Your build desk is ready."
        />}
      </div>

      <aside className={styles.nextMove}>
        <span className={styles.cardLabel}>Your next move</span>
        {decisionBuild ? <>
          <div className={styles.nextMoveStatus}><i data-status={questionBuild ? "needs_attention" : decisionBuild.status} /><span>{questionBuild ? "Question from Ajani" : decisionBuild.statusLabel}</span></div>
          <h2>{decisionBuild.title}</h2>
          <p>{questionBuild ? "Ajani asked you a question about this build. Your answer keeps the work moving." : decisionBuild.nextStep}</p>
          <div className={styles.nextMoveMeta}>
            <span><b>{decisionBuild.progress}%</b> through delivery</span>
            <span><b>{decisionBuild.price}</b> current scope</span>
          </div>
          {questionBuild
            ? <Link href={"/portal/builds/" + decisionBuild.id + "#open-question"}>Answer the question <i aria-hidden="true">→</i></Link>
            : <Link href={"/portal/builds/" + decisionBuild.id}>Open request <i aria-hidden="true">→</i></Link>}
        </> : <>
          <div className={styles.nextMoveMark} aria-hidden="true">A</div>
          <h2>Nothing needs your attention.</h2>
          <p>When Ajani needs an answer or approval, the decision will appear here with the context attached.</p>
          <Link href="/record">Request a build <i aria-hidden="true">→</i></Link>
        </>}
      </aside>
    </section>

    <section className={styles.section}>
      <SectionHeading action={{ href: "/portal/systems", label: "Open systems" }} eyebrow="Your automations" title="What is running for you." />
      {data.systems.length ? <div className={styles.systemGrid}>
        {data.systems.slice(0, 3).map((system) => <article className={styles.systemCard} key={system.id}>
          <header><span><i data-health={system.health} />{system.healthLabel}</span><small>{system.statusLabel}</small></header>
          <div className={styles.systemGlyph} aria-hidden="true"><i /><i /><i /></div>
          <h3>{system.name}</h3>
          <strong>{system.metric}</strong>
          <p>{system.lastRun}</p>
          {system.buildRequestId ? <Link href={"/portal/builds/" + system.buildRequestId}>View source build →</Link> : null}
        </article>)}
      </div> : <EmptyState
        copy="Approved builds become live systems here. Health, recent runs, and anything that needs review stay visible."
        title="No systems are live yet."
      />}
    </section>

    <section className={styles.lowerGrid}>
      <div className={styles.activityCard}>
        <SectionHeading eyebrow="Workspace activity" title="The latest movement." />
        {data.activity.length ? <ol className={styles.activityList}>
          {data.activity.slice(0, 6).map((item) => <li key={item.id}>
            <i data-tone={item.tone} />
            <div><b>{item.title}</b><span>{item.detail}</span></div>
            <Link aria-label={"Open " + item.detail} href={item.href}>{item.when}<i aria-hidden="true">→</i></Link>
          </li>)}
        </ol> : <div className={styles.quietEmpty}>Updates will collect here as your first request moves.</div>}
      </div>
      <aside className={styles.promiseCard}>
        <p className={styles.cardLabel}>How this workspace works</p>
        <h2>No black box.</h2>
        <p>You will always see what Ajani has, what is happening next, and whether anything needs your decision.</p>
        <ul>
          <li><i>01</i><span><b>Your request</b> stays attached to its approved scope.</span></li>
          <li><i>02</i><span><b>Build updates</b> appear in the same project history.</span></li>
          <li><i>03</i><span><b>Live systems</b> keep their health and source request connected.</span></li>
        </ul>
      </aside>
    </section>
  </div>;
}

function Metric({ copy, label, tone, value }: { copy: string; label: string; tone?: string; value: string }) {
  return <article className={styles.metric} data-tone={tone}>
    <span>{label}</span><strong>{value}</strong><small>{copy}</small>
  </article>;
}

function BuildRow({ build }: { build: PortalBuild }) {
  const progressStyle = { "--portal-progress": build.progress + "%" } as CSSProperties;
  return <Link className={styles.buildRow} href={"/portal/builds/" + build.id}>
    <div className={styles.buildRowMain}>
      <span className={styles.statusPill} data-status={build.status}><i />{build.statusLabel}</span>
      {build.openQuestions ? <span className={styles.questionPill}>Question for you</span> : null}
      <h3>{build.title}</h3>
      <p>{build.summary}</p>
    </div>
    <div className={styles.buildRowAside}>
      <span>{build.updated}</span>
      <b>{build.price}</b>
      <div aria-label={build.progress + "% through delivery"} className={styles.progress} style={progressStyle}><i /></div>
    </div>
    <i aria-hidden="true" className={styles.rowArrow}>→</i>
  </Link>;
}

function SectionHeading({ action, eyebrow, title }: { action?: { href: string; label: string }; eyebrow: string; title: string }) {
  return <header className={styles.sectionHeading}>
    <div><p className={styles.eyebrow}>{eyebrow}</p><h2>{title}</h2></div>
    {action ? <Link href={action.href}>{action.label} <i aria-hidden="true">→</i></Link> : null}
  </header>;
}

function EmptyState({ action, copy, title }: { action?: { href: string; label: string }; copy: string; title: string }) {
  return <div className={styles.emptyState}>
    <div aria-hidden="true"><i /><i /><i /></div>
    <section><h3>{title}</h3><p>{copy}</p></section>
    {action ? <Link href={action.href}>{action.label} <i aria-hidden="true">→</i></Link> : null}
  </div>;
}
