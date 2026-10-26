import type { Metadata } from "next";
import Link from "next/link";
import { AdminBuildsShell } from "@/components/admin/builds-shell";
import { PostTime } from "@/components/builds/post-time";
import { ADMIN_BUILD_VIEWS, adminBuildView, loadAdminBuildList, sampleAdminBuildList, type AdminBuildViewId } from "@/lib/admin/builds";
import { isSampleMode } from "@/lib/admin/sample-mode";
import "../../builds.css";

export const metadata: Metadata = { title: "Client builds | Ajani Automation", robots: { index: false, follow: false } };

function viewHref(view: AdminBuildViewId, page = 1) {
  const query = new URLSearchParams();
  if (view !== "all") query.set("view", view);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `/admin/builds?${search}` : "/admin/builds";
}

export default async function AdminBuildsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const sampleMode = await isSampleMode();
  const view = adminBuildView(query.view);
  const list = sampleMode ? sampleAdminBuildList(view.id, query.page) : await loadAdminBuildList(view.id, query.page);
  // The database filters and pages every build; this page shows one page of one view.
  const builds = list.builds;
  const waitingOnYou = list.counts.you;

  return <AdminBuildsShell sampleMode={sampleMode}>
    <header className="admin-header">
      <div><p>08 / CLIENT WORK</p><h1>Client builds</h1></div>
      <p className="admin-builds-lede">{waitingOnYou ? `${waitingOnYou} ${waitingOnYou === 1 ? "client is" : "clients are"} waiting on a reply from you.` : "No client is waiting on you right now."}</p>
    </header>

    {list.status === "unavailable" ? <p className="admin-data-notice" role="status">Client builds could not be loaded. Check the database connection, and that the build conversation migration is applied, then refresh.</p> : null}

    <div className="admin-section-stack">
      <nav aria-label="Filter client builds" className="admin-builds-views">
        {ADMIN_BUILD_VIEWS.map((item) => {
          const count = list.counts[item.id];
          return <Link aria-current={item.id === view.id ? "page" : undefined} data-attention={item.id === "you" && count > 0 ? "" : undefined} href={viewHref(item.id)} key={item.id}>
            {item.label}<b>{count}</b>
          </Link>;
        })}
      </nav>

      {builds.length ? <ol className="admin-builds-list">
        {builds.map((build) => <li key={build.id}>
          <Link data-waiting={build.waitingOn ?? undefined} href={`/admin/builds/${build.id}`}>
            <span className="admin-build-stage" data-status={build.status}>{build.statusLabel}</span>
            <div className="admin-build-main">
              <small>{build.client}{build.requester ? ` · ${build.requester}` : ""}</small>
              <h2>{build.title}</h2>
              {build.lastPost ? <p><b>{build.lastPost.author === "ajani" ? "You" : "Client"}:</b> {build.lastPost.body}</p> : <p className="admin-build-quiet">Nothing posted yet. Open it to send the first update.</p>}
            </div>
            <div className="admin-build-side">
              {build.waitingOn === "ajani" ? <em className="admin-build-flag you">CLIENT WAITING</em>
                : build.waitingOn === "client" ? <em className="admin-build-flag client">{build.openQuestions > 1 ? `${build.openQuestions} QUESTIONS OUT` : build.openQuestions ? "QUESTION OUT" : "INPUT REQUESTED"}</em> : null}
              <PostTime timestamp={build.lastPost?.timestamp || build.updatedIso} />
            </div>
          </Link>
        </li>)}
      </ol> : <article className="admin-panel admin-builds-empty">
        <p>{list.counts.all ? "NOTHING IN THIS VIEW" : "NO CLIENT BUILDS YET"}</p>
        <h2>{list.counts.all ? "Nothing matches this filter." : "Builds appear here when a client submits a request."}</h2>
        {list.counts.all ? <Link href="/admin/builds">Show all builds →</Link> : null}
      </article>}
      {list.pageCount > 1 ? <nav aria-label="Pages of client builds" className="admin-builds-pages">
        {list.page > 1 ? <Link href={viewHref(view.id, list.page - 1)}>← Newer</Link> : <span />}
        <span>Page {list.page} of {list.pageCount}</span>
        {list.page < list.pageCount ? <Link href={viewHref(view.id, list.page + 1)}>Older →</Link> : <span />}
      </nav> : null}
    </div>
  </AdminBuildsShell>;
}
