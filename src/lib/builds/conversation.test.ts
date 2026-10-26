import { describe, expect, it } from "vitest";
import {
  conversationState,
  conversationStateFromRow,
  flaggedAt,
  openQuestions,
  parseAjaniBuildPost,
  parseClientBuildMessage,
  safeHttpsLink,
  shapeBuildThread,
} from "@/lib/builds/conversation";

const buildId = "21000000-0000-4000-8000-000000000001";
const row = (id: string, author: string, kind: string, minute: number, extra: Record<string, unknown> = {}) => ({
  id, author_role: author, kind, body: `${kind} ${id}`, created_at: `2026-10-20T12:${String(minute).padStart(2, "0")}:00.000Z`, ...extra,
});
const at = (minute: number) => `2026-10-20T12:${String(minute).padStart(2, "0")}:00.000Z`;
const waitingOn = (thread: ReturnType<typeof shapeBuildThread>, build?: { flaggedAt: string | null; status: string }) => conversationState(thread, build).waitingOn;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("build threads", () => {
  it("orders posts oldest first and drops rows that could not have been written", () => {
    const thread = shapeBuildThread([
      row("b", "client", "message", 5),
      row("a", "ajani", "update", 1),
      row("bad-author", "robot", "message", 2),
      row("bad-kind", "ajani", "note", 3),
      { ...row("empty", "ajani", "update", 4), body: "" },
    ]);
    expect(thread.map((message) => message.id)).toEqual(["a", "b"]);
  });

  it("only links to safe https addresses", () => {
    const [safe, unsafe, unlabeled] = shapeBuildThread([
      row("a", "ajani", "update", 1, { link_url: "https://www.loom.com/share/abc", link_label: "Watch it" }),
      row("b", "ajani", "update", 2, { link_url: "javascript:alert(1)", link_label: "Click" }),
      row("c", "ajani", "update", 3, { link_url: "https://docs.example.com/x" }),
    ]);
    expect(safe.link).toEqual({ url: "https://www.loom.com/share/abc", label: "Watch it" });
    expect(unsafe.link).toBeNull();
    expect(unlabeled.link).toEqual({ url: "https://docs.example.com/x", label: "Open link" });
  });

  it("waits on the client while a question is unanswered, even after a later update", () => {
    const thread = shapeBuildThread([row("q", "ajani", "question", 1), row("u", "ajani", "update", 2)]);
    expect(openQuestions(thread).map((message) => message.id)).toEqual(["q"]);
    expect(conversationState(thread)).toMatchObject({ waitingOn: "client", openQuestions: 1, openQuestion: "question q" });
  });

  it("treats any client reply after a question as the answer", () => {
    const thread = shapeBuildThread([row("q1", "ajani", "question", 1), row("q2", "ajani", "question", 2), row("r", "client", "message", 3)]);
    expect(openQuestions(thread)).toEqual([]);
    expect(waitingOn(thread)).toBe("ajani");
  });

  it("waits on nobody once Ajani replies after the client", () => {
    expect(waitingOn(shapeBuildThread([row("m", "client", "message", 1), row("u", "ajani", "update", 2)]))).toBeNull();
    expect(waitingOn([])).toBeNull();
  });

  it("orders by write order when two posts share a timestamp", () => {
    const thread = shapeBuildThread([row("r", "client", "message", 1, { seq: 8 }), row("q", "ajani", "question", 1, { seq: 7 })]);
    expect(thread.map((message) => message.id)).toEqual(["q", "r"]);
    expect(waitingOn(thread)).toBe("ajani");
  });

  it("waits on the client after a move to Needs input until they write again", () => {
    const thread = shapeBuildThread([row("m", "client", "message", 1)]);
    // A client message, then a stage-only move to Needs input: the client's turn.
    expect(waitingOn(thread, { status: "needs_attention", flaggedAt: at(2) })).toBe("client");
    // They reply after the move: Ajani's turn, and a later update does not ask again.
    const replied = shapeBuildThread([row("m", "client", "message", 1), row("r", "client", "message", 3)]);
    expect(waitingOn(replied, { status: "needs_attention", flaggedAt: at(2) })).toBe("ajani");
    const updated = shapeBuildThread([row("m", "client", "message", 1), row("r", "client", "message", 3), row("u", "ajani", "update", 4)]);
    expect(waitingOn(updated, { status: "needs_attention", flaggedAt: at(2) })).toBeNull();
    // Moved on from Needs input, the flag no longer counts.
    expect(waitingOn(thread, { status: "in_progress", flaggedAt: at(2) })).toBe("ajani");
    // An older Needs input build with no logged move waits on the client until they first write, and a later Ajani post does not ask again.
    expect(waitingOn([], { status: "needs_attention", flaggedAt: null })).toBe("client");
    expect(waitingOn(shapeBuildThread([row("u", "ajani", "update", 1), row("m", "client", "message", 2)]), { status: "needs_attention", flaggedAt: null })).toBe("ajani");
    expect(waitingOn(shapeBuildThread([row("m", "client", "message", 1), row("u", "ajani", "update", 2)]), { status: "needs_attention", flaggedAt: null })).toBeNull();
  });

  it("waits on nobody and asks nothing once a build is closed", () => {
    const thread = shapeBuildThread([row("q", "ajani", "question", 1), row("m", "client", "message", 2), row("q2", "ajani", "question", 3)]);
    expect(conversationState(thread, { status: "cancelled", flaggedAt: null })).toMatchObject({ waitingOn: null, openQuestions: 0, openQuestion: null });
    expect(waitingOn(shapeBuildThread([row("m", "client", "message", 1)]), { status: "cancelled", flaggedAt: null })).toBeNull();
  });

  it("finds when a build was last put at Needs input", () => {
    const events = [
      { build_request_id: "b1", event_type: "status_changed", payload: { to: "needs_attention" }, created_at: at(1) },
      { build_request_id: "b1", event_type: "status_changed", payload: { to: "in_progress" }, created_at: at(3) },
      { build_request_id: "b1", event_type: "status_changed", payload: { to: "needs_attention" }, created_at: at(2) },
      { build_request_id: "b2", event_type: "status_changed", payload: { to: "needs_attention" }, created_at: at(9) },
    ];
    expect(flaggedAt(events, "b1")).toBe(at(2));
    expect(flaggedAt(events, "b3")).toBeNull();
  });

  it("reads the database view's row", () => {
    expect(conversationStateFromRow({ post_count: 412, open_questions: "1", open_question_body: "Which calendar?", waiting_on: "client", last_author: "ajani", last_body: "Still building", last_post_at: at(5) }))
      .toEqual({ postCount: 412, openQuestions: 1, openQuestion: "Which calendar?", waitingOn: "client", lastPost: { author: "ajani", body: "Still building", timestamp: at(5) } });
    expect(conversationStateFromRow({ post_count: 0, open_questions: 0, waiting_on: null })).toMatchObject({ postCount: 0, waitingOn: null, lastPost: null, openQuestion: null });
  });
});

