import "server-only";

import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import { provisionClerkWorkspace } from "@/lib/clerk/provisioning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

export type PortalBuild = {
  category: string;
  created: string;
  createdIso: string;
  id: string;
  nextStep: string;
  price: string;
  progress: number;
  status: string;
  statusLabel: string;
  stepCount: number;
  summary: string;
  title: string;
  updated: string;
  updatedIso: string;
};

export type PortalSystem = {
  buildRequestId: string | null;
  detail: string;
  health: string;
  healthLabel: string;
  id: string;
  lastRun: string;
  metric: string;
  name: string;
  status: string;
  statusLabel: string;
};

export type PortalActivity = {
  detail: string;
  href: string;
  id: string;
  timestamp: string;
  title: string;
  tone: "active" | "complete" | "neutral" | "warning";
  when: string;
};

export type PortalDashboardData = {
  activity: PortalActivity[];
  available: boolean;
  businessName: string;
  builds: PortalBuild[];
  monthlyRetainer: string;
  nextBillingDate: string | null;
  systems: PortalSystem[];
};

export type PortalBuildStep = {
  detail: string;
  id: string;
  kind: string;
  title: string;
};

export type PortalBuildQuestion = {
  answer: string | null;
  answered: boolean;
  id: string;
  question: string;
};

export type PortalVoiceMemo = {
  duration: string | null;
  status: string;
  statusLabel: string;
};

export type PortalBuildDetail = {
  build: PortalBuild;
  events: PortalActivity[];
  linkedSystem: PortalSystem | null;
  plainLanguageScope: string;
  questions: PortalBuildQuestion[];
  steps: PortalBuildStep[];
  transcript: string;
  voiceMemo: PortalVoiceMemo | null;
};

export type PortalBuildDetailResult = {
  available: boolean;
  detail: PortalBuildDetail | null;
};

export type PortalInvoice = {
  amount: string;
  href: string | null;
  id: string;
  issued: string;
  status: string;
  statusLabel: string;
};

export type PortalSubscription = {
  amount: string;
  interval: string;
  renews: string | null;
  status: string;
  statusLabel: string;
};

export type PortalBillingData = {
  available: boolean;
  invoices: PortalInvoice[];
  subscriptions: PortalSubscription[];
};

