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
  authorizeAdminAction,
  clearAdminSessionCookie,
  fingerprintRequest,
  getAdminConfiguration,
  keysMatch,
  setAdminSessionCookie,
} from "@/lib/admin/session";
import {
  COLD_CALL_ANSWERS, COLD_CALL_DIALS, coldCallAnswersProblem, entryDayLabel, formatMetricValue, metricDeletionSchema, metricEntrySchema, outreachVoidSchema, shortMetricLabel,
} from "@/lib/admin/metric-query";
import type { MetricAggregation, MetricUnit } from "@/lib/admin/metric-types";
import { loadMetricCatalog } from "@/lib/admin/metrics";
import { withinDeadline } from "@/lib/operations/deadline";
import { z } from "zod";
import { indexSaved, savedFlags, type SavedValue } from "@/lib/admin/report-diff";
import { importableMetrics, REPORT_MAX_SAVE_VALUES, REPORT_MAX_VALUES, reportRemovalSchema, reportSaveSchema } from "@/lib/admin/report-import";
import { REPORT_COMPARE_DAYS, shiftDay } from "@/lib/admin/report-merge";
import { loadSavedValues } from "@/lib/admin/report-saved";
import { dripifySyncMessage, syncDripifyMetrics } from "@/lib/connectors/dripify";
import { connectorMessage, isConnectorId, syncConnector } from "@/lib/connectors/registry";
import { clearSampleModeCookie, isSampleMode, setSampleModeCookie } from "@/lib/admin/sample-mode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildStatusLabel, parseAjaniBuildPost, type AjaniBuildPost } from "@/lib/builds/conversation";
import { appUrl, recordBuildMessageEmail, sendBuildMessageEmail } from "@/lib/notifications/build-message";
import { adminReturnPath } from "@/lib/admin/return-path";

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
  // Every session starts on real numbers; an older sample switch must not outlive it.
  await clearSampleModeCookie();
  // Back to the build an email linked to, or the desk overview.
  redirect(adminReturnPath(formData.get("next")) ?? "/admin");
}

export async function logoutAdminAction() {
  await clearAdminSessionCookie();
  // The next unlock starts on real numbers.
  await clearSampleModeCookie();
  redirect("/admin/login");
}

/** Turns "Sample data" on ("1") or off ("0"). Only changes what the desk renders. */
export async function setSampleModeAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const enabled = formData.get("enabled");
  if (enabled !== "1" && enabled !== "0") return { status: "error", message: "Choose whether sample data is on or off." };
  if (enabled === "1") await setSampleModeCookie();
  else await clearSampleModeCookie();
  revalidatePath("/admin");
  return {
    status: "success",
    message: enabled === "1" ? "Sample data is on. Nothing you see is real." : "Showing real numbers again.",
    entityId: `sample:${enabled}:${Date.now()}`,
  };
}

/**
 * Made-up numbers must never reach the database: while sample data is shown,
 * every write refuses before it parses input or opens a database client.
 * Forms rendered with sample data also send sample=1, so a tab left open after
 * the switch was turned off elsewhere cannot change real numbers.
 */
async function refusedInSampleMode(formData?: FormData): Promise<AdminActionState | null> {
  if (formData?.get("sample") === "1") return { status: "error", message: "This page is showing sample data, so nothing was saved. Refresh the page to work with real numbers." };
  return await isSampleMode() ? { status: "error", message: "Sample data was switched on in another tab, so nothing was saved. Refresh the page." } : null;
}

export async function createExperimentAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
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
    return { status: "success", message: "Experiment created and ready for performance entry.", entityId: String(data) };
  } catch {
    return { status: "error", message: "The outreach tables are not ready yet. Apply the latest database migration and retry." };
  }
}

export async function createOutreachBatchAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
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
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
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
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
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

