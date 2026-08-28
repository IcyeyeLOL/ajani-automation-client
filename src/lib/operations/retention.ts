import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function purgeOperationalSecurityRecords() {
  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const [rateLimits, loginAttempts, webhookEvents] = await Promise.all([
    admin.from("public_request_rate_limits").delete().lt("updated_at", new Date(now - 7 * 86_400_000).toISOString()),
    admin.from("admin_login_attempts").delete().lt("last_attempt_at", new Date(now - 30 * 86_400_000).toISOString()),
    admin.from("clerk_webhook_events").delete()
      .not("processed_at", "is", null)
      .lt("received_at", new Date(now - 90 * 86_400_000).toISOString()),
  ]);

  const error = rateLimits.error || loginAttempts.error || webhookEvents.error;
  if (error) throw new Error(`operational_retention_failed:${error.message}`);
  return { purged: true };
}
