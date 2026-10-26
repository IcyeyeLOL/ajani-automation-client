import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { ADMIN_BUILD_PAGE_SIZE, loadAdminBuildList, sampleAdminBuildDetail, sampleAdminBuildList, shapeAdminBuildDetail, shapeAdminBuildList } from "@/lib/admin/builds";
import { sampleBuildWorkspace } from "@/lib/builds/sample";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for the desk loaders, over in-memory tables. */
function fakeDatabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let counted = false;
      let head = false;
      const sorts: { column: string; ascending: boolean }[] = [];
      let window: [number, number] | null = null;
      const builder = {
        select: (_columns: string, options?: { count?: string; head?: boolean }) => { counted = Boolean(options?.count); head = Boolean(options?.head); return builder; },
        eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return builder; },
        in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[column])); return builder; },
        not: (column: string, _operator: "in", list: string) => { const values = list.slice(1, -1).split(","); rows = rows.filter((row) => !values.includes(String(row[column]))); return builder; },
        is: (column: string, value: null) => { rows = rows.filter((row) => (row[column] ?? null) === value); return builder; },
        order: (column: string, options?: { ascending?: boolean }) => { sorts.push({ column, ascending: options?.ascending ?? true }); return builder; },
        range: (from: number, to: number) => { window = [from, to]; return builder; },
        then: (resolve: (result: { count: number | null; data: Row[] | null; error: null }) => unknown) => {
          const sorted = [...rows].sort((first, second) => {
            for (const { column, ascending } of sorts) {
              const order = String(first[column] ?? "").localeCompare(String(second[column] ?? ""), undefined, { numeric: true });
              if (order) return ascending ? order : -order;
            }
            return 0;
          });
          const data = window ? sorted.slice(window[0], window[1] + 1) : sorted;
          return resolve({ count: counted ? rows.length : null, data: head ? null : data, error: null });
        },
      };
      return builder;
    },
  };
}

const message = (buildId: string, author: string, kind: string, minute: number) => ({
  id: `${buildId}-${minute}`, build_request_id: buildId, author_role: author, kind, body: `${author} ${kind}`,
  created_at: `2026-10-20T12:${String(minute).padStart(2, "0")}:00.000Z`,
});

