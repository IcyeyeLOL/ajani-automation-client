import { z } from "zod";

/**
 * A build's conversation: Ajani's progress updates and questions, and the
 * client's replies, in one thread per build (table build_messages).
 */

export const BUILD_MESSAGE_MAX_LENGTH = 4_000;
export const BUILD_LINK_LABEL_MAX_LENGTH = 80;
const BUILD_LINK_MAX_LENGTH = 2_000;

/** The stages Ajani moves a build through by hand. Quotes and payments move on their own. */
export const DELIVERY_STAGES = [
  { status: "in_review", label: "In review", hint: "Reading the request and shaping the plan." },
  { status: "in_progress", label: "In build", hint: "Building and connecting the system." },
  { status: "needs_attention", label: "Needs input", hint: "Work is paused until the client answers." },
  { status: "live", label: "Live", hint: "Delivered and running." },
  { status: "cancelled", label: "Closed", hint: "Stopped. It stays in the client's history." },
] as const;

export type DeliveryStage = (typeof DELIVERY_STAGES)[number]["status"];
const deliveryStatuses = DELIVERY_STAGES.map((stage) => stage.status) as [DeliveryStage, ...DeliveryStage[]];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  clarifying: "Clarifying",
  quoted: "Proposal ready",
  paid: "Approved",
  in_review: "In review",
  in_progress: "In build",
  live: "Live",
  needs_attention: "Needs input",
  cancelled: "Closed",
};

export function buildStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? titleCase(status);
}

export type BuildMessageAuthor = "ajani" | "client";
export type BuildMessageKind = "update" | "question" | "message";

export type BuildThreadMessage = {
  author: BuildMessageAuthor;
  body: string;
  id: string;
  kind: BuildMessageKind;
  link: { label: string; url: string } | null;
  timestamp: string;
};

type Row = Record<string, unknown>;

/** Database rows to a thread, oldest first (write order when rows carry it). Rows that could not have been written are dropped. */
export function shapeBuildThread(rows: Row[]): BuildThreadMessage[] {
  return [...rows].sort(writeOrder).flatMap((row): BuildThreadMessage[] => {
    const author = row.author_role === "ajani" || row.author_role === "client" ? row.author_role : null;
    const kind = row.kind === "update" || row.kind === "question" || row.kind === "message" ? row.kind : null;
    const body = typeof row.body === "string" ? row.body : "";
    if (!author || !kind || !body) return [];
    // Shown as a link only if it is still a safe https address.
    const url = typeof row.link_url === "string" ? safeHttpsLink(row.link_url) : null;
    const label = typeof row.link_label === "string" && row.link_label.trim() ? row.link_label.trim() : "Open link";
    return [{
      id: String(row.id),
      author,
      kind,
      body,
      link: url ? { url, label } : null,
      timestamp: typeof row.created_at === "string" ? row.created_at : "",
    }];
  });
}

/** build_messages.seq when both rows have it, since two posts can share a timestamp; otherwise time. */
function writeOrder(first: Row, second: Row) {
  if (typeof first.seq === "number" && typeof second.seq === "number") return first.seq - second.seq;
  return String(first.created_at ?? "").localeCompare(String(second.created_at ?? ""));
}

/** Ajani's questions the client has not replied to since they were asked. */
export function openQuestions(thread: BuildThreadMessage[]) {
  const lastClient = lastIndex(thread, (message) => message.author === "client");
  return thread.filter((message, index) => index > lastClient && message.author === "ajani" && message.kind === "question");
}

/** Where a build's conversation stands, over its whole history. */
export type ConversationState = {
  lastPost: { author: BuildMessageAuthor; body: string; timestamp: string } | null;
  /** The newest open question, which can be older than the posts a page loads. */
  openQuestion: string | null;
  openQuestions: number;
  postCount: number;
  waitingOn: BuildMessageAuthor | null;
};

/**
 * From a complete thread, e.g. sample data. Pages that load only the newest
 * posts use the database view, which applies the same rule: the client owes an
 * answer while a question is open, or while the build sits at "Needs input" and
 * they have not written since it was put there (flaggedAt). Otherwise a client
 * message waits on Ajani until Ajani posts after it.
 */
export function conversationState(thread: BuildThreadMessage[], build?: { flaggedAt: string | null; status: string }): ConversationState {
  // A closed build is finished business on both sides.
  const closed = build?.status === "cancelled";
  const open = closed ? [] : openQuestions(thread);
  const lastClient = lastIndex(thread, (message) => message.author === "client");
  const lastAjani = lastIndex(thread, (message) => message.author === "ajani");
  const clientAt = lastClient >= 0 ? thread[lastClient].timestamp : null;
  // With no logged move (older builds, hand edits), "Needs input" asks only until the client first writes.
  const flagged = build?.status === "needs_attention" && (clientAt === null || (build.flaggedAt !== null && clientAt < build.flaggedAt));
  const last = thread.at(-1);
  return {
    openQuestions: open.length,
    openQuestion: open.at(-1)?.body ?? null,
    waitingOn: closed ? null : open.length > 0 || flagged ? "client" : lastClient > lastAjani ? "ajani" : null,
    postCount: thread.length,
    lastPost: last ? { author: last.author, body: last.body, timestamp: last.timestamp } : null,
  };
}

