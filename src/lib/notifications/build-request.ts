import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 500;
export const RESEND_TIMEOUT_MS = 8_000;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type ClaimedJob = {
  build_request_id: string;
  attempt_count: number;
};

type BuildRequestSummary = {
  id: string;
  created_by: string;
  title: string;
  status: string;
  created_at: string;
  extracted_context: unknown;
  system_definition: unknown;
  plain_language_scope: string | null;
  organizations: { business_name?: string | null } | { business_name?: string | null }[] | null;
  requester: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
};

export type NotificationSweepResult = {
  claimed: number;
  sent: number;
  retryableFailures: number;
  terminalFailures: number;
};

export async function processBuildRequestNotifications(options: {
  buildRequestId?: string;
  limit?: number;
  admin?: AdminClient;
} = {}): Promise<NotificationSweepResult> {
  const admin = options.admin ?? createSupabaseAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);
  const result: NotificationSweepResult = {
    claimed: 0,
    sent: 0,
    retryableFailures: 0,
    terminalFailures: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNotification(admin, options.buildRequestId);
    if (!job) break;
    result.claimed += 1;

    try {
      const request = await loadBuildRequest(admin, job.build_request_id);
      const messageId = await sendBuildRequestEmail(request);
      const { error } = await admin
        .from("build_request_notification_jobs")
        .update({
          status: "sent",
          provider_message_id: messageId,
          sent_at: new Date().toISOString(),
          next_attempt_at: null,
          last_error: null,
        })
        .eq("build_request_id", job.build_request_id)
        .eq("status", "sending");
      if (error) throw new Error(`notification_state_update_failed:${error.message}`);
      result.sent += 1;
    } catch (error) {
      const retryable = isRetryable(error) && job.attempt_count < MAX_ATTEMPTS;
      const { error: stateError } = await admin
        .from("build_request_notification_jobs")
        .update({
          status: retryable ? "retryable_failed" : "terminal_failed",
          next_attempt_at: retryable ? retryAt(job.attempt_count) : null,
          last_error: safeErrorMessage(error),
        })
        .eq("build_request_id", job.build_request_id)
        .eq("status", "sending");

      if (stateError) {
        console.error("Build request notification state update failed", {
          buildRequestId: job.build_request_id,
          message: stateError.message,
        });
      }
      if (retryable) result.retryableFailures += 1;
      else result.terminalFailures += 1;
    }

    if (options.buildRequestId) break;
  }

  return result;
}

async function claimNotification(admin: AdminClient, buildRequestId?: string) {
  const { data, error } = await admin.rpc("claim_build_request_notification", {
    p_build_request_id: buildRequestId ?? null,
  });
  if (error) throw new Error(`notification_claim_failed:${error.message}`);
  const claimed = Array.isArray(data) ? data[0] : data;
  if (!claimed) return null;
  return claimed as ClaimedJob;
}

async function loadBuildRequest(admin: AdminClient, buildRequestId: string) {
  const { data, error } = await admin
    .from("build_requests")
    .select("id,created_by,title,status,created_at,extracted_context,system_definition,plain_language_scope,organizations(business_name)")
    .eq("id", buildRequestId)
    .single();
  if (error || !data) throw new Error(`notification_request_missing:${error?.message ?? "not_found"}`);
  const request = data as unknown as Omit<BuildRequestSummary, "requester">;
  const { data: requester, error: requesterError } = await admin
    .from("profiles")
    .select("full_name,email,phone")
    .eq("id", request.created_by)
    .maybeSingle();
  if (requesterError) throw new Error(`notification_requester_missing:${requesterError.message}`);
  return { ...request, requester } as BuildRequestSummary;
}

