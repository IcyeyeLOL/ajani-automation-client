import "server-only";

import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/session";
import {
  BUILD_STATE_COLUMNS,
  buildStatusLabel,
  conversationState,
  conversationStateFromRow,
  flaggedAt,
  shapeBuildThread,
  type BuildMessageAuthor,
  type BuildThreadMessage,
  type ConversationState,
} from "@/lib/builds/conversation";
import { sampleBuildWorkspace, type SampleBuildWorkspace } from "@/lib/builds/sample";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

export type AdminBuildRow = {
  client: string;
  id: string;
  lastPost: { author: BuildMessageAuthor; body: string; timestamp: string } | null;
  openQuestions: number;
  requester: string;
  status: string;
  statusLabel: string;
  title: string;
  updatedIso: string;
  waitingOn: BuildMessageAuthor | null;
};

export type AdminBuildViewId = "all" | "you" | "client" | "active" | "live" | "closed";

type AdminBuildView = { id: AdminBuildViewId; label: string; statuses?: string[]; waitingOn?: BuildMessageAuthor };

/** The desk's list views. Each filters every build, not just one page of them. */
export const ADMIN_BUILD_VIEWS: AdminBuildView[] = [
  { id: "all", label: "All" },
  { id: "you", label: "Waiting on you", waitingOn: "ajani" },
  { id: "client", label: "Waiting on client", waitingOn: "client" },
  { id: "active", label: "In delivery", statuses: ["paid", "in_review", "in_progress", "needs_attention"] },
  { id: "live", label: "Live", statuses: ["live"] },
  { id: "closed", label: "Closed", statuses: ["cancelled"] },
];

export const ADMIN_BUILD_PAGE_SIZE = 50;

/** One page of one view, plus how many builds each view holds. */
export type AdminBuildList = {
  builds: AdminBuildRow[];
  counts: Record<AdminBuildViewId, number>;
  page: number;
  pageCount: number;
  status: "available" | "unavailable";
  view: AdminBuildViewId;
};

export type AdminBuildEvent = { id: string; label: string; timestamp: string };

export type AdminBuildDetail = {
  /** reachable: the requester is still an active member of a live workspace, so emailing them is allowed. */
  client: { business: string; email: string; name: string; phone: string; reachable: boolean };
  /** Over the whole thread, which can be longer than the posts loaded. */
  conversation: ConversationState;
  createdIso: string;
  events: AdminBuildEvent[];
  id: string;
  price: string | null;
  scope: string;
  status: string;
  statusLabel: string;
  summary: string;
  thread: BuildThreadMessage[];
  threadTotal: number;
  title: string;
  transcript: string;
};

export type AdminBuildDetailResult = { status: "available" | "unavailable"; detail: AdminBuildDetail | null };

const BUILD_COLUMNS = "id,organization_id,created_by,title,status,quoted_amount_cents,created_at,updated_at,transcript,extracted_context,plain_language_scope";
const MESSAGE_COLUMNS = "id,seq,build_request_id,author_role,kind,body,link_url,link_label,created_at";
const LIST_COLUMNS = `organization_id,created_by,title,status,updated_at,${BUILD_STATE_COLUMNS}`;
const THREAD_LIMIT = 300;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export function adminBuildView(id: unknown): AdminBuildView {
  return ADMIN_BUILD_VIEWS.find((view) => view.id === id) ?? ADMIN_BUILD_VIEWS[0];
}

