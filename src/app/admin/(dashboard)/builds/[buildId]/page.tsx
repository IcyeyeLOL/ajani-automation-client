import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildPostForm } from "@/components/admin/build-post-form";
import { AdminBuildsShell } from "@/components/admin/builds-shell";
import { ConversationThread } from "@/components/builds/conversation-thread";
import { PostTime } from "@/components/builds/post-time";
import { loadAdminBuildDetail, sampleAdminBuildDetail } from "@/lib/admin/builds";
import { isSampleMode } from "@/lib/admin/sample-mode";
import "../../../builds.css";

export const metadata: Metadata = { title: "Client build | Ajani Automation", robots: { index: false, follow: false } };

export default async function AdminBuildPage({ params }: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await params;
  const sampleMode = await isSampleMode();
  const result = sampleMode ? sampleAdminBuildDetail(buildId) : await loadAdminBuildDetail(buildId);
  if (result.status === "available" && !result.detail) notFound();
  if (!result.detail) return <AdminBuildsShell sampleMode={sampleMode}>
    <Link className="admin-builds-back" href="/admin/builds">← All client builds</Link>
    <p className="admin-data-notice" role="status">This build could not be loaded right now. Nothing was lost; refresh in a moment.</p>
  </AdminBuildsShell>;

  const build = result.detail;
  // From the whole thread, not just the posts loaded below.
  const { openQuestions: questionsOut, waitingOn } = build.conversation;

  return <AdminBuildsShell sampleMode={sampleMode}>
    <Link className="admin-builds-back" href="/admin/builds">← All client builds</Link>
    <header className="admin-build-header">
      <div>
        <p>CLIENT BUILD / {build.client.business.toUpperCase()}</p>
        <h1>{build.title}</h1>
        {build.summary ? <span>{build.summary}</span> : null}
      </div>
      <dl>
        <div><dt>Stage</dt><dd><span className="admin-build-stage" data-status={build.status}>{build.statusLabel}</span></dd></div>
        <div><dt>Waiting on</dt><dd>{waitingOn === "ajani" ? "You" : waitingOn === "client" ? (questionsOut ? `Client (${questionsOut} ${questionsOut === 1 ? "question" : "questions"})` : "Client (input requested)") : "Nobody"}</dd></div>
        <div><dt>Received</dt><dd><PostTime timestamp={build.createdIso} /></dd></div>
        <div><dt>Scope</dt><dd>{build.price ?? "Not quoted"}</dd></div>
      </dl>
    </header>

    <div className="admin-build-layout">
      <article className="admin-panel admin-build-conversation">
        <header className="admin-panel-head">
          <div><p>CONVERSATION</p><h2>What the client sees.</h2></div>
          <span>{build.threadTotal} {build.threadTotal === 1 ? "POST" : "POSTS"}</span>
        </header>
        <div className="admin-build-conversation-body">
          {build.threadTotal > build.thread.length ? <p className="admin-data-notice" role="status">Showing the newest {build.thread.length} of {build.threadTotal} posts.</p> : null}
          <ConversationThread clientName={build.client.name || build.client.business} thread={build.thread} viewer="ajani" />
          <BuildPostForm buildId={build.id} clientEmail={build.client.email} clientReachable={build.client.reachable} sampleMode={sampleMode} status={build.status} />
        </div>
      </article>

      <aside className="admin-build-aside">
        <article className="admin-panel">
          <header className="admin-panel-head"><div><p>CLIENT</p><h2>{build.client.name || build.client.business}</h2></div></header>
          <dl className="admin-build-contact">
            <div><dt>Business</dt><dd>{build.client.business}</dd></div>
            <div><dt>Email</dt><dd>{build.client.email ? <a href={`mailto:${build.client.email}`}>{build.client.email}</a> : "Not on file"}</dd></div>
            <div><dt>Phone</dt><dd>{build.client.phone ? <a href={`tel:${build.client.phone.replace(/[^\d+]/g, "")}`}>{build.client.phone}</a> : "Not on file"}</dd></div>
          </dl>
        </article>

        <article className="admin-panel">
          <header className="admin-panel-head"><div><p>THE REQUEST</p><h2>What they asked for.</h2></div></header>
          <div className="admin-build-brief">
            {build.scope ? <p>{build.scope}</p> : <p className="admin-build-quiet">No approved scope was saved with this request.</p>}
            {build.transcript ? <details><summary>Their own words</summary><blockquote>{build.transcript}</blockquote></details> : null}
          </div>
        </article>

        <article className="admin-panel">
          <header className="admin-panel-head"><div><p>TIMELINE</p><h2>Stage history.</h2></div></header>
          {build.events.length ? <ol className="admin-build-timeline">
            {build.events.map((event) => <li key={event.id}><b>{event.label}</b><PostTime timestamp={event.timestamp} /></li>)}
          </ol> : <p className="admin-build-quiet admin-build-pad">No stage changes yet.</p>}
        </article>
      </aside>
    </div>
  </AdminBuildsShell>;
}
