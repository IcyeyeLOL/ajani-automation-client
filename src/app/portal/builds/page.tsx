import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { loadPortalDashboard, unconfiguredPortal } from "@/lib/portal/dashboard";
import styles from "../portal.module.css";

export const metadata: Metadata = { title: "Requests | Ajani Automation" };
export const dynamic = "force-dynamic";

export default async function BuildsPage({ searchParams }: PageProps<"/portal/builds">) {
  const data = hasClerkCredentials() ? await loadPortalDashboard() : unconfiguredPortal();
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : "all";
  const query = typeof params.q === "string" ? params.q.trim().toLocaleLowerCase("en-US") : "";
  const builds = data.builds.filter((build) => {
    const matchesQuery = !query || (build.title + " " + build.summary + " " + build.category).toLocaleLowerCase("en-US").includes(query);
    if (!matchesQuery) return false;
    if (view === "active") return !["live", "cancelled"].includes(build.status);
    if (view === "live") return build.status === "live";
    if (view === "closed") return build.status === "cancelled";
    return true;
  });

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>Requests / Build history</p>
        <h1>Every request, clearly kept.</h1>
        <span>The original brief, approved route, decisions, delivery status, and any live system stay connected.</span>
      </div>
      <Link className={styles.headerAction} href="/record">New request <i aria-hidden="true">→</i></Link>
    </header>

    <section className={styles.requestToolbar}>
      <nav aria-label="Filter requests" className={styles.filterTabs}>
        <FilterLink active={view === "all"} href="/portal/builds" label="All" value={data.builds.length} />
        <FilterLink active={view === "active"} href="/portal/builds?view=active" label="Active" value={data.builds.filter((build) => !["live", "cancelled"].includes(build.status)).length} />
        <FilterLink active={view === "live"} href="/portal/builds?view=live" label="Live" value={data.builds.filter((build) => build.status === "live").length} />
        <FilterLink active={view === "closed"} href="/portal/builds?view=closed" label="Closed" value={data.builds.filter((build) => build.status === "cancelled").length} />
      </nav>
      <form action="/portal/builds" className={styles.requestSearch} method="get">
        {view !== "all" ? <input name="view" type="hidden" value={view} /> : null}
        <label>
          <span className={styles.srOnly}>Search requests</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 4.5 4.5" /></svg>
          <input defaultValue={typeof params.q === "string" ? params.q : ""} name="q" placeholder="Search your requests" />
        </label>
      </form>
    </section>

    {!data.available ? <div className={styles.dataNotice} role="status"><i /><span>Request history is temporarily unavailable. Your saved work has not been lost.</span></div> : null}

    {builds.length ? <section aria-label="Build requests" className={styles.requestList}>
      {builds.map((build, index) => {
        const progressStyle = { "--portal-progress": build.progress + "%" } as CSSProperties;
        return <Link className={styles.requestCard} href={"/portal/builds/" + build.id} key={build.id}>
          <div className={styles.requestIndex}>{String(index + 1).padStart(2, "0")}</div>
          <div className={styles.requestCardMain}>
            <div className={styles.requestCardHead}>
              <span className={styles.requestCardPills}>
                <span className={styles.statusPill} data-status={build.status}><i />{build.statusLabel}</span>
                {build.openQuestions ? <span className={styles.questionPill}>{build.openQuestions === 1 ? "Question for you" : `${build.openQuestions} questions for you`}</span> : null}
              </span>
              <small>{build.updated}</small>
            </div>
            <h2>{build.title}</h2>
            <p>{build.summary}</p>
            <div className={styles.requestFacts}>
              <span><b>{build.category}</b> request type</span>
              <span><b>{build.stepCount || "—"}</b> approved steps</span>
              <span><b>{build.price}</b> current scope</span>
            </div>
          </div>
          <div className={styles.requestCardSide}>
            <span>{build.progress}%</span>
            <div className={styles.progress} style={progressStyle}><i /></div>
            <p>{build.nextStep}</p>
            <b>Open request <i aria-hidden="true">→</i></b>
          </div>
        </Link>;
      })}
    </section> : <div className={styles.largeEmpty}>
      <div aria-hidden="true"><span>01</span><i /><span>02</span><i /><span>03</span></div>
      <p className={styles.eyebrow}>{data.builds.length ? "No matches" : "Your first request"}</p>
      <h2>{data.builds.length ? "Nothing matches that view." : "Start with the work that keeps slipping."}</h2>
      <p>{data.builds.length ? "Try another status or search phrase." : "A two-minute voice note becomes a clear workflow, then stays here from review through launch."}</p>
      {data.builds.length ? <Link href="/portal/builds">Clear filters</Link> : <Link href="/record">Start a request <i aria-hidden="true">→</i></Link>}
    </div>}
  </div>;
}

function FilterLink({ active, href, label, value }: { active: boolean; href: string; label: string; value: number }) {
  return <Link aria-current={active ? "page" : undefined} href={href}><span>{label}</span><i>{value}</i></Link>;
}