/**
 * The store keeps one number per metric, day and account, and a save replaces
 * it. Calls, DMs and replies are logged per session, so when the day already
 * has one of those flows, nothing is saved until the form says to add these to
 * it or replace it (onExisting). A total shown today, like followers, is
 * always replaced: the newest one is the right one.
 */
export async function recordMetricValuesAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
  let values: unknown;
  try {
    values = JSON.parse(String(formData.get("values") || "[]"));
  } catch {
    return { status: "error", message: "The numbers could not be read." };
  }
  const parsed = metricEntrySchema.safeParse({ date: formData.get("date"), dimension: formData.get("dimension") ?? "", values });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Check the numbers and retry." };
  const { date, dimension } = parsed.data;
  const onExisting = formData.get("onExisting");
  const choice = onExisting === "add" || onExisting === "replace" ? onExisting : null;
  const today = new Date().toISOString().slice(0, 10);
  const day = `${entryDayLabel(date, today)}${dimension ? ` on ${dimension}` : ""}`;

  // Read on every save, not only when asking: someone else may have logged since the question.
  const checksCalls = parsed.data.values.some((item) => COLD_CALL_KEYS.includes(item.metricKey));
  let logged: Awaited<ReturnType<typeof loadLoggedDay>>;
  try {
    logged = await loadLoggedDay(date, dimension, [...new Set([...parsed.data.values.map((item) => item.metricKey), ...(checksCalls ? COLD_CALL_KEYS : [])])]);
  } catch {
    return { status: "error", message: "The saved numbers couldn't be checked, so nothing was saved. Retry in a moment." };
  }
  const { saved, definitions } = logged;
  // A saved zero needs no question: adding to it and replacing it are the same.
  const existing = parsed.data.values.filter((item) => definitions.get(item.metricKey)?.aggregation === "sum" && (saved.get(item.metricKey) ?? 0) > 0);
  if (existing.length && !choice) {
    return {
      status: "error",
      code: "existing",
      message: `${day} already has ${listed(existing.map((item) => amount(saved.get(item.metricKey)!, definitions.get(item.metricKey)!)))}. Add these to them, or replace them?`,
      entityId: `existing:${Date.now()}`,
    };
  }
  const adding = new Set(choice === "add" ? existing.map((item) => item.metricKey) : []);
  // numeric(20, 4) in the store: four decimals keep 0.1 + 0.2 from saving as 0.30000000000000004.
  const final = parsed.data.values.map((item) => adding.has(item.metricKey) ? { ...item, value: Number((saved.get(item.metricKey)! + item.value).toFixed(4)) } : item);
  const problem = coldCallAnswersProblem(new Map([...saved, ...final.map((item) => [item.metricKey, item.value] as const)]), date, today);
  if (problem) {
    // Say when saved numbers are part of it: "5 calls made" on a day with 17
    // saved answers would otherwise read as if the answers had just been typed.
    const countsSaved = COLD_CALL_KEYS.some((key) => adding.has(key) || (saved.has(key) && !final.some((item) => item.metricKey === key)));
    return { status: "error", message: countsSaved ? `${problem} That counts what's already saved for that day. If a saved number is wrong, log only the right number for it and choose Replace them.` : problem };
  }

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("upsert_analytics_metric_values", {
      p_values: final.map((item) => ({ ...item, date, dimension })),
      p_origin: "manual",
      p_actor: actor,
    });
    if (error) throw error;
    revalidatePath("/admin");
    const written = Number(data) || 0;
    const added = final.filter((item) => adding.has(item.metricKey));
    const others = final.filter((item) => !adding.has(item.metricKey));
    // The numbers saved alongside, so the message accounts for the whole save.
    const alsoSaved = !others.length ? ""
      : others.length <= 3 && others.every((item) => definitions.has(item.metricKey))
        ? ` Also saved ${listed(others.map((item) => amount(item.value, definitions.get(item.metricKey)!)))}.`
        : ` Also saved ${others.length} other ${others.length === 1 ? "number" : "numbers"}.`;
    return {
      status: "success",
      message: added.length ? `Added to ${day}: now ${listed(added.map((item) => amount(item.value, definitions.get(item.metricKey)!)))}.${alsoSaved} Trends are updated.`
        : written ? `Saved ${written} ${written === 1 ? "number" : "numbers"} for ${day}${existing.length ? ", replacing what was there" : ""}. Trends are updated.`
          : "Those numbers were already recorded. Nothing changed.",
      entityId: `${date}:${Date.now()}`,
    };
  } catch (error) {
    const message = error && typeof error === "object" && "code" in error && error.code === "P0001" && "message" in error ? String(error.message) : null;
    return { status: "error", message: message ?? "These numbers could not be saved. Apply the latest database migration and retry." };
  }
}

