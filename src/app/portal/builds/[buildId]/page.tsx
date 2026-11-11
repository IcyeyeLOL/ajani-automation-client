import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConversationThread } from "@/components/builds/conversation-thread";
import { BuildMessageForm } from "@/components/portal/build-message-form";
import { openQuestions } from "@/lib/builds/conversation";
import { clipText } from "@/lib/text/clip";
import { loadPortalBuildDetail } from "@/lib/portal/dashboard";
import styles from "../../portal.module.css";

export const metadata: Metadata = { title: "Request detail | Ajani Automation" };
export const dynamic = "force-dynamic";

export default async function BuildDetailPage({ params }: PageProps<"/portal/builds/[buildId]">) {
  const { buildId } = await params;
  const result = await loadPortalBuildDetail(buildId);
  if (result.available && !result.detail) notFound();
  if (!result.detail) return <div className={styles.page}>
    <Link className={styles.textBack} href="/portal/builds">← Back to requests</Link>
    <div className={styles.dataNotice} role="status"><i /><span>This request is temporarily unavailable. Your saved work has not been lost.</span></div>
  </div>;

  const { build, events, linkedSystem, plainLanguageScope, questions, steps, thread, threadTotal, transcript, voiceMemo } = result.detail;
  const reference = build.id.slice(0, 8).toUpperCase();
  // Both cover the whole thread, so an open question older than the posts shown still reads here.
  const waitingCount = build.openQuestions;
  const latestQuestion = waitingCount ? build.openQuestion ?? openQuestions(thread).at(-1)?.body ?? null : null;
  // Asked before the newest posts shown: print it in full, or the client cannot see what to answer.
  const olderQuestion = latestQuestion && !openQuestions(thread).some((message) => message.body === latestQuestion) ? latestQuestion : null;

  return <div className={styles.page}>
    <Link className={styles.textBack} href="/portal/builds">← Back to requests</Link>
    {waitingCount ? <a className={styles.questionBanner} href="#open-question">
      <i aria-hidden="true">?</i>
      <span><b>{waitingCount === 1 ? "Ajani has a question for you." : `Ajani has ${waitingCount} questions for you.`}</b><small>{latestQuestion ? excerpt(latestQuestion) : "Open the conversation below to answer."}</small></span>
      <em>Answer <span aria-hidden="true">→</span></em>
    </a> : null}
    <header className={styles.detailHeader}>
      <div className={styles.detailHeaderMain}>
        <span className={styles.statusPill} data-status={build.status}><i />{build.statusLabel}</span>
        <p className={styles.eyebrow}>Request / {reference}</p>
        <h1>{build.title}</h1>
        <p>{build.summary}</p>
      </div>
      <dl className={styles.detailReceipt}>
        <div><dt>Reference</dt><dd>{reference}</dd></div>
        <div><dt>Received</dt><dd>{build.created}</dd></div>
        <div><dt>Approved route</dt><dd>{steps.length} steps</dd></div>
        <div><dt>Current scope</dt><dd>{build.price}</dd></div>
      </dl>
    </header>

    <section className={styles.detailLayout}>
      <div className={styles.detailContent}>
        <article className={styles.detailSection} id="conversation">
          <header>
            <span>01</span>
            <div><p className={styles.eyebrow}>Conversation</p><h2>Updates and questions.</h2></div>
            <small>{threadTotal ? `${threadTotal} ${threadTotal === 1 ? "post" : "posts"}` : "Nothing yet"}</small>
          </header>
          {threadTotal > thread.length ? <p className={styles.sectionEmpty}>Showing the newest {thread.length} of {threadTotal} posts.</p> : null}
          {olderQuestion ? <blockquote id="open-question"><b>Ajani asked earlier, still open:</b> {olderQuestion}</blockquote> : null}
          <ConversationThread clientName="You" closed={build.status === "cancelled"} thread={thread} viewer="client" />
          {build.status === "cancelled"
            ? <p className={styles.sectionEmpty}>This build was closed, so replies are switched off. To pick it up again, send Ajani a new request.</p>
            : <BuildMessageForm answering={waitingCount > 0} buildId={build.id} />}
        </article>

        <article className={styles.detailSection}>
          <header>
            <span>02</span>
            <div><p className={styles.eyebrow}>Source note</p><h2>What you told us.</h2></div>
            {voiceMemo ? <small>{voiceMemo.statusLabel}{voiceMemo.duration ? " · " + voiceMemo.duration : ""}</small> : <small>Written note</small>}
          </header>
          <blockquote>{transcript || "The approved written brief is attached to this request."}</blockquote>
        </article>

        <article className={styles.detailSection}>
          <header>
            <span>03</span>
            <div><p className={styles.eyebrow}>Confirmed decisions</p><h2>The answers shaping this build.</h2></div>
            <small>{questions.length} confirmed</small>
          </header>
          {questions.length ? <ol className={styles.decisionList}>
            {questions.map((question, index) => <li key={question.id}>
              <i>{String(index + 1).padStart(2, "0")}</i>
              <div><span>{question.question}</span><b>{question.answer ?? "Waiting for an answer"}</b></div>
            </li>)}
          </ol> : <p className={styles.sectionEmpty}>No separate clarification decisions were needed for this request.</p>}
        </article>

        <article className={styles.detailSection}>
          <header>
            <span>04</span>
            <div><p className={styles.eyebrow}>Approved route</p><h2>The system in build order.</h2></div>
            <small>{steps.length} workflow steps</small>
          </header>
          {steps.length ? <ol className={styles.workflowList}>
            {steps.map((step, index) => <li key={step.id}>
              <div className={styles.workflowIndex}><i>{String(index + 1).padStart(2, "0")}</i><span /></div>
              <div><small>{step.kind}</small><h3>{step.title}</h3><p>{step.detail}</p></div>
            </li>)}
          </ol> : <p className={styles.sectionEmpty}>The implementation route is being prepared.</p>}
        </article>

        <article className={styles.detailSection}>
          <header>
            <span>05</span>
            <div><p className={styles.eyebrow}>Approved scope</p><h2>The handoff Ajani received.</h2></div>
          </header>
          <div className={styles.scopeCopy}>{plainLanguageScope || "Scope details will appear after review."}</div>
        </article>
      </div>

      <aside className={styles.detailAside}>
        <section className={styles.nextStepCard}>
          <p className={styles.cardLabel}>What happens next</p>
          <span>{build.progress}% through delivery</span>
          <div className={styles.detailProgress}><i style={{ width: build.progress + "%" }} /></div>
          <h2>{build.statusLabel}</h2>
          <p>{build.nextStep}</p>
          {build.needsClient ? <a href={waitingCount ? "#open-question" : "#reply"}>{waitingCount ? "Answer Ajani" : "Reply to Ajani"} <i>→</i></a> : null}
        </section>

        <section className={styles.timelineCard}>
          <p className={styles.cardLabel}>Verified activity</p>
          {events.length ? <ol>
            {events.map((event) => <li key={event.id}>
              <i data-tone={event.tone} />
              <div><b>{event.title}</b><span>{event.when}</span></div>
            </li>)}
          </ol> : <p>No delivery updates have been posted yet.</p>}
        </section>

        <section className={styles.linkedSystemCard}>
          <p className={styles.cardLabel}>Linked automation</p>
          {linkedSystem ? <>
            <span><i data-health={linkedSystem.health} />{linkedSystem.healthLabel}</span>
            <h2>{linkedSystem.name}</h2>
            <p>{linkedSystem.lastRun}</p>
            <Link href="/portal/systems">Open systems →</Link>
          </> : <>
            <div aria-hidden="true"><i /><i /><i /></div>
            {build.status === "live" ? <>
              <h2>Live.</h2>
              <p>Ajani marked this build live. Its health checks are not connected to the portal yet, so anything you need to know comes through the conversation.</p>
            </> : <>
              <h2>Not live yet.</h2>
              <p>When this build is provisioned, its health and operating history will stay connected here.</p>
            </>}
          </>}
        </section>
      </aside>
    </section>
  </div>;
}

function excerpt(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${clipText(line, 139).trimEnd()}…` : line;
}
