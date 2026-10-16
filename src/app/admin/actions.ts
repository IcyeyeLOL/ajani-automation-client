"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AdminActionState } from "@/app/admin/action-state";
import { requireAdminClerkUser } from "@/lib/admin/clerk";
import { consumeAdminLoginAllowance } from "@/lib/admin/login-throttle";
import {
  adminLoginSchema,
  experimentMetricEntrySchema,
  outreachBatchSchema,
  outreachExperimentSchema,
  type OutreachMetricInput,
} from "@/lib/admin/validation";
import {
  clearAdminSessionCookie,
  fingerprintRequest,
  getAdminConfiguration,
  keysMatch,
  requireAdminSession,
  setAdminSessionCookie,
} from "@/lib/admin/session";
import { metricDeletionSchema, metricEntrySchema, outreachVoidSchema } from "@/lib/admin/metric-query";
import { dripifySyncMessage, syncDripifyMetrics } from "@/lib/connectors/dripify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function unlockAdminAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminClerkUser("/admin/login");
  const configuration = getAdminConfiguration();
  if (!configuration) return { status: "error", message: "Admin access has not been configured for this environment." };
  const parsed = adminLoginSchema.safeParse({ accessKey: formData.get("accessKey") });
  if (!parsed.success) return { status: "error", message: "Enter the team access key." };

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-vercel-forwarded-for")
    || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    || requestHeaders.get("x-real-ip")
    || "local";
  const fingerprints = [
    fingerprintRequest("admin-user", actor, configuration.sessionSecret),
    fingerprintRequest("admin-ip", ip, configuration.sessionSecret),
  ];
  let allowed = false;
  try {
    allowed = await consumeAdminLoginAllowance(createSupabaseAdminClient(), fingerprints);
  } catch {
    // Missing infrastructure must not bypass the attempt budget.
  }
  if (!allowed) {
    return { status: "error", message: "Access is temporarily locked. Try again in 15 minutes." };
  }

  if (!keysMatch(parsed.data.accessKey, configuration.accessKey)) {
    return { status: "error", message: "The access key is not valid." };
  }

  await setAdminSessionCookie(configuration.sessionSecret);
  redirect("/admin");
}

export async function logoutAdminAction() {
  await clearAdminSessionCookie();
  redirect("/admin/login");
}

export async function createExperimentAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminSession();
  const parsed = outreachExperimentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Check the experiment details." };
  const variantTitles = parsed.data.variants.split(",").map((variant) => variant.trim()).filter(Boolean);
  if (variantTitles.length < 2 || variantTitles.length > 8) return { status: "error", message: "Add between two and eight comma-separated variants." };
  const variants = variantTitles.map((title, index) => ({ label: labelForIndex(index), title }));

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("create_outreach_experiment", {
      p_title: parsed.data.title,
      p_audience: parsed.data.audience,
      p_campaign: parsed.data.campaign,
      p_channel: parsed.data.channel,
      p_method: parsed.data.method,
      p_message_step: parsed.data.messageStep,
      p_primary_metric: parsed.data.primaryMetric,
      p_created_by: actor,
      p_variants: variants,
    });
    if (error) throw error;
    revalidatePath("/admin");
    return { status: "success", message: "Experiment created and ready for batch logging.", entityId: String(data) };
  } catch {
    return { status: "error", message: "The outreach tables are not ready yet. Apply the latest database migration and retry." };
  }
}

export async function createOutreachBatchAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminSession();
  let metrics: unknown;
  try {
    metrics = JSON.parse(String(formData.get("metrics") || "[]"));
  } catch {
    return { status: "error", message: "The activity grid could not be read." };
  }
  const experimentId = String(formData.get("experimentId") || "").trim();
  const parsed = outreachBatchSchema.safeParse({
    activityDate: formData.get("activityDate"),
    teamMember: formData.get("teamMember"),
    channel: formData.get("channel"),
    method: formData.get("method"),
    audience: formData.get("audience"),
    campaign: formData.get("campaign"),
    experimentId: experimentId || null,
    notes: formData.get("notes"),
    metrics,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Check the outreach totals." };
  if (!parsed.data.metrics.some(hasActivity)) return { status: "error", message: "Enter at least one activity or outcome count." };

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("create_outreach_batch", {
      p_activity_date: parsed.data.activityDate,
      p_team_member: parsed.data.teamMember,
      p_channel: parsed.data.channel,
      p_method: parsed.data.method,
      p_audience: parsed.data.audience,
      p_campaign: parsed.data.campaign,
      p_experiment_id: parsed.data.experimentId,
      p_notes: parsed.data.notes,
      p_metrics: parsed.data.metrics,
      p_actor: actor,
    });
    if (error) throw error;
    revalidatePath("/admin");
    return { status: "success", message: "Outreach batch saved. Dashboard statistics have been recalculated.", entityId: String(data) };
  } catch {
    return { status: "error", message: "This batch could not be saved. Confirm the outreach migration is applied and retry." };
  }
}