/**
 * Saves the rows the owner kept after files were read, and removes the saved
 * numbers they agreed were wrong. Everything is checked again here, never
 * trusted from the browser: rows go through the same store rules as typed
 * numbers, a row that looks wrong next to the saved numbers must have been
 * ticked on purpose, and a saved number is removed only while it still holds
 * the value the owner saw. Saving a day again replaces it.
 */
export async function saveReportValuesAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
  let rows: unknown;
  let removals: unknown;
  let confirmed: unknown;
  try {
    rows = JSON.parse(String(formData.get("rows") || "[]"));
    removals = JSON.parse(String(formData.get("removals") || "[]"));
    confirmed = JSON.parse(String(formData.get("confirmed") || "[]"));
  } catch {
    return { status: "error", message: "The numbers could not be read. Read the report again." };
  }
  const catalog = await loadMetricCatalog();
  if (catalog.status !== "available") return { status: "error", message: "Trends are unavailable right now, so nothing was saved. Retry in a moment." };
  const importable = new Map(importableMetrics(catalog.metrics).map((metric) => [metric.key, metric]));
  const allowed = new Map([...importable.values()].map((metric) => [metric.key, metric.unit]));
  const parsed = reportSaveSchema(catalog.today, allowed).safeParse(rows);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message || "Check the numbers and retry." };
  const parsedRemovals = reportRemovalSchema(catalog.today, allowed).safeParse(removals);
  if (!parsedRemovals.success) return { status: "error", message: parsedRemovals.error.issues[0]?.message || "Check the numbers to remove and retry." };
  const parsedConfirmed = z.array(z.string().max(200)).max(REPORT_MAX_SAVE_VALUES).safeParse(confirmed);
  if (!parsedConfirmed.success) return { status: "error", message: "The review could not be read. Read the report again." };
  const values = parsed.data;
  const removing = parsedRemovals.data;
  if (!values.length && !removing.length) return { status: "error", message: "Pick at least one number to save" };
  const removed = new Set(removing.map((row) => `${row.metricKey}|${row.date}`));
  if (values.some((row) => removed.has(`${row.metricKey}|${row.date}`))) return { status: "error", message: "A number can't be saved and removed at once. Read the report again." };

  // The store as it is now: a removal must still hold the value the owner saw,
  // and a row that looks wrong next to the saved numbers must have been ticked on purpose.
  let saved: SavedValue[];
  try {
    const dates = [...values, ...removing].map((row) => row.date).sort();
    saved = await loadSavedValues(
      [...new Set([...values, ...removing].map((row) => row.metricKey))],
      shiftDay(dates[0], -REPORT_COMPARE_DAYS), shiftDay(dates[dates.length - 1], REPORT_COMPARE_DAYS),
    );
  } catch {
    return { status: "error", message: "The saved numbers couldn't be checked, so nothing was saved. Retry in a moment." };
  }
  const current = new Map(saved.map((item) => [`${item.metricKey}|${item.date}`, item]));
  for (const removal of removing) {
    const item = current.get(`${removal.metricKey}|${removal.date}`);
    if (!item || item.synced || Math.abs(item.value - removal.value) > 1e-6) {
      return { status: "error", message: "A saved number changed after you reviewed it, so nothing was saved. Read the file again." };
    }
  }
  const index = indexSaved(saved, removed);
  const ticked = new Set(parsedConfirmed.data);
  for (const row of values) {
    const metric = importable.get(row.metricKey)!;
    const [flag] = savedFlags({ ...row, unit: metric.unit, aggregation: metric.aggregation }, index);
    if (flag && !ticked.has(`${row.metricKey}|${row.date}`)) {
      return { status: "error", message: `Nothing was saved: ${metric.label} on ${row.date} needs a second look. ${flag} Read the file again and tick it if it's right.` };
    }
  }

  // The store takes 500 values per call; a save that combines several files goes in batches.
  const admin = createSupabaseAdminClient();
  let written = 0;
  let stored = 0;
  try {
    for (let start = 0; start < values.length; start += REPORT_MAX_VALUES) {
      const batch = values.slice(start, start + REPORT_MAX_VALUES);
      const { data, error } = await admin.rpc("upsert_analytics_metric_values", {
        // Imports are about the owner's main accounts, which have no account name.
        p_values: batch.map((row) => ({ ...row, dimension: "" })),
        p_origin: "manual",
        p_actor: actor,
      });
      if (error) throw error;
      written += Number(data) || 0;
      stored += batch.length;
    }
  } catch (error) {
    const reason = error && typeof error === "object" && "code" in error && error.code === "P0001" && "message" in error ? String(error.message) : null;
    if (!stored) return { status: "error", message: reason ?? "These numbers could not be saved. Retry in a moment." };
    revalidatePath("/admin");
    return { status: "error", message: `Saved ${stored} of ${values.length} numbers, then the rest failed${reason ? `: ${reason}` : ""}. Save again to finish; numbers already saved are simply replaced.` };
  }
  // Each removal is logged with the value it removed, so it can be typed back in.
  let cleared = 0;
  try {
    for (const removal of removing) {
      const { data, error } = await admin.rpc("delete_analytics_metric_value", {
        p_metric_key: removal.metricKey, p_metric_date: removal.date, p_dimension_key: "", p_actor: actor,
      });
      if (error) throw error;
      if (data) cleared += 1;
    }
  } catch {
    revalidatePath("/admin");
    return { status: "error", message: `${values.length ? `Saved ${values.length} ${values.length === 1 ? "number" : "numbers"}, but removing` : "Removing"} the wrong numbers stopped after ${cleared} of ${removing.length}. Read the file again to finish.` };
  }
  revalidatePath("/admin");
  const days = new Set(values.map((row) => row.date)).size;
  const done = [
    written ? `saved ${written} ${written === 1 ? "number" : "numbers"} across ${days} ${days === 1 ? "day" : "days"}` : "",
    cleared ? `removed ${cleared} wrong ${cleared === 1 ? "number" : "numbers"}` : "",
  ].filter(Boolean).join(" and ");
  return {
    status: "success",
    message: done ? `${done.charAt(0).toUpperCase()}${done.slice(1)}. Trends are updated.` : "Those numbers were already recorded. Nothing changed.",
    entityId: `report:${Date.now()}`,
  };
}

