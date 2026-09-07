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

function hasActivity(metric: OutreachMetricInput) {
  return metric.connectionRequests + metric.connectionsAccepted + metric.initialDms + metric.f1Sent + metric.f2Sent + metric.customSent + metric.replies + metric.attributedReplies + metric.positiveReplies + metric.callsBooked > 0;
}

function labelForIndex(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : `V${index + 1}`;
}