/** When a build was last put at "Needs input", from its status_changed events. */
export function flaggedAt(events: Row[], buildId: string): string | null {
  return events
    .filter((event) => String(event.build_request_id) === buildId && event.event_type === "status_changed"
      && (event.payload as Row | null)?.to === "needs_attention" && typeof event.created_at === "string")
    .map((event) => String(event.created_at))
    .sort()
    .at(-1) ?? null;
}

/** From a build_conversation_state row, which covers the whole thread however long it is. */
export function conversationStateFromRow(row: Record<string, unknown>): ConversationState {
  const author = row.last_author === "ajani" || row.last_author === "client" ? row.last_author : null;
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  return {
    openQuestions: count(row.open_questions),
    openQuestion: typeof row.open_question_body === "string" ? row.open_question_body : null,
    waitingOn: row.waiting_on === "ajani" || row.waiting_on === "client" ? row.waiting_on : null,
    postCount: count(row.post_count),
    lastPost: author && typeof row.last_body === "string"
      ? { author, body: row.last_body, timestamp: typeof row.last_post_at === "string" ? row.last_post_at : "" }
      : null,
  };
}

export const BUILD_STATE_COLUMNS = "build_request_id,post_count,open_questions,open_question_body,waiting_on,last_author,last_body,last_post_at";

/** An https address safe to put in an href, or null. */
export function safeHttpsLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.href.length <= BUILD_LINK_MAX_LENGTH && !/[\s<>"]/.test(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

const ajaniPostFields = z.object({
  buildId: z.guid("This build could not be found. Refresh the page."),
  kind: z.enum(["update", "question"], "Choose an update or a question.").default("update"),
  body: z.string().trim().max(BUILD_MESSAGE_MAX_LENGTH, "Keep it under 4,000 characters.").default(""),
  status: z.union([z.enum(deliveryStatuses), z.literal("")], "Choose a stage from the list.").default(""),
  linkUrl: z.string().trim().max(BUILD_LINK_MAX_LENGTH, "That link is too long.").default(""),
  linkLabel: z.string().trim().max(BUILD_LINK_LABEL_MAX_LENGTH, "Keep the link name under 80 characters.").default(""),
  notifyClient: z.literal("on").optional(),
});

export type AjaniBuildPost = {
  body: string | null;
  buildId: string;
  kind: "update" | "question" | null;
  link: { label: string | null; url: string } | null;
  notifyClient: boolean;
  status: DeliveryStage | null;
};

/** The control desk's post form: an update or question, a new stage, or both. */
export function parseAjaniBuildPost(formData: FormData): { ok: true; value: AjaniBuildPost } | { ok: false; message: string } {
  const parsed = ajaniPostFields.safeParse(formFields(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message || "Check the post and try again." };
  const { body, buildId, kind, linkLabel, linkUrl, notifyClient, status } = parsed.data;
  if (!body && !status) return { ok: false, message: "Write an update or question, or pick a new stage." };
  if (!body && (linkUrl || linkLabel)) return { ok: false, message: "Add a short note to go with the link." };
  const url = linkUrl ? safeHttpsLink(linkUrl) : null;
  if (linkUrl && !url) return { ok: false, message: "Links must be full web addresses that start with https://" };
  if (linkLabel && !url) return { ok: false, message: "Add the link itself, or clear the link name." };
  return {
    ok: true,
    value: {
      buildId,
      body: body || null,
      kind: body ? kind : null,
      link: url ? { url, label: linkLabel || null } : null,
      status: status || null,
      notifyClient: Boolean(body) && notifyClient === "on",
    },
  };
}

const clientMessageFields = z.object({
  buildId: z.guid("This request could not be found. Refresh the page."),
  body: z.string().trim()
    .min(1, "Write your message first.")
    .max(BUILD_MESSAGE_MAX_LENGTH, "Keep your message under 4,000 characters."),
});

export function parseClientBuildMessage(formData: FormData): { ok: true; value: { body: string; buildId: string } } | { ok: false; message: string } {
  const parsed = clientMessageFields.safeParse(formFields(formData));
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message || "Check your message and try again." };
}

/**
 * A form upload sends each line break in a text box as "\r\n", while the box
 * counted it as one character, so a message at the box's limit would read as
 * too long. Line breaks are stored as "\n".
 */
function formFields(formData: FormData) {
  const fields: Record<string, unknown> = Object.fromEntries(formData);
  if (typeof fields.body === "string") fields.body = fields.body.replace(/\r\n?/g, "\n");
  return fields;
}

function lastIndex<T>(items: T[], matches: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) if (matches(items[index])) return index;
  return -1;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