export async function deleteMetricValueAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const actor = access.userId;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
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
export async function syncDripifyAction(_state?: AdminActionState, formData?: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
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

export async function syncConnectorAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
  const connector = formData.get("connector");
  if (!isConnectorId(connector)) return { status: "error", message: "Choose YouTube or Instagram to sync." };
  try {
    const result = await syncConnector(connector, { deadlineAt: Date.now() + 45_000 });
    revalidatePath("/admin");
    return { ...connectorMessage(result), entityId: `${connector}:${Date.now()}` };
  } catch {
    console.error("Manual platform sync failed", { connector });
    return { status: "error", message: "The sync could not run. Apply the latest database migration, then retry in a few minutes." };
  }
}

/** Calls made and the three answers: a save touching any of them is checked against all four. */
const COLD_CALL_KEYS = [COLD_CALL_DIALS, ...COLD_CALL_ANSWERS];

type LoggedMetric = { label: string; unit: MetricUnit; aggregation: MetricAggregation };

/** A day's saved numbers on one account for these metrics, and how each metric adds up. */
async function loadLoggedDay(date: string, dimension: string, keys: string[]) {
  const admin = createSupabaseAdminClient();
  const deadlineAt = Date.now() + 8_000;
  const [saved, defined] = await Promise.all([
    withinDeadline(admin.from("analytics_metric_daily").select("metric_key, value").eq("metric_date", date).eq("dimension_key", dimension).in("metric_key", keys), deadlineAt),
    withinDeadline(admin.from("analytics_metric_definitions").select("metric_key, label, unit, aggregation").in("metric_key", keys), deadlineAt),
  ]);
  if (saved.error) throw saved.error;
  if (defined.error) throw defined.error;
  const savedRows = (saved.data ?? []) as Array<{ metric_key: string; value: number | string }>;
  const definitionRows = (defined.data ?? []) as Array<{ metric_key: string; label: string; unit: MetricUnit; aggregation: MetricAggregation }>;
  return {
    // Postgres numerics may arrive as numeric strings.
    saved: new Map(savedRows.map((row) => [row.metric_key, Number(row.value)] as const).filter(([, value]) => Number.isFinite(value))),
    definitions: new Map<string, LoggedMetric>(definitionRows.map((row) => [row.metric_key, { label: row.label, unit: row.unit, aggregation: row.aggregation }])),
  };
}