export async function logExperimentMetricsAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminSession();
  let metrics: unknown;
  try {
    metrics = JSON.parse(String(formData.get("metrics") || "[]"));
  } catch {
    return { status: "error", message: "The experiment counts could not be read." };
  }

  const parsed = experimentMetricEntrySchema.safeParse({
    experimentId: formData.get("experimentId"),
    messageStep: formData.get("messageStep"),
    activityDate: formData.get("activityDate"),
    teamMember: formData.get("teamMember"),
    notes: formData.get("notes"),
    metrics,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Check the experiment counts." };
  if (!parsed.data.metrics.some((metric) => metric.sent + metric.replies + metric.positiveReplies + metric.callsBooked + metric.connectionRequests + metric.connectionsAccepted > 0)) {
    return { status: "error", message: "Enter at least one experiment activity or outcome count." };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("create_experiment_metric_snapshot", {
      p_experiment_id: parsed.data.experimentId,
      p_activity_date: parsed.data.activityDate,
      p_team_member: parsed.data.teamMember,
      p_notes: parsed.data.notes,
      p_metrics: parsed.data.metrics,
      p_actor: actor,
    });
    if (error) throw error;
    revalidatePath("/admin");
    return { status: "success", message: "Experiment counts saved. Every rate and comparison has been recalculated.", entityId: String(data) };
  } catch {
    return { status: "error", message: "These experiment counts could not be saved. Apply the latest database migration and retry." };
  }
}

export async function voidOutreachBatchAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminSession();
  const parsed = outreachVoidSchema.safeParse({ batchId: formData.get("batchId"), reason: formData.get("reason") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Add a reason for voiding this entry." };

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("void_outreach_batch", {
      p_batch_id: parsed.data.batchId,
      p_reason: parsed.data.reason,
      p_actor: actor,
    });
    if (error) throw error;
    revalidatePath("/admin");
    return data
      ? { status: "success", message: "Entry voided. It no longer counts toward any total.", entityId: parsed.data.batchId }
      : { status: "error", message: "That entry was already voided." };
  } catch {
    return { status: "error", message: "This entry could not be voided. Apply the latest database migration and retry." };
  }
}

/** Upserts: re-entering a day replaces its value instead of adding to it. */
export async function recordMetricValuesAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminSession();
  let values: unknown;
  try {
    values = JSON.parse(String(formData.get("values") || "[]"));
  } catch {
    return { status: "error", message: "The numbers could not be read." };
  }
  const parsed = metricEntrySchema.safeParse({ date: formData.get("date"), dimension: formData.get("dimension") ?? "", values });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Check the numbers and retry." };

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("upsert_analytics_metric_values", {
      p_values: parsed.data.values.map((item) => ({ ...item, date: parsed.data.date, dimension: parsed.data.dimension })),
      p_origin: "manual",
      p_actor: actor,
    });
    if (error) throw error;
    revalidatePath("/admin");
    const written = Number(data) || 0;
    return {
      status: "success",
      message: written ? `Saved ${written} ${written === 1 ? "number" : "numbers"} for ${parsed.data.date}. Trends are updated.` : "Those numbers were already recorded. Nothing changed.",
      entityId: `${parsed.data.date}:${Date.now()}`,
    };
  } catch (error) {
    const message = error && typeof error === "object" && "code" in error && error.code === "P0001" && "message" in error ? String(error.message) : null;
    return { status: "error", message: message ?? "These numbers could not be saved. Apply the latest database migration and retry." };
  }
}

export async function deleteMetricValueAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireAdminSession();
  const parsed = metricDeletionSchema.safeParse({
    metricKey: formData.get("metricKey"),
    date: formData.get("date"),
    dimension: formData.get("dimension") ?? "",
  });
  if (!parsed.success) return { status: "error", message: "That entry could not be identified." };

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("delete_analytics_metric_value", {
      p_metric_key: parsed.data.metricKey,
      p_metric_date: parsed.data.date,
      p_dimension_key: parsed.data.dimension,
      p_actor: actor,
    });
    if (error) throw error;
    revalidatePath("/admin");
    return data
      ? { status: "success", message: "Entry removed.", entityId: `${parsed.data.metricKey}:${parsed.data.date}:${Date.now()}` }
      : { status: "error", message: "That entry was already removed." };
  } catch {
    return { status: "error", message: "This entry could not be removed. Retry in a moment." };
  }
}

/** Same job as the nightly cron, run on demand so a new key can be checked immediately. */
export async function syncDripifyAction(): Promise<AdminActionState> {
  await requireAdminSession();
  try {
    // Inside the dashboard page's maxDuration, with room to render the result.
    const result = await syncDripifyMetrics({ deadlineAt: Date.now() + 45_000 });
    if (result.valuesWritten > 0) revalidatePath("/admin");
    return { ...dripifySyncMessage(result), entityId: `dripify:${Date.now()}` };
  } catch (error) {
    console.error("Manual Dripify sync failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return { status: "error", message: "Dripify could not be synced. Apply the latest database migration, then retry in a few minutes." };
  }
}

function hasActivity(metric: OutreachMetricInput) {
  return metric.connectionRequests + metric.connectionsAccepted + metric.initialDms + metric.f1Sent + metric.f2Sent + metric.customSent + metric.replies + metric.attributedReplies + metric.positiveReplies + metric.callsBooked > 0;
}

function labelForIndex(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : `V${index + 1}`;
}
