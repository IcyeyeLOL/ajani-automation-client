import "server-only";

import { z } from "zod";
import { METRIC_KEY_PATTERN } from "@/lib/admin/metric-query";
import { shiftDay, utcDay } from "@/lib/connectors/connector-store";

/**
 * Private intake for the owner's own automations (n8n, Make, a Reddit DM bot)
 * where a platform has no API for a number. Least privilege: platform metrics
 * the owner could type in (written as manual entries, so they show in recent
 * entries and can be deleted, and the store refuses metrics only a connector
 * writes), never sales, revenue, outreach batches or Dripify counts, only the
 * owner's main account (an account name could carry a prospect's handle), and
 * only recent days, so a leaked key cannot rewrite the business history.
 */
export const INGEST_ACTOR = "connector:ingest";
export const INGEST_SOURCES = ["youtube", "instagram", "reddit", "tiktok", "linkedin"] as const;
export const INGEST_MAX_BYTES = 64_000;
export const INGEST_MAX_DAYS_BACK = 35;
const MIN_KEY_LENGTH = 32;

/** The key, or null while ingest is switched off (unset or too short to be safe). */
export function ingestKey(source: Record<string, string | undefined> = process.env) {
  const key = source.AJANI_METRICS_INGEST_KEY?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

/** True when any object in the body has a prototype-shaped key, which strict schemas do not flag. */
function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 4) return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, depth + 1));
  return Object.keys(value).some((key) => key === "__proto__" || key === "constructor" || key === "prototype"
    || hasForbiddenKey((value as Record<string, unknown>)[key], depth + 1));
}

export function ingestSchema(today: string) {
  const earliest = shiftDay(today, -INGEST_MAX_DAYS_BACK);
  return z.preprocess((input) => (hasForbiddenKey(input) ? null : input), z.object({
    values: z.array(z.object({
      metricKey: z.string().regex(METRIC_KEY_PATTERN)
        .refine((key) => (INGEST_SOURCES as readonly string[]).includes(key.split(".")[0]), "Only platform metrics (YouTube, Instagram, Reddit, TikTok, LinkedIn) can be sent here"),
      date: z.iso.date().refine((date) => date >= earliest && date <= today, `Dates must be between ${earliest} and ${today} (UTC)`),
      value: z.number().finite().min(0).max(1e14),
    }).strict()).min(1).max(200)
      .refine((values) => new Set(values.map((item) => `${item.metricKey}|${item.date}`)).size === values.length, "Send each metric and date once"),
  }).strict());
}

/** JSON.parse that refuses prototype-shaped keys outright instead of relying on later stripping. */
export function parseIngestJson(text: string): unknown {
  return JSON.parse(text, (key, value) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw new SyntaxError("forbidden key");
    return value;
  });
}

/** Issue text safe to return: the path (field names we define, indexes) and a message that never quotes input. */
export function ingestIssues(issues: z.core.$ZodIssue[]) {
  return issues.slice(0, 5).map((issue) => {
    const where = issue.path.join(".");
    const message = issue.code === "unrecognized_keys" ? "only metricKey, date and value are allowed" : issue.message;
    return `${where || "body"}: ${message}`;
  });
}

export function parseIngestBody(body: unknown, now = Date.now()) {
  return ingestSchema(utcDay(now)).safeParse(body);
}