describe("the client builds list", () => {
  it("puts clients waiting on Ajani first, then questions out, then the rest by latest activity", () => {
    const rows = shapeAdminBuildList({
      builds: [
        { id: "quiet", organization_id: "org-1", created_by: "dana", title: "Quiet", status: "live", updated_at: "2026-10-22T00:00:00.000Z" },
        { id: "asked", organization_id: "org-1", created_by: "dana", title: "Asked", status: "in_progress", updated_at: "2026-10-21T00:00:00.000Z" },
        { id: "waiting", organization_id: "org-2", created_by: "marcus", title: "Waiting", status: "in_review", updated_at: "2026-10-01T00:00:00.000Z" },
      ],
      organizations: [{ id: "org-1", business_name: "Northline Dental" }, { id: "org-2", business_name: "Harbor Street Realty" }],
      profiles: [{ id: "dana", full_name: "Dana Whitfield" }, { id: "marcus", email: "marcus@example.com" }],
      messages: [message("asked", "ajani", "question", 2), message("waiting", "ajani", "update", 1), message("waiting", "client", "message", 4)],
    });
    expect(rows.map((row) => [row.id, row.waitingOn])).toEqual([["waiting", "ajani"], ["asked", "client"], ["quiet", null]]);
    expect(rows[0]).toMatchObject({ client: "Harbor Street Realty", requester: "marcus@example.com", lastPost: { author: "client", body: "client message" } });
    expect(rows[1]).toMatchObject({ openQuestions: 1, statusLabel: "In build" });
  });

  it("counts a stage-only move to Needs input as the client's turn", () => {
    const rows = shapeAdminBuildList({
      builds: [{ id: "flagged", organization_id: "org-1", created_by: "dana", title: "Flagged", status: "needs_attention", updated_at: "2026-10-22T00:00:00.000Z" }],
      organizations: [],
      profiles: [],
      messages: [message("flagged", "client", "message", 1)],
      events: [{ build_request_id: "flagged", event_type: "status_changed", payload: { to: "needs_attention" }, created_at: "2026-10-20T12:05:00.000Z" }],
    });
    expect(rows[0]).toMatchObject({ waitingOn: "client", openQuestions: 0 });
  });

  it("reads waiting and question counts from the conversation view when it is given", () => {
    const rows = shapeAdminBuildList({
      builds: [{ id: "long", organization_id: "org-1", created_by: "dana", title: "Long thread", status: "in_progress", updated_at: "2026-10-22T00:00:00.000Z" }],
      organizations: [],
      profiles: [],
      conversationStates: [{ build_request_id: "long", post_count: 900, open_questions: 2, waiting_on: "client", last_author: "ajani", last_body: "Which calendar?", last_post_at: "2026-10-22T00:00:00.000Z" }],
    });
    expect(rows[0]).toMatchObject({ waitingOn: "client", openQuestions: 2, lastPost: { author: "ajani", body: "Which calendar?" } });
  });

  it("pages through every build, with waiting builds first however old", async () => {
    const state = (index: number, waiting: "ajani" | "client" | null, status = "in_progress") => ({
      build_request_id: `b-${String(index).padStart(3, "0")}`,
      organization_id: "org-1",
      created_by: "dana",
      title: `Build ${index}`,
      status,
      updated_at: new Date(Date.UTC(2026, 9, 22) - index * 60_000).toISOString(),
      post_count: waiting ? 2 : 0,
      open_questions: waiting === "client" ? 1 : 0,
      waiting_on: waiting,
      waiting_rank: waiting === "ajani" ? 0 : waiting === "client" ? 1 : 2,
      last_author: waiting ? "client" : null,
      last_body: waiting ? `Post on ${index}` : null,
    });
    // 120 builds: the oldest waits on Ajani, one waits on the client, a few are live or closed.
    const rows = Array.from({ length: 120 }, (_, index) => state(index, index === 119 ? "ajani" : index === 60 ? "client" : null, index % 40 === 5 ? "live" : index === 7 ? "cancelled" : "in_progress"));
    vi.mocked(createSupabaseAdminClient).mockReturnValue(fakeDatabase({
      build_conversation_state: rows,
      organizations: [{ id: "org-1", business_name: "Northline Dental" }],
      profiles: [{ id: "dana", full_name: "Dana Whitfield" }],
    }) as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const first = await loadAdminBuildList();
    expect(first).toMatchObject({ status: "available", view: "all", page: 1, pageCount: 3 });
    expect(first.counts).toEqual({ all: 120, you: 1, client: 1, active: 116, live: 3, closed: 1 });
    expect(first.builds).toHaveLength(ADMIN_BUILD_PAGE_SIZE);
    expect(first.builds.slice(0, 2).map((build) => [build.id, build.waitingOn])).toEqual([["b-119", "ajani"], ["b-060", "client"]]);
    expect(first.builds[0]).toMatchObject({ client: "Northline Dental", requester: "Dana Whitfield", lastPost: { body: "Post on 119" } });

    // The last page reaches the oldest quiet build, and a page past the end shows the last one.
    const last = await loadAdminBuildList("all", 9);
    expect(last.page).toBe(3);
    expect(last.builds).toHaveLength(20);
    expect(last.builds.at(-1)?.id).toBe("b-118");

    // A filter covers every build, not just the loaded page.
    const live = await loadAdminBuildList("live", "1");
    expect(live.builds.map((build) => build.id)).toEqual(["b-005", "b-045", "b-085"]);
    const active = await loadAdminBuildList("active");
    expect(active.builds.some((build) => ["live", "cancelled"].includes(build.status))).toBe(false);
  });

  it("takes the detail page's waiting state from the whole thread, not the posts loaded", () => {
    const detail = shapeAdminBuildDetail({
      build: { id: "long", title: "Long thread", status: "in_progress", created_at: "2026-10-01T00:00:00.000Z" },
      messages: [message("long", "client", "message", 5)],
      conversationState: { build_request_id: "long", post_count: 420, open_questions: 1, waiting_on: "client", last_author: "client", last_body: "client message", last_post_at: "2026-10-20T12:05:00.000Z" },
      events: [],
      organization: null,
      profile: null,
      quotes: [],
    });
    expect(detail.conversation).toMatchObject({ waitingOn: "client", openQuestions: 1, postCount: 420 });
    expect(detail.client.reachable).toBe(true);
    expect(detail.threadTotal).toBe(420);
    expect(detail.thread).toHaveLength(1);
  });

  it("shapes the made-up sample clients for sample mode", () => {
    const sample = sampleBuildWorkspace(new Date("2026-10-25T12:00:00.000Z"));
    const list = sampleAdminBuildList("all", 1, sample);
    expect(list).toMatchObject({ status: "available", page: 1, pageCount: 1 });
    expect(list.builds).toHaveLength(sample.builds.length);
    expect(sampleAdminBuildList("you", 1, sample).builds.every((build) => build.waitingOn === "ajani")).toBe(true);
    expect(list.builds[0].waitingOn).toBe("ajani");
    const detail = sampleAdminBuildDetail(String(sample.builds[0].id), sample).detail;
    expect(detail?.client.business).toBe("Northline Dental (sample)");
    expect(detail?.events.length).toBeGreaterThan(0);
    expect(detail?.threadTotal).toBe(detail?.thread.length);
    expect(sampleAdminBuildDetail("5a310000-0000-4000-8000-0000000000ff", sample)).toEqual({ status: "available", detail: null });
  });
});