describe("safe links", () => {
  it.each([
    ["https://www.loom.com/share/abc?t=10", "https://www.loom.com/share/abc?t=10"],
    ["  https://example.com/a b  ", "https://example.com/a%20b"],
  ])("accepts %s", (input, expected) => expect(safeHttpsLink(input)).toBe(expected));

  it.each(["http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "https://localhost/x", "loom.com/share/abc", "data:text/html,hi", `https://example.com/${"a".repeat(2_000)}`])(
    "refuses %s", (input) => expect(safeHttpsLink(input)).toBeNull(),
  );
});

describe("the control desk post form", () => {
  it("reads an update with a link, a stage move and an email", () => {
    const parsed = parseAjaniBuildPost(form({ buildId, kind: "update", body: "  Calendar connected.  ", linkUrl: "https://www.loom.com/share/abc", linkLabel: "Walkthrough", status: "in_progress", notifyClient: "on" }));
    expect(parsed).toEqual({ ok: true, value: { buildId, kind: "update", body: "Calendar connected.", link: { url: "https://www.loom.com/share/abc", label: "Walkthrough" }, status: "in_progress", notifyClient: true } });
  });

  it("allows a stage move with no message, and never emails for it", () => {
    const parsed = parseAjaniBuildPost(form({ buildId, kind: "question", body: " ", status: "live", notifyClient: "on" }));
    expect(parsed).toEqual({ ok: true, value: { buildId, kind: null, body: null, link: null, status: "live", notifyClient: false } });
  });

  it.each([
    [{ buildId, body: "", status: "" }, "Write an update or question, or pick a new stage."],
    [{ buildId, body: "", status: "live", linkUrl: "https://example.com" }, "Add a short note to go with the link."],
    [{ buildId, body: "See this", linkUrl: "http://example.com" }, "Links must be full web addresses that start with https://"],
    [{ buildId, body: "See this", linkLabel: "Orphan" }, "Add the link itself, or clear the link name."],
    [{ buildId, body: "Hi", status: "paid" }, "Choose a stage from the list."],
    [{ buildId, body: "Hi", kind: "message" }, "Choose an update or a question."],
    [{ buildId: "not-a-build", body: "Hi" }, "This build could not be found. Refresh the page."],
    [{ buildId, body: "x".repeat(4_001) }, "Keep it under 4,000 characters."],
  ])("refuses %o", (fields, message) => {
    expect(parseAjaniBuildPost(form(fields))).toEqual({ ok: false, message });
  });
});

describe("the client message form", () => {
  it("trims and accepts a message", () => {
    expect(parseClientBuildMessage(form({ buildId, body: "  Use the front desk calendar.  " }))).toEqual({ ok: true, value: { buildId, body: "Use the front desk calendar." } });
  });

  it("counts a line break once, as the text box does", () => {
    // The box allowed 4,000 characters; the upload sent each of the 99 breaks as two.
    const lines = Array.from({ length: 100 }, () => "x".repeat(39)).join("\r\n");
    const parsed = parseClientBuildMessage(form({ buildId, body: lines }));
    expect(parsed.ok && parsed.value.body.length).toBe(3_999);
    expect(parsed.ok && parsed.value.body.includes("\r")).toBe(false);
    const update = parseAjaniBuildPost(form({ buildId, body: lines }));
    expect(update.ok && update.value.body?.length).toBe(3_999);
  });

  it.each([
    [{ buildId, body: "   " }, "Write your message first."],
    [{ buildId, body: "x".repeat(4_001) }, "Keep your message under 4,000 characters."],
    [{ buildId: "123", body: "Hi" }, "This request could not be found. Refresh the page."],
  ])("refuses %o", (fields, message) => {
    expect(parseClientBuildMessage(form(fields))).toEqual({ ok: false, message });
  });
});