export async function loadAdminBuildList(viewId: unknown = "all", requestedPage: unknown = 1): Promise<AdminBuildList> {
  // The DAL authorizes independently of the layout, which can render in parallel.
  await requireAdminSession();
  const view = adminBuildView(viewId);
  try {
    const admin = createSupabaseAdminClient();
    // The conversation view has one row per build, so filters and counts cover every build.
    // Stage-only counts read the builds table; only "who is waiting" needs the view's work.
    const countResults = await Promise.all(ADMIN_BUILD_VIEWS.map((item) => viewQuery(admin, item, item.waitingOn ? "build_request_id" : "id", { count: "exact", head: true }, item.waitingOn ? "build_conversation_state" : "build_requests")));
    const countError = countResults.find((result) => result.error)?.error;
    if (countError) throw countError;
    const counts = Object.fromEntries(ADMIN_BUILD_VIEWS.map((item, index) => [item.id, countResults[index].count ?? 0])) as Record<AdminBuildViewId, number>;
    const { page, pageCount } = pageFor(requestedPage, counts[view.id]);
    const from = (page - 1) * ADMIN_BUILD_PAGE_SIZE;
    const pageResult = await viewQuery(admin, view, LIST_COLUMNS)
      .order("waiting_rank", { ascending: true })
      .order("updated_at", { ascending: false })
      .order("build_request_id", { ascending: true })
      .range(from, from + ADMIN_BUILD_PAGE_SIZE - 1);
    if (pageResult.error) throw pageResult.error;
    // The column list is built at runtime, so the client cannot type the rows.
    const rows = (pageResult.data ?? []) as unknown as Row[];
    const organizationIds = unique(rows.map((row) => String(row.organization_id)));
    const profileIds = unique(rows.map((row) => String(row.created_by)));
    const [organizationsResult, profilesResult] = rows.length ? await Promise.all([
      admin.from("organizations").select("id,business_name").in("id", organizationIds),
      admin.from("profiles").select("id,full_name,email").in("id", profileIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    const error = organizationsResult.error ?? profilesResult.error;
    if (error) throw error;
    return {
      status: "available",
      view: view.id,
      counts,
      page,
      pageCount,
      builds: shapeAdminBuildList({
        builds: rows.map((row) => ({ ...row, id: row.build_request_id })),
        conversationStates: rows,
        organizations: organizationsResult.data ?? [],
        profiles: profilesResult.data ?? [],
      }),
    };
  } catch (error) {
    console.error("Admin build list unavailable", { message: error instanceof Error ? error.message : "unknown" });
    return { status: "unavailable", view: view.id, counts: emptyCounts(), page: 1, pageCount: 1, builds: [] };
  }
}

export async function loadAdminBuildDetail(buildId: string): Promise<AdminBuildDetailResult> {
  await requireAdminSession();
  if (!z.guid().safeParse(buildId).success) return { status: "available", detail: null };
  try {
    const admin = createSupabaseAdminClient();
    const buildResult = await admin.from("build_requests").select(BUILD_COLUMNS).eq("id", buildId).maybeSingle();
    if (buildResult.error) throw buildResult.error;
    const build = buildResult.data;
    if (!build) return { status: "available", detail: null };
    const [organizationResult, profileResult, membershipResult, messagesResult, stateResult, eventsResult, quoteResult] = await Promise.all([
      admin.from("organizations").select("id,business_name,archived_at").eq("id", String(build.organization_id)).maybeSingle(),
      admin.from("profiles").select("id,full_name,email,phone,deleted_at").eq("id", String(build.created_by)).maybeSingle(),
      admin.from("organization_members").select("user_id").eq("organization_id", String(build.organization_id)).eq("user_id", String(build.created_by)).is("deleted_at", null).maybeSingle(),
      admin.from("build_messages").select(MESSAGE_COLUMNS).eq("build_request_id", buildId).order("seq", { ascending: false }).limit(THREAD_LIMIT),
      admin.from("build_conversation_state").select(BUILD_STATE_COLUMNS).eq("build_request_id", buildId).maybeSingle(),
      admin.from("build_events").select("id,event_type,payload,created_at").eq("build_request_id", buildId).order("created_at", { ascending: false }).limit(50),
      admin.from("build_request_quotes").select("amount_cents").eq("build_request_id", buildId).eq("review_status", "approved").order("created_at", { ascending: false }).limit(1),
    ]);
    const error = organizationResult.error ?? profileResult.error ?? membershipResult.error ?? messagesResult.error ?? stateResult.error ?? eventsResult.error ?? quoteResult.error;
    if (error) throw error;
    return {
      status: "available",
      detail: shapeAdminBuildDetail({
        build,
        organization: organizationResult.data,
        profile: profileResult.data,
        activeMember: Boolean(membershipResult.data),
        messages: messagesResult.data ?? [],
        conversationState: stateResult.data,
        events: eventsResult.data ?? [],
        quotes: quoteResult.data ?? [],
      }),
    };
  } catch (error) {
    console.error("Admin build detail unavailable", { buildId, message: error instanceof Error ? error.message : "unknown" });
    return { status: "unavailable", detail: null };
  }
}

/**
 * Waiting on Ajani first, then waiting on the client, then everything else by latest activity.
 * Live data passes the conversation view's rows; sample data derives them from its messages and events.
 */
export function shapeAdminBuildList(input: { builds: Row[]; conversationStates?: Row[]; events?: Row[]; messages?: Row[]; organizations: Row[]; profiles: Row[] }): AdminBuildRow[] {
  const businesses = new Map(input.organizations.map((organization) => [String(organization.id), text(organization.business_name)]));
  const people = new Map(input.profiles.map((profile) => [String(profile.id), text(profile.full_name) || text(profile.email)]));
  const states = new Map<string, ConversationState>();
  if (input.conversationStates) {
    for (const row of input.conversationStates) states.set(String(row.build_request_id), conversationStateFromRow(row));
  } else {
    const threads = new Map<string, Row[]>();
    for (const message of input.messages ?? []) {
      const buildId = String(message.build_request_id);
      threads.set(buildId, [...(threads.get(buildId) ?? []), message]);
    }
    for (const build of input.builds) {
      const id = String(build.id);
      states.set(id, conversationState(shapeBuildThread(threads.get(id) ?? []), { status: text(build.status), flaggedAt: flaggedAt(input.events ?? [], id) }));
    }
  }
  const rank = (row: AdminBuildRow) => row.waitingOn === "ajani" ? 0 : row.waitingOn === "client" ? 1 : 2;
  return input.builds.map((build) => {
    const id = String(build.id);
    const state = states.get(id);
    const status = text(build.status) || "draft";
    return {
      id,
      title: text(build.title) || "Automation request",
      client: businesses.get(String(build.organization_id)) || "Client workspace",
      requester: people.get(String(build.created_by)) || "",
      status,
      statusLabel: buildStatusLabel(status),
      updatedIso: text(build.updated_at),
      waitingOn: state?.waitingOn ?? null,
      openQuestions: state?.openQuestions ?? 0,
      lastPost: state?.lastPost ?? null,
    };
  }).sort((first, second) => rank(first) - rank(second) || second.updatedIso.localeCompare(first.updatedIso));
}

/** conversationState: the view's row (null when the build is gone from it), or left out to derive it from a complete thread. */
export function shapeAdminBuildDetail(input: { activeMember?: boolean; build: Row; conversationState?: Row | null; events: Row[]; messages: Row[]; organization: Row | null; profile: Row | null; quotes: Row[] }): AdminBuildDetail {
  const context = record(input.build.extracted_context);
  const status = text(input.build.status) || "draft";
  const thread = shapeBuildThread(input.messages);
  const conversation = input.conversationState === undefined
    ? conversationState(thread, { status, flaggedAt: flaggedAt(input.events.map((event) => ({ ...event, build_request_id: input.build.id })), String(input.build.id)) })
    : input.conversationState ? conversationStateFromRow(input.conversationState) : conversationState([]);
  const cents = number(input.quotes[0]?.amount_cents) || number(input.build.quoted_amount_cents);
  return {
    id: String(input.build.id),
    title: text(input.build.title) || "Automation request",
    status,
    statusLabel: buildStatusLabel(status),
    createdIso: text(input.build.created_at),
    summary: text(record(context.emailBrief).overview) || text(record(context.developmentBrief).desiredOutcome) || text(record(context.demand).summary),
    scope: text(input.build.plain_language_scope),
    transcript: text(input.build.transcript),
    price: cents > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100) : null,
    client: {
      business: text(input.organization?.business_name) || "Client workspace",
      name: text(input.profile?.full_name),
      email: text(input.profile?.email),
      phone: text(input.profile?.phone),
      reachable: Boolean(input.activeMember ?? true) && !input.organization?.archived_at && !input.profile?.deleted_at,
    },
    thread,
    threadTotal: Math.max(conversation.postCount, thread.length),
    conversation,
    events: input.events.map((event) => ({ id: String(event.id), label: eventLabel(text(event.event_type), record(event.payload)), timestamp: text(event.created_at) })),
  };
}

export function sampleAdminBuildList(viewId: unknown = "all", requestedPage: unknown = 1, sample: SampleBuildWorkspace = sampleBuildWorkspace()): AdminBuildList {
  const view = adminBuildView(viewId);
  const rows = shapeAdminBuildList(sample);
  const counts = Object.fromEntries(ADMIN_BUILD_VIEWS.map((item) => [item.id, rows.filter((row) => viewMatches(item, row)).length])) as Record<AdminBuildViewId, number>;
  const { page, pageCount } = pageFor(requestedPage, counts[view.id]);
  const from = (page - 1) * ADMIN_BUILD_PAGE_SIZE;
  return { status: "available", view: view.id, counts, page, pageCount, builds: rows.filter((row) => viewMatches(view, row)).slice(from, from + ADMIN_BUILD_PAGE_SIZE) };
}

export function sampleAdminBuildDetail(buildId: string, sample: SampleBuildWorkspace = sampleBuildWorkspace()): AdminBuildDetailResult {
  const build = sample.builds.find((item) => item.id === buildId);
  if (!build) return { status: "available", detail: null };
  return {
    status: "available",
    detail: shapeAdminBuildDetail({
      build,
      organization: sample.organizations.find((organization) => organization.id === build.organization_id) ?? null,
      profile: sample.profiles.find((profile) => profile.id === build.created_by) ?? null,
      messages: sample.messages.filter((message) => message.build_request_id === buildId),
      events: sample.events.filter((event) => event.build_request_id === buildId).reverse(),
      quotes: [],
    }),
  };
}

function viewQuery(admin: AdminClient, view: AdminBuildView, columns: string, options?: { count: "exact"; head: boolean }, table: "build_conversation_state" | "build_requests" = "build_conversation_state") {
  let query = admin.from(table).select(columns, options);
  if (view.waitingOn) query = query.eq("waiting_on", view.waitingOn);
  if (view.statuses) query = query.in("status", view.statuses);
  return query;
}

function viewMatches(view: AdminBuildView, row: AdminBuildRow) {
  if (view.waitingOn && row.waitingOn !== view.waitingOn) return false;
  return !view.statuses || view.statuses.includes(row.status);
}

function pageFor(requested: unknown, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_BUILD_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(requested)) || 1));
  return { page, pageCount };
}

function emptyCounts(): Record<AdminBuildViewId, number> {
  return { all: 0, you: 0, client: 0, active: 0, live: 0, closed: 0 };
}

function eventLabel(eventType: string, payload: Row) {
  if (eventType === "status_changed") return `Moved to ${buildStatusLabel(text(payload.to))}`;
  const labels: Record<string, string> = {
    request_submitted: "Request submitted",
    quote_created: "Proposal prepared",
    payment_received: "Payment received",
    build_started: "Build started",
    build_live: "Moved live",
    needs_attention: "Flagged for input",
  };
  return labels[eventType] ?? buildStatusLabel(eventType);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
