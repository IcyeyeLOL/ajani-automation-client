import { describe, expect, it, vi } from "vitest";
import { loadPortalBuildDetail, shapePortalBuildDetail, shapePortalDashboard } from "@/lib/portal/dashboard";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, clerkClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));

describe("portal build detail lookup", () => {
  it("treats an id that is not a UUID as not found, without asking the database", async () => {
    for (const buildId of ["not-a-uuid", "123", "bfa16669-b62c-49e5-a356-9ac634a969b", "bfa16669-b62c-49e5-a356-9ac634a969bb'--"]) {
      await expect(loadPortalBuildDetail(buildId)).resolves.toEqual({ available: true, detail: null });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("still looks up a real UUID", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null, orgId: null });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await expect(loadPortalBuildDetail("bfa16669-b62c-49e5-a356-9ac634a969bb")).resolves.toEqual({ available: false, detail: null });
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });
});

describe("portal dashboard shaping", () => {
  it("uses reviewed quote data and tenant rows for the portal", () => {
    const data = shapePortalDashboard({
      organization: { business_name: "Northline Studio" },
      builds: [{
        id: "build-1",
        title: "After-hours lead handoff",
        status: "in_review",
        quoted_amount_cents: 100,
        updated_at: "2026-08-23T12:00:00.000Z",
      }],
      quotes: [{ build_request_id: "build-1", amount_cents: 380000 }],
      systems: [{
        name: "Lead handoff",
        status: "live",
        health: "healthy",
        last_success_at: "2026-08-23T12:00:00.000Z",
      }],
      subscriptions: [
        { amount_cents: 35000, status: "active", interval: "month" },
        { amount_cents: 10000, status: "active", interval: "year" },
      ],
    });

    expect(data.businessName).toBe("Northline Studio");
    expect(data.builds[0]).toMatchObject({ price: "$3,800", status: "in_review" });
    expect(data.systems[0]).toMatchObject({ health: "healthy", metric: "Running normally" });
    expect(data.monthlyRetainer).toBe("$350");
  });

  it("returns honest empty values instead of demo account data", () => {
    const data = shapePortalDashboard({ organization: null, builds: [], quotes: [], systems: [], subscriptions: [] });
    expect(data).toMatchObject({ businessName: "Your workspace", builds: [], systems: [], monthlyRetainer: "—" });
  });

  it("preserves five captured clarification decisions in a build receipt", () => {
    const detail = shapePortalBuildDetail({
      build: {
        id: "build-5",
        title: "Affiliate contract handoff",
        status: "in_review",
        transcript: "Generate the affiliate agreement without retyping the same fields.",
        extracted_context: {
          clarificationAnswers: Array.from({ length: 5 }, (_, index) => ({
            question: `Decision ${index + 1}?`,
            answer: `Confirmed answer ${index + 1}`,
          })),
          emailBrief: { overview: "Prepare a signature-ready contract." },
        },
        system_definition: [{ id: "step-1", kind: "trigger", title: "Affiliate added", detail: "Start the route." }],
        plain_language_scope: "Affiliate added: Start the route.",
        created_at: "2026-08-27T12:00:00.000Z",
        updated_at: "2026-08-27T12:00:00.000Z",
      },
      events: [{ id: "event-1", build_request_id: "build-5", event_type: "request_submitted", payload: { internal: "never render" }, created_at: "2026-08-27T12:00:00.000Z" }],
      questions: [],
      quotes: [],
      system: null,
      voiceMemos: [{ status: "ready", duration_seconds: 56 }],
    });

    expect(detail.questions).toHaveLength(5);
    expect(detail.questions[4]).toMatchObject({ question: "Decision 5?", answer: "Confirmed answer 5" });
    expect(detail.steps).toHaveLength(1);
    expect(detail.voiceMemo).toMatchObject({ status: "ready", duration: "56s" });
    expect(JSON.stringify(detail.events)).not.toContain("never render");
  });
});

describe("portal build conversations", () => {
  const build = { id: "build-7", title: "Missed-call text back", status: "in_progress", updated_at: "2026-10-20T12:00:00.000Z" };
  const message = (id: string, author: string, kind: string, minute: number) => ({
    id, build_request_id: "build-7", author_role: author, kind, body: `${kind} body`, link_url: null, link_label: null,
    created_at: `2026-10-20T12:${String(minute).padStart(2, "0")}:00.000Z`,
  });

  it("flags an unanswered question and lists Ajani's posts as activity, newest first", () => {
    const data = shapePortalDashboard({
      organization: null,
      builds: [build],
      quotes: [],
      systems: [],
      subscriptions: [],
      events: [{ id: "event-1", build_request_id: "build-7", event_type: "status_changed", payload: { from: "in_review", to: "in_progress" }, created_at: "2026-10-20T11:00:00.000Z" }],
      // Newest first, as the query returns them.
      messages: [message("q", "ajani", "question", 5), message("c", "client", "message", 3), message("u", "ajani", "update", 1)],
    });

    expect(data.builds[0]).toMatchObject({ openQuestions: 1, waitingOn: "client" });
    expect(data.activity.map((item) => item.title)).toEqual(["Ajani asked you a question", "Ajani posted an update", "Build work started"]);
    expect(data.activity[0].href).toBe("/portal/builds/build-7#conversation");
  });

  it("gives the build page its thread in order and clears the question once answered", () => {
    const detail = shapePortalBuildDetail({
      build,
      events: [],
      questions: [],
      quotes: [],
      system: null,
      voiceMemos: [],
      messages: [message("r", "client", "message", 6), message("q", "ajani", "question", 5)],
    });
    expect(detail.thread.map((item) => item.id)).toEqual(["q", "r"]);
    expect(detail.build).toMatchObject({ openQuestions: 0, waitingOn: "ajani" });
  });

  it("asks the client after a stage-only move to Needs input, and hands back once they reply", () => {
    const flagged = { ...build, status: "needs_attention" };
    const flag = { id: "event-2", build_request_id: "build-7", event_type: "status_changed", payload: { from: "in_progress", to: "needs_attention" }, created_at: "2026-10-20T12:04:00.000Z" };
    const detail = (messages: ReturnType<typeof message>[]) => shapePortalBuildDetail({ build: flagged, events: [flag], questions: [], quotes: [], system: null, voiceMemos: [], messages });

    // The client wrote before Ajani moved the build: it is their turn now.
    expect(detail([message("c", "client", "message", 2)]).build).toMatchObject({ needsClient: true, waitingOn: "client", openQuestions: 0 });
    // They reply after the move: Ajani's turn, and a later update does not ask again.
    const replied = detail([message("r", "client", "message", 6), message("c", "client", "message", 2)]).build;
    expect(replied).toMatchObject({ needsClient: false, waitingOn: "ajani", nextStep: "You replied. Ajani is reviewing your answer." });
    expect(detail([message("u", "ajani", "update", 8), message("r", "client", "message", 6)]).build).toMatchObject({ needsClient: false, waitingOn: null });
  });

  it("takes the open question's text from the whole-thread view when the page loads fewer posts", () => {
    const detail = shapePortalBuildDetail({
      build,
      events: [],
      questions: [],
      quotes: [],
      system: null,
      voiceMemos: [],
      messages: [message("u", "ajani", "update", 9)],
      conversationState: { build_request_id: "build-7", post_count: 301, open_questions: 1, open_question_body: "Which calendar?", waiting_on: "client", last_author: "ajani", last_body: "update body" },
    });
    expect(detail.build).toMatchObject({ needsClient: true, openQuestions: 1, openQuestion: "Which calendar?" });
    expect(detail.threadTotal).toBe(301);
  });
});
