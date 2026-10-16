import "server-only";

import { z } from "zod";
import { METRIC_DIMENSION_PATTERN, METRIC_KEY_PATTERN } from "@/lib/admin/metric-query";
import { shiftDay, utcDay } from "@/lib/connectors/connector-store";

/**
 * Private intake for the owner's own automations (n8n, Make, a Reddit DM bot)
 * where a platform has no API for a number. Least privilege: platform metrics
 * only, never sales, revenue, outreach batches or connector-owned Dripify
 * counts, and only recent days, so a leaked key cannot rewrite the business
 * history.
 */
export const INGEST_ACTOR = "connector:ingest";
export const INGEST_SOURCES = ["youtube", "instagram", "reddit", "tiktok", "linkedin"] as const;
export const INGEST_MAX_BYTES = 64_000;
export const INGEST_MAX_DAYS_BACK = 120;
const MIN_KEY_LENGTH = 32;

/** The key, or null while ingest is switched off (unset or too short to be safe). */
export function ingestKey(source: Record<string, string | undefined> = process.env) {
  const key = source.AJANI_METRICS_INGEST_KEY?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

export function ingestSchema(today: string) {
  const earliest = shiftDay(today, -INGEST_MAX_DAYS_BACK);
  return z.object({
    values: z.array(z.object({
      metricKey: z.string().regex(METRIC_KEY_PATTERN)
        .refine((key) => (INGEST_SOURCES as readonly string[]).includes(key.split(".")[0]), "Only platform metrics (YouTube, Instagram, Reddit, TikTok, LinkedIn) can be sent here"),
      date: z.iso.date().refine((date) => date >= earliest && date <= today, `Dates must be between ${earliest} and ${today} (UTC)`),
      dimension: z.string().trim().toLowerCase().max(80)
        .refine((value) => value === "" || METRIC_DIMENSION_PATTERN.test(value), "Account names may use letters, numbers, @ . _ : / and -")
        .optional(),
      value: z.number().finite().min(0).max(1e14),
    }).strict()).min(1).max(200),
  }).strict();
}

export function parseIngestBody(body: unknown, now = Date.now()) {
  return ingestSchema(utcDay(now)).safeParse(body);
}
