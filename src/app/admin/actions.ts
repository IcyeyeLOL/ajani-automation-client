"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AdminActionState } from "@/app/admin/action-state";
import { requireAdminClerkUser } from "@/lib/admin/clerk";
import {
  adminLoginSchema,
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
  await requireAdminClerkUser("/admin/login");
  const configuration = getAdminConfiguration();
  if (!configuration) return { status: "error", message: "Admin access has not been configured for this environment." };
  const parsed = adminLoginSchema.safeParse({ accessKey: formData.get("accessKey") });
  if (!parsed.success) return { status: "error", message: "Enter the team access key." };

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || "local";
  const fingerprint = fingerprintRequest(ip, requestHeaders.get("user-agent") || "unknown", configuration.sessionSecret);
  if (await isBlocked(fingerprint)) return { status: "error", message: "Access is temporarily locked. Try again in 15 minutes." };

  if (!keysMatch(parsed.data.accessKey, configuration.accessKey)) {
    await recordFailedLogin(fingerprint);
    return { status: "error", message: "The access key is not valid." };
  }

  await clearFailedLogins(fingerprint);
  await setAdminSessionCookie(configuration.sessionSecret);
  redirect("/admin");
}

export async function logoutAdminAction() {
  await clearAdminSessionCookie();
  redirect("/admin/login");
}

export async function createExperimentAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireAdminSession();
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
      p_primary_metric: parsed.data.primaryMetric,
      p_created_by: parsed.data.createdBy,
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
  await requireAdminSession();
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
    });
    if (error) throw error;
    revalidatePath("/admin");
    return { status: "success", message: "Outreach batch saved. Dashboard statistics have been recalculated.", entityId: String(data) };
  } catch {
    return { status: "error", message: "This batch could not be saved. Confirm the outreach migration is applied and retry." };
  }
}

function hasActivity(metric: OutreachMetricInput) {
  return metric.connectionRequests + metric.connectionsAccepted + metric.initialDms + metric.f1Sent + metric.f2Sent + metric.replies + metric.positiveReplies + metric.callsBooked > 0;
}

function labelForIndex(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : `V${index + 1}`;
}

async function isBlocked(fingerprint: string) {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("admin_login_attempts").select("blocked_until").eq("fingerprint", fingerprint).maybeSingle();
    return Boolean(data?.blocked_until && Date.parse(data.blocked_until) > Date.now());
  } catch {
    return false;
  }
}

async function recordFailedLogin(fingerprint: string) {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("admin_login_attempts").select("failed_attempts,window_started_at").eq("fingerprint", fingerprint).maybeSingle();
    const now = Date.now();
    const withinWindow = data?.window_started_at && now - Date.parse(data.window_started_at) < 15 * 60 * 1000;
    const failedAttempts = withinWindow ? Number(data.failed_attempts) + 1 : 1;
    await admin.from("admin_login_attempts").upsert({
      fingerprint,
      failed_attempts: failedAttempts,
      window_started_at: withinWindow ? data.window_started_at : new Date(now).toISOString(),
      blocked_until: failedAttempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null,
      last_attempt_at: new Date(now).toISOString(),
    });
  } catch {
    // Authentication still uses constant-time verification if persistence is unavailable.
  }
}

async function clearFailedLogins(fingerprint: string) {
  try {
    await createSupabaseAdminClient().from("admin_login_attempts").delete().eq("fingerprint", fingerprint);
  } catch {
    // A successful key check is sufficient when the audit table is unavailable.
  }
}