async function sendBuildRequestEmail(request: BuildRequestSummary) {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.INTERNAL_NOTIFICATION_TO;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !recipient || !from) throw new ConfigurationError("notification_email_not_configured");

  const organization = Array.isArray(request.organizations)
    ? request.organizations[0]?.business_name
    : request.organizations?.business_name;
  const context = asRecord(request.extracted_context);
  const emailBrief = asRecord(context.emailBrief);
  const developmentBrief = asRecord(context.developmentBrief);
  const clarificationAnswers = Array.isArray(context.clarificationAnswers)
    ? context.clarificationAnswers.map(asRecord).filter((item) => typeof item.question === "string" && typeof item.answer === "string")
    : [];
  const systemBlocks = Array.isArray(request.system_definition)
    ? request.system_definition.map(asRecord).filter((item) => typeof item.title === "string" && typeof item.detail === "string")
    : [];
  const implementationNotes = stringArray(emailBrief.implementationNotes);
  const assumptions = stringArray(emailBrief.assumptions);
  const requesterName = stringValue(request.requester?.full_name);
  const requesterEmail = stringValue(request.requester?.email);
  const requesterPhone = stringValue(request.requester?.phone);
  if (!requesterEmail) throw new ConfigurationError("requester_email_missing");
  const appUrl = safeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `build-request-${request.id}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `New Ajani build request: ${stringValue(emailBrief.subject) || request.title}`,
      html: renderBuildRequestEmail({
        title: request.title,
        organization: organization || "New client workspace",
        createdAt: request.created_at,
        requestId: request.id,
        requesterName: requesterName || requesterEmail,
        requesterEmail,
        requesterPhone,
        adminUrl: `${appUrl}/admin`,
        overview: stringValue(emailBrief.overview) || stringValue(developmentBrief.desiredOutcome) || "A new automation route is ready for implementation review.",
        problem: stringValue(developmentBrief.workThatSlips),
        moment: stringValue(developmentBrief.momentItHappens),
        protection: stringValue(developmentBrief.protection),
        implementationNotes: implementationNotes.length > 0
          ? implementationNotes
          : systemBlocks.map((block) => `${stringValue(block.title)}: ${stringValue(block.detail)}`),
        decisions: clarificationAnswers.map((item) => `${stringValue(item.question)}: ${stringValue(item.answer)}`),
        assumptions,
      }),
    }),
  });

  const payload = await readProviderPayload(response);
  if (!response.ok) throw new ProviderError(response.status, payload.error ?? `resend_http_${response.status}`);
  if (!payload.id) throw new ProviderError(502, "resend_missing_message_id");
  return payload.id;
}

export function renderBuildRequestEmail(input: {
  title: string;
  organization: string;
  createdAt: string;
  requestId: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  adminUrl: string;
  overview: string;
  problem: string;
  moment: string;
  protection: string;
  implementationNotes: string[];
  decisions: string[];
  assumptions: string[];
}) {
  const section = (title: string, content: string) => content
    ? `<section style="padding:26px 30px;border-top:1px solid #e7dfd9"><p style="margin:0 0 10px;color:#790018;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(title)}</p>${content}</section>`
    : "";
  const list = (items: string[]) => items.length > 0
    ? `<ul style="margin:0;padding:0;list-style:none">${items.map((item, index) => `<li style="margin:${index === 0 ? "0" : "8px 0 0"};padding:12px 14px;border:1px solid #e7dfd9;border-radius:9px;background:#faf8f6;color:#403834;font-size:14px;line-height:1.5">${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  const receivedAt = new Date(input.createdAt).toLocaleString("en-US", { timeZone: "UTC" });
  const problemContent = [input.problem, input.moment]
    .filter(Boolean)
    .map((item) => `<p style="margin:0 0 9px;color:#403834;font-size:14px;line-height:1.55">${escapeHtml(item)}</p>`)
    .join("");
  const requesterContent = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7dfd9;border-radius:11px;background:#faf8f6"><tr><td colspan="2" style="padding:15px 16px 13px;color:#171515;font-size:16px;font-weight:700">${escapeHtml(input.requesterName)}</td></tr><tr><td style="padding:0 16px 15px;color:#756a64;font-size:10px;line-height:1.45">EMAIL<br><strong style="color:#171515;font-size:13px">${escapeHtml(input.requesterEmail)}</strong></td><td style="padding:0 16px 15px;color:#756a64;font-size:10px;line-height:1.45">PHONE<br><strong style="color:#171515;font-size:13px">${escapeHtml(input.requesterPhone || "Not provided in Clerk")}</strong></td></tr></table><p style="margin:9px 0 0;color:#756a64;font-size:11px;line-height:1.5">Contact details are attached from the authenticated Clerk account.</p>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head><body style="margin:0;padding:0;background:#f2efeb;color:#171515;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;color:transparent">A complete Ajani automation build brief is ready for review.</div><div style="padding:28px 14px"><main style="max-width:680px;margin:0 auto;overflow:hidden;border:1px solid #ddd4ce;border-radius:18px;background:#ffffff;box-shadow:0 14px 40px rgba(54,39,30,.08)"><header style="padding:17px 30px;border-bottom:1px solid #e7dfd9;background:#fbfaf8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="color:#171515;font-size:18px;font-weight:800;letter-spacing:-.04em">ajani<span style="color:#790018">.</span></td><td align="right"><span style="display:inline-block;padding:6px 9px;border-radius:999px;background:#f3e7e6;color:#790018;font-size:10px;font-weight:700;letter-spacing:.05em">BUILD REQUEST</span></td></tr></table></header><section style="padding:30px;background:#fff"><p style="margin:0;color:#790018;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">New automation development brief</p><h1 style="margin:11px 0 0;color:#171515;font-size:28px;line-height:1.1;letter-spacing:-.04em">${escapeHtml(input.title)}</h1><p style="margin:13px 0 0;color:#5f554f;font-size:16px;line-height:1.58">${escapeHtml(input.overview)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border:1px solid #e7dfd9;border-radius:11px;background:#faf8f6"><tr><td style="padding:13px 14px;border-right:1px solid #e7dfd9;color:#756a64;font-size:10px;line-height:1.45">WORKSPACE<br><strong style="color:#171515;font-size:12px">${escapeHtml(input.organization)}</strong></td><td style="padding:13px 14px;border-right:1px solid #e7dfd9;color:#756a64;font-size:10px;line-height:1.45">RECEIVED<br><strong style="color:#171515;font-size:12px">${escapeHtml(receivedAt)} UTC</strong></td><td style="padding:13px 14px;color:#756a64;font-size:10px;line-height:1.45">REQUEST<br><strong style="color:#171515;font-size:12px">${escapeHtml(input.requestId)}</strong></td></tr></table></section>${section("Requester contact", requesterContent)}${section("Workflow problem", problemContent)}${section("Proposed automation", list(input.implementationNotes))}${section("Confirmed decisions", list(input.decisions))}${section("Assumptions to verify", list(input.assumptions))}${section("Automation boundary", input.protection ? `<p style="margin:0;padding:15px 17px;border-left:3px solid #255c51;border-radius:0 9px 9px 0;background:#f1f7f4;color:#304b44;font-size:14px;line-height:1.55">${escapeHtml(input.protection)}</p>` : "")}<footer style="padding:27px 30px;border-top:1px solid #e7dfd9;background:#fbfaf8"><a href="${escapeHtml(input.adminUrl)}" style="display:inline-block;padding:13px 18px;border-radius:9px;background:#790018;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">Open full brief in Ajani admin</a><p style="margin:18px 0 0;color:#756a64;font-size:12px;line-height:1.5">The raw voice note is intentionally omitted. The approved problem, decisions, route, and implementation assumptions are included above.</p></footer></main></div></body></html>`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function safeAppUrl(value: string | undefined) {
  try {
    const url = new URL(value || "https://ajaniflow.com");
    if (url.protocol !== "https:" && url.hostname !== "localhost") return "https://ajaniflow.com";
    return url.origin;
  } catch {
    return "https://ajaniflow.com";
  }
}

function retryAt(attempt: number) {
  const minutes = Math.min(2 ** Math.max(attempt - 1, 0) * 5, 360);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isRetryable(error: unknown) {
  if (isTimeoutError(error)) return true;
  return error instanceof ProviderError ? error.status === 429 || error.status >= 500 : !(error instanceof ConfigurationError);
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_notification_error";
  return message.replace(/[\r\n]+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

async function readProviderPayload(response: Response): Promise<{ id?: string; error?: string }> {
  try {
    const payload = await response.json() as { id?: unknown; message?: unknown; name?: unknown };
    return {
      id: typeof payload.id === "string" ? payload.id : undefined,
      error: [payload.name, payload.message].filter((value): value is string => typeof value === "string").join(": ") || undefined,
    };
  } catch {
    return {};
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

class ProviderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

class ConfigurationError extends Error {}