/** "30 cold calls made", "$3,950 cash collected", "12 DMs sent". */
function amount(value: number, metric: LoggedMetric) {
  const label = shortMetricLabel(metric.label);
  const words = /^[A-Z]{2}/.test(label) ? label : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  return `${formatMetricValue(value, metric.unit).replace(/ h$/, "")} ${words}`;
}

/**
 * Posts an update or question on a client's build, moves its stage, or both.
 * The post shows in the client's portal at once; the client is emailed when
 * the box is ticked. A failed email never undoes the post.
 */
export async function postBuildUpdateAction(_state: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const access = await authorizeAdminAction();
  if (access.status === "refused") return access.state;
  const refused = await refusedInSampleMode(formData);
  if (refused) return refused;
  const parsed = parseAjaniBuildPost(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const post = parsed.value;

  let messageId: string | null;
  let stage: string;
  try {
    const admin = createSupabaseAdminClient();
    // A question on a closed build cannot be answered: the client's reply box is off there.
    if (post.kind === "question" && post.body) {
      let closed = post.status === "cancelled";
      if (!closed && !post.status) {
        const { data: current, error: currentError } = await admin.from("build_requests").select("status").eq("id", post.buildId).maybeSingle();
        if (currentError) throw currentError;
        closed = current?.status === "cancelled";
      }
      if (closed) return { status: "error", message: "This build is closed, so the client cannot answer a question. Post it as an update, or move the build to another stage in the same post." };
    }
    const { data, error } = await admin.rpc("post_build_update", {
      p_build_request_id: post.buildId,
      p_actor: access.userId,
      p_status: post.status,
      p_kind: post.kind,
      p_body: post.body,
      p_link_url: post.link?.url ?? null,
      p_link_label: post.link?.label ?? null,
    });
    if (error) {
      if (error.message.includes("nothing_to_post")) return { status: "error", message: "The build is already at that stage. Write an update, or pick a different stage." };
      if (error.message.includes("build_request_not_found")) return { status: "error", message: "This build could not be found. Go back to the list and open it again." };
      throw error;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { message_id: string | null; current_status: string } | null;
    messageId = row?.message_id ?? null;
    stage = row?.current_status ?? "";
  } catch (error) {
    console.error("Build update failed", { buildId: post.buildId, message: error instanceof Error ? error.message : "unknown" });
    return { status: "error", message: "Nothing was posted. If this keeps happening, the build conversation migration may not be applied to this database yet." };
  }

  let emailNote = "";
  if (messageId && post.notifyClient) {
    const emailed = await emailClientAboutPost(post, messageId);
    emailNote = emailed === "sent" ? " The client was emailed."
      : emailed === "not_member" ? " No email was sent: the person who requested this build is no longer in the client's workspace."
        : " The email to the client may not have sent, but the post is in their portal.";
  }
  revalidatePath("/admin/builds");
  revalidatePath(`/admin/builds/${post.buildId}`);
  const posted = messageId ? `${post.kind === "question" ? "Question" : "Update"} posted to the client's portal.` : `Stage moved to ${buildStatusLabel(stage)}.`;
  const stageNote = messageId && post.status ? ` Stage is now ${buildStatusLabel(stage)}.` : "";
  return { status: "success", message: `${posted}${stageNote}${emailNote}`, entityId: messageId ?? `stage:${stage}:${Date.now()}` };
}

/**
 * Emails the person who requested the build, while they can still open its
 * portal: an active member of a workspace that is not archived. Returns how it
 * went; never throws.
 */
async function emailClientAboutPost(post: AjaniBuildPost, messageId: string): Promise<"sent" | "failed" | "not_member"> {
  let result: "sent" | "failed";
  try {
    const admin = createSupabaseAdminClient();
    const { data: build, error } = await admin.from("build_requests").select("title,created_by,organization_id").eq("id", post.buildId).maybeSingle();
    if (error || !build) throw error ?? new Error("build_missing");
    const [profileResult, membershipResult, organizationResult] = await Promise.all([
      admin.from("profiles").select("email,deleted_at").eq("id", String(build.created_by)).maybeSingle(),
      admin.from("organization_members").select("user_id").eq("organization_id", String(build.organization_id)).eq("user_id", String(build.created_by)).is("deleted_at", null).maybeSingle(),
      admin.from("organizations").select("archived_at").eq("id", String(build.organization_id)).maybeSingle(),
    ]);
    const lookupError = profileResult.error ?? membershipResult.error ?? organizationResult.error;
    if (lookupError) throw lookupError;
    // A removed member must not receive what the portal now hides from them.
    if (!membershipResult.data || organizationResult.data?.archived_at || profileResult.data?.deleted_at) return "not_member";
    const profile = profileResult.data;
    const title = typeof build.title === "string" && build.title ? build.title : "your build";
    const question = post.kind === "question";
    result = await sendBuildMessageEmail({
      to: typeof profile?.email === "string" ? profile.email : "",
      subject: question ? `Ajani has a question about ${title}` : `New update on ${title}`,
      eyebrow: question ? "Question from Ajani" : "Build update",
      heading: title,
      intro: question ? "Ajani needs a quick answer to keep this build moving." : "Here is the latest on your build.",
      body: post.body ?? "",
      link: post.link ? { url: post.link.url, label: post.link.label ?? "Open link" } : null,
      ctaUrl: `${appUrl()}/portal/builds/${post.buildId}#conversation`,
      ctaLabel: question ? "Answer in your portal" : "Open your portal",
      idempotencyKey: `build-message-${messageId}`,
    });
  } catch (error) {
    console.error("Build update email failed", { buildId: post.buildId, message: error instanceof Error ? error.message : "unknown" });
    result = "failed";
  }
  await recordBuildMessageEmail(messageId, result);
  return result;
}

/** "a", "a and b", "a, b and c". */
function listed(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function hasActivity(metric: OutreachMetricInput) {
  return metric.connectionRequests + metric.connectionsAccepted + metric.initialDms + metric.f1Sent + metric.f2Sent + metric.customSent + metric.replies + metric.attributedReplies + metric.positiveReplies + metric.callsBooked > 0;
}

function labelForIndex(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : `V${index + 1}`;
}
