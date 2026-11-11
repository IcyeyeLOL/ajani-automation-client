import "server-only";

import { escapeHtml, RESEND_TIMEOUT_MS, safeAppUrl } from "@/lib/notifications/build-request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BuildThreadMessage } from "@/lib/builds/conversation";

export type BuildMessageEmail = {
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  eyebrow: string;
  heading: string;
  /** Resend drops a second send with the same key, so a retried save cannot email twice. */
  idempotencyKey: string;
  intro: string;
  link: BuildThreadMessage["link"];
  subject: string;
  to: string;
};

export type BuildMessageEmailResult = "sent" | "failed";

/** Sends one conversation email. Never throws: the message is already saved, so a failed email is reported, not fatal. */
export async function sendBuildMessageEmail(email: BuildMessageEmail): Promise<BuildMessageEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from || !email.to) {
    console.error("Build message email not configured", { hasKey: Boolean(apiKey), hasFrom: Boolean(from), hasRecipient: Boolean(email.to) });
    return "failed";
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": email.idempotencyKey,
      },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: renderBuildMessageEmail(email) }),
    });
    if (response.ok) return "sent";
    console.error("Build message email refused", { status: response.status });
    return "failed";
  } catch (error) {
    console.error("Build message email failed", { message: error instanceof Error ? error.name : "unknown" });
    return "failed";
  }
}

/** Saves how the email went on the message. Never throws: a missed record only leaves it at "not_sent". */
export async function recordBuildMessageEmail(messageId: string, result: BuildMessageEmailResult) {
  try {
    const { error } = await createSupabaseAdminClient().from("build_messages").update({ email_status: result }).eq("id", messageId);
    if (error) throw error;
  } catch (error) {
    console.error("Build message email status not saved", { messageId, result, message: error instanceof Error ? error.message : "unknown" });
  }
}

export function appUrl() {
  return safeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
}

export function renderBuildMessageEmail(email: Omit<BuildMessageEmail, "idempotencyKey" | "subject" | "to">) {
  const paragraphs = email.body.split(/\n{2,}/).map((paragraph) => `<p style="margin:0 0 12px;color:#403834;font-size:15px;line-height:1.6">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
  const link = email.link
    ? `<p style="margin:16px 0 0"><a href="${escapeHtml(email.link.url)}" style="color:#790018;font-size:14px;font-weight:700">${escapeHtml(email.link.label)}</a></p>`
    : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(email.heading)}</title></head><body style="margin:0;padding:0;background:#f2efeb;color:#171515;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;color:transparent">${escapeHtml(email.intro)}</div><div style="padding:28px 14px"><main style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #ddd4ce;border-radius:18px;background:#ffffff"><header style="padding:17px 30px;border-bottom:1px solid #e7dfd9;background:#fbfaf8;color:#171515;font-size:18px;font-weight:800;letter-spacing:-.04em">ajani<span style="color:#790018">.</span></header><section style="padding:30px"><p style="margin:0;color:#790018;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(email.eyebrow)}</p><h1 style="margin:11px 0 0;color:#171515;font-size:26px;line-height:1.15;letter-spacing:-.03em">${escapeHtml(email.heading)}</h1><p style="margin:12px 0 0;color:#5f554f;font-size:15px;line-height:1.55">${escapeHtml(email.intro)}</p><div style="margin-top:22px;padding:18px 20px;border-left:3px solid #c9a27e;border-radius:0 10px 10px 0;background:#faf8f6">${paragraphs}${link}</div></section><footer style="padding:24px 30px;border-top:1px solid #e7dfd9;background:#fbfaf8"><a href="${escapeHtml(email.ctaUrl)}" style="display:inline-block;padding:13px 18px;border-radius:9px;background:#790018;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(email.ctaLabel)}</a></footer></main></div></body></html>`;
}
