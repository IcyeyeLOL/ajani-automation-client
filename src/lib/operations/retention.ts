import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

export async function purgeOperationalSecurityRecords(deadlineAt = Date.now() + 15_000) {
  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const [rateLimits, loginAttempts, webhookEvents] = await withinDeadline(Promise.all([
    admin.from("public_request_rate_limits").delete().lt("updated_at", new Date(now - 7 * 86_400_000).toISOString()),
    admin.from("admin_login_attempts").delete().lt("last_attempt_at", new Date(now - 30 * 86_400_000).toISOString()),
    admin.from("clerk_webhook_events").delete()
      .not("processed_at", "is", null)
      .lt("received_at", new Date(now - 90 * 86_400_000).toISOString()),
  ]), deadlineAt);

  const error = rateLimits.error || loginAttempts.error || webhookEvents.error;
  if (error) throw new Error(`operational_retention_failed:${error.message}`);
  return { purged: true };
}