export const loadPortalDashboard = cache(async (): Promise<PortalDashboardData> => {
  try {
    const organizationId = await portalOrganizationId();
    const admin = createSupabaseAdminClient();
    const [organizationResult, buildsResult, systemsResult, subscriptionsResult] = await Promise.all([
      admin.from("organizations").select("id,business_name").eq("id", organizationId).maybeSingle(),
      admin.from("build_requests")
        .select("id,title,status,quoted_amount_cents,created_at,updated_at,extracted_context,system_definition,plain_language_scope")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100),
      admin.from("automation_systems")
        .select("id,build_request_id,name,status,health,last_success_at,last_error_at,updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100),
      admin.from("billing_subscriptions")
        .select("amount_cents,status,interval,current_period_end")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .limit(100),
    ]);

    const baseError = organizationResult.error ?? buildsResult.error ?? systemsResult.error ?? subscriptionsResult.error;
    if (baseError) throw baseError;

    const buildIds = (buildsResult.data ?? []).map((build) => String(build.id));
    const [quotesResult, eventsResult] = buildIds.length > 0
      ? await Promise.all([
        admin.from("build_request_quotes")
          .select("build_request_id,amount_cents,review_status")
          .in("build_request_id", buildIds)
          .eq("review_status", "approved")
          .limit(200),
        admin.from("build_events")
          .select("id,build_request_id,event_type,payload,created_at")
          .in("build_request_id", buildIds)
          .order("created_at", { ascending: false })
          .limit(40),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];

    const relatedError = quotesResult.error ?? eventsResult.error;
    if (relatedError) throw relatedError;

    return shapePortalDashboard({
      organization: organizationResult.data,
      builds: buildsResult.data ?? [],
      quotes: quotesResult.data ?? [],
      systems: systemsResult.data ?? [],
      subscriptions: subscriptionsResult.data ?? [],
      events: eventsResult.data ?? [],
    });
  } catch (error) {
    console.error("Portal dashboard unavailable", portalError(error));
    return emptyPortal(false);
  }
});

export const loadPortalBuildDetail = cache(async (buildId: string): Promise<PortalBuildDetailResult> => {
  try {
    const organizationId = await portalOrganizationId();
    const admin = createSupabaseAdminClient();
    const buildResult = await admin.from("build_requests")
      .select("id,title,status,quoted_amount_cents,created_at,updated_at,transcript,extracted_context,system_definition,plain_language_scope")
      .eq("organization_id", organizationId)
      .eq("id", buildId)
      .maybeSingle();
    if (buildResult.error) throw buildResult.error;
    if (!buildResult.data) return { available: true, detail: null };

    const [quoteResult, eventsResult, questionsResult, voiceResult, systemResult] = await Promise.all([
      admin.from("build_request_quotes")
        .select("build_request_id,amount_cents,review_status")
        .eq("build_request_id", buildId)
        .eq("review_status", "approved")
        .order("created_at", { ascending: false })
        .limit(1),
      admin.from("build_events")
        .select("id,build_request_id,event_type,payload,created_at")
        .eq("build_request_id", buildId)
        .order("created_at", { ascending: false })
        .limit(50),
      admin.from("gap_questions")
        .select("id,question,answer,answered_at,created_at")
        .eq("build_request_id", buildId)
        .order("created_at", { ascending: true })
        .limit(25),
      admin.from("voice_memos")
        .select("status,duration_seconds")
        .eq("build_request_id", buildId)
        .order("created_at", { ascending: false })
        .limit(1),
      admin.from("automation_systems")
        .select("id,build_request_id,name,status,health,last_success_at,last_error_at,updated_at")
        .eq("organization_id", organizationId)
        .eq("build_request_id", buildId)
        .maybeSingle(),
    ]);
    const relatedError = quoteResult.error
      ?? eventsResult.error
      ?? questionsResult.error
      ?? voiceResult.error
      ?? systemResult.error;
    if (relatedError) throw relatedError;

    return {
      available: true,
      detail: shapePortalBuildDetail({
        build: buildResult.data,
        quotes: quoteResult.data ?? [],
        events: eventsResult.data ?? [],
        questions: questionsResult.data ?? [],
        voiceMemos: voiceResult.data ?? [],
        system: systemResult.data,
      }),
    };
  } catch (error) {
    console.error("Portal build detail unavailable", { buildId, ...portalError(error) });
    return { available: false, detail: null };
  }
});

export const loadPortalBilling = cache(async (): Promise<PortalBillingData> => {
  try {
    const organizationId = await portalOrganizationId();
    const admin = createSupabaseAdminClient();
    const [subscriptionsResult, invoicesResult] = await Promise.all([
      admin.from("billing_subscriptions")
        .select("status,amount_cents,interval,current_period_end")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(20),
      admin.from("invoices")
        .select("id,amount_cents,status,hosted_invoice_url,issued_at")
        .eq("organization_id", organizationId)
        .order("issued_at", { ascending: false })
        .limit(100),
    ]);
    const error = subscriptionsResult.error ?? invoicesResult.error;
    if (error) throw error;
    return {
      available: true,
      subscriptions: (subscriptionsResult.data ?? []).map((subscription) => ({
        amount: formatMoney(numberValue(subscription.amount_cents)),
        interval: stringValue(subscription.interval) || "month",
        renews: stringValue(subscription.current_period_end) ? formatDate(String(subscription.current_period_end)) : null,
        status: stringValue(subscription.status),
        statusLabel: titleCase(stringValue(subscription.status)),
      })),
      invoices: (invoicesResult.data ?? []).map((invoice) => ({
        amount: formatMoney(numberValue(invoice.amount_cents)),
        href: stringValue(invoice.hosted_invoice_url) || null,
        id: stringValue(invoice.id),
        issued: formatDate(stringValue(invoice.issued_at)),
        status: stringValue(invoice.status),
        statusLabel: titleCase(stringValue(invoice.status)),
      })),
    };
  } catch (error) {
    console.error("Portal billing unavailable", portalError(error));
    return { available: false, invoices: [], subscriptions: [] };
  }
});

export function shapePortalDashboard(input: {
  builds: Row[];
  events?: Row[];
  organization: Row | null;
  quotes: Row[];
  subscriptions: Row[];
  systems: Row[];
}): PortalDashboardData {
  const quoteAmounts = new Map(input.quotes.map((quote) => [String(quote.build_request_id), numberValue(quote.amount_cents)]));
  const builds = input.builds.map((build) => shapeBuild(build, quoteAmounts));
  const buildLookup = new Map(builds.map((build) => [build.id, build]));
  const systems = input.systems.map(shapeSystem);
  const monthlyCents = input.subscriptions.reduce((sum, subscription) => (
    subscription.interval === "month" ? sum + numberValue(subscription.amount_cents) : sum
  ), 0);
  const nextPeriod = input.subscriptions
    .map((subscription) => stringValue(subscription.current_period_end))
    .filter(Boolean)
    .sort()[0] ?? null;

  return {
    available: true,
    businessName: stringValue(input.organization?.business_name) || "Your workspace",
    builds,
    monthlyRetainer: monthlyCents ? formatMoney(monthlyCents) : "—",
    nextBillingDate: nextPeriod ? formatDate(nextPeriod) : null,
    systems,
    activity: shapeActivity(input.events ?? [], buildLookup, builds, systems),
  };
}

export function shapePortalBuildDetail(input: {
  build: Row;
  events: Row[];
  questions: Row[];
  quotes: Row[];
  system: Row | null;
  voiceMemos: Row[];
}): PortalBuildDetail {
  const quoteAmounts = new Map(input.quotes.map((quote) => [String(quote.build_request_id), numberValue(quote.amount_cents)]));
  const build = shapeBuild(input.build, quoteAmounts);
  const rawSteps = arrayValue(input.build.system_definition);
  const extractedContext = recordValue(input.build.extracted_context);
  const capturedAnswers = arrayValue(extractedContext.clarificationAnswers);
  const voice = input.voiceMemos[0];
  return {
    build,
    transcript: stringValue(input.build.transcript),
    plainLanguageScope: stringValue(input.build.plain_language_scope),
    steps: rawSteps.map((value, index) => {
      const step = recordValue(value);
      return {
        id: stringValue(step.id) || `${build.id}-step-${index + 1}`,
        kind: stringValue(step.kind) || "step",
        title: stringValue(step.title) || `Workflow step ${index + 1}`,
        detail: stringValue(step.detail),
      };
    }),
    questions: input.questions.length > 0
      ? input.questions.map((question) => ({
        id: stringValue(question.id),
        question: stringValue(question.question),
        answer: stringValue(question.answer) || null,
        answered: Boolean(stringValue(question.answered_at) || stringValue(question.answer)),
      }))
      : capturedAnswers.map((value, index) => {
        const answer = recordValue(value);
        return {
          id: `${build.id}-decision-${index + 1}`,
          question: stringValue(answer.question) || `Confirmed decision ${index + 1}`,
          answer: stringValue(answer.answer) || null,
          answered: Boolean(stringValue(answer.answer)),
        };
      }),
    events: shapeActivity(input.events, new Map([[build.id, build]]), [build], input.system ? [shapeSystem(input.system)] : []),
    linkedSystem: input.system ? shapeSystem(input.system) : null,
    voiceMemo: voice ? {
      status: stringValue(voice.status) || "ready",
      statusLabel: titleCase(stringValue(voice.status) || "ready"),
      duration: durationLabel(numberValue(voice.duration_seconds)),
    } : null,
  };
}

export function emptyPortal(available = true): PortalDashboardData {
  return {
    activity: [],
    available,
    businessName: "Your workspace",
    builds: [],
    monthlyRetainer: "—",
    nextBillingDate: null,
    systems: [],
  };
}

function shapeBuild(build: Row, quoteAmounts: Map<string, number>): PortalBuild {
  const id = String(build.id);
  const status = stringValue(build.status) || "draft";
  const context = recordValue(build.extracted_context);
  const demand = recordValue(context.demand);
  const developmentBrief = recordValue(context.developmentBrief);
  const emailBrief = recordValue(context.emailBrief);
  const steps = arrayValue(build.system_definition);
  const createdIso = stringValue(build.created_at);
  const updatedIso = stringValue(build.updated_at);
  return {
    id,
    title: stringValue(build.title) || "Automation request",
    status,
    statusLabel: buildStatusLabel(status),
    summary: stringValue(emailBrief.overview)
      || stringValue(developmentBrief.desiredOutcome)
      || stringValue(demand.summary)
      || "Ajani is reviewing the workflow and the next delivery decision.",
    category: stringValue(demand.demandCategory) || "Automation workflow",
    stepCount: steps.length,
    progress: buildProgress(status),
    nextStep: buildNextStep(status),
    price: formatPrice(quoteAmounts.get(id) ?? numberValue(build.quoted_amount_cents)),
    created: formatDate(createdIso),
    createdIso,
    updated: formatRelativeDate(updatedIso),
    updatedIso,
  };
}

function shapeSystem(system: Row): PortalSystem {
  const health = stringValue(system.health) || "paused";
  const status = stringValue(system.status) || "in_review";
  const lastSuccess = stringValue(system.last_success_at);
  const lastError = stringValue(system.last_error_at);
  return {
    id: stringValue(system.id),
    buildRequestId: stringValue(system.build_request_id) || null,
    name: stringValue(system.name) || "Automation system",
    health,
    healthLabel: health === "healthy" ? "Healthy" : health === "warning" ? "Watch list" : health === "error" ? "Needs attention" : "Paused",
    status,
    statusLabel: buildStatusLabel(status),
    metric: health === "healthy" ? "Running normally" : health === "warning" ? "Worth reviewing" : health === "error" ? "Action required" : "Not running",
    detail: titleCase(status),
    lastRun: lastSuccess
      ? `Last successful run ${formatRelativeDate(lastSuccess).toLowerCase()}`
      : lastError
        ? `Needs attention since ${formatDate(lastError)}`
        : "Waiting for its first recorded run",
  };
}

function shapeActivity(
  events: Row[],
  buildLookup: Map<string, PortalBuild>,
  builds: PortalBuild[],
  systems: PortalSystem[],
): PortalActivity[] {
  const eventActivity = events.map((event) => {
    const buildId = stringValue(event.build_request_id);
    const build = buildLookup.get(buildId);
    const eventType = stringValue(event.event_type);
    const timestamp = stringValue(event.created_at);
    const eventCopy = activityCopy(eventType);
    return {
      id: stringValue(event.id) || `${buildId}-${timestamp}`,
      title: eventCopy.title,
      detail: build?.title || "Automation request",
      href: buildId ? `/portal/builds/${buildId}` : "/portal/builds",
      timestamp,
      when: formatRelativeDate(timestamp),
      tone: eventCopy.tone,
    } satisfies PortalActivity;
  });
  if (eventActivity.length > 0) return eventActivity.slice(0, 8);

  const derived = [
    ...builds.map((build) => ({
      id: `build-${build.id}`,
      title: build.status === "live" ? "Build moved live" : "Build request updated",
      detail: build.title,
      href: `/portal/builds/${build.id}`,
      timestamp: build.updatedIso,
      when: build.updated,
      tone: build.status === "live" ? "complete" as const : "active" as const,
    })),
    ...systems.map((system) => ({
      id: `system-${system.id}`,
      title: system.health === "healthy" ? "System check passed" : "System status changed",
      detail: system.name,
      href: "/portal/systems",
      timestamp: "",
      when: system.lastRun,
      tone: system.health === "healthy" ? "complete" as const : "warning" as const,
    })),
  ];
  return derived.slice(0, 8);
}

function activityCopy(eventType: string): Pick<PortalActivity, "title" | "tone"> {
  switch (eventType) {
    case "request_submitted": return { title: "Request received", tone: "active" };
    case "quote_created": return { title: "Proposal prepared", tone: "active" };
    case "payment_received": return { title: "Build approved", tone: "complete" };
    case "build_started": return { title: "Build work started", tone: "active" };
    case "build_live": return { title: "Automation moved live", tone: "complete" };
    case "needs_attention": return { title: "A decision is needed", tone: "warning" };
    default: return { title: titleCase(eventType || "Request updated"), tone: "neutral" };
  }
}

async function portalOrganizationId() {
  const { userId, orgId } = await auth();
  if (!userId) throw new Error("portal_auth_required");
  const workspace = await provisionClerkWorkspace(userId, orgId ?? null);
  return workspace.organizationId;
}

function buildStatusLabel(status: string) {
  const labels: Record<string, string> = {
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
  return labels[status] ?? titleCase(status);
}

function buildProgress(status: string) {
  const progress: Record<string, number> = {
    draft: 8,
    clarifying: 20,
    quoted: 36,
    paid: 48,
    in_review: 58,
    in_progress: 78,
    live: 100,
    needs_attention: 62,
    cancelled: 0,
  };
  return progress[status] ?? 12;
}

function buildNextStep(status: string) {
  const steps: Record<string, string> = {
    draft: "Finish the request when you are ready.",
    clarifying: "Answer the open questions so the scope can be shaped.",
    quoted: "Review the proposed scope and budget.",
    paid: "Ajani is preparing the implementation handoff.",
    in_review: "Ajani is reviewing the approved workflow.",
    in_progress: "The system is being built and connected.",
    live: "The system is live and being monitored.",
    needs_attention: "Ajani needs one decision before work can continue.",
    cancelled: "This request is closed and remains in your history.",
  };
  return steps[status] ?? "Ajani will post the next decision here.";
}

function formatPrice(cents: number) {
  return cents > 0 ? formatMoney(cents) : "Scope review";
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
    : "Recently";
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  const difference = Date.now() - date.getTime();
  const days = Math.max(0, Math.floor(difference / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(value);
}

function durationLabel(seconds: number) {
  if (seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function portalError(error: unknown) {
  if (!error || typeof error !== "object") return { message: "Unknown error" };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : "Unknown error",
  };
}
