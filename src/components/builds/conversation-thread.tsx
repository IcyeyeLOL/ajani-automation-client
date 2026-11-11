import { PostTime } from "@/components/builds/post-time";
import { openQuestions, type BuildThreadMessage } from "@/lib/builds/conversation";
import styles from "./conversation.module.css";

/**
 * One build's conversation, as either side sees it. The viewer's own posts
 * read "You"; an unanswered question is marked until the client replies, or
 * until the build is closed. The newest one is the page's #open-question.
 */
export function ConversationThread({ clientName, closed = false, thread, viewer }: { clientName: string; closed?: boolean; thread: BuildThreadMessage[]; viewer: "ajani" | "client" }) {
  if (!thread.length) {
    return <p className={styles.empty}>
      {viewer === "client"
        ? "No updates yet. Ajani posts progress here as the build moves, and you can ask a question any time below."
        : "Nothing posted yet. Your first update or question shows up in the client's portal right away."}
    </p>;
  }
  const openList = closed ? [] : openQuestions(thread);
  const open = new Set(openList.map((message) => message.id));
  const newestOpen = openList.at(-1)?.id;
  return <ol className={styles.thread}>
    {thread.map((message) => {
      const fromAjani = message.author === "ajani";
      const name = message.author === viewer ? "You" : fromAjani ? "Ajani" : clientName;
      const isOpen = open.has(message.id);
      const tag = message.kind === "question"
        ? isOpen ? viewer === "client" ? "Question for you" : "Waiting on the client" : "Question"
        : message.kind === "update" ? "Update" : null;
      return <li className={styles.post} data-author={message.author} data-kind={message.kind} data-mine={message.author === viewer} data-open={isOpen || undefined} id={message.id === newestOpen ? "open-question" : undefined} key={message.id}>
        <span aria-hidden="true" className={styles.mark}>{fromAjani ? "A" : initials(clientName)}</span>
        <article>
          <header>
            <b>{name}</b>
            {tag ? <span className={styles.tag}>{tag}</span> : null}
            <PostTime timestamp={message.timestamp} />
          </header>
          <p>{message.body}</p>
          {message.link ? <a className={styles.link} href={message.link.url} rel="noopener noreferrer nofollow" target="_blank">
            {message.link.label}<i aria-hidden="true">↗</i><span className={styles.srOnly}> (opens in a new tab)</span>
          </a> : null}
        </article>
      </li>;
    })}
  </ol>;
}

function initials(name: string) {
  const letters = name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "C";
}
