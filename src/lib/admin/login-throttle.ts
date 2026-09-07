import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

/** Reserve attempts atomically before key comparison; DB errors deny the attempt. */
export async function consumeAdminLoginAllowance(
  admin: Pick<ReturnType<typeof createSupabaseAdminClient>, "rpc">,
  fingerprints: string[],
) {
  try {
    const deadlineAt = Date.now() + 8_000;
    const results = await Promise.all(fingerprints.map((fingerprint) => withinDeadline(admin.rpc("consume_public_request_allowance", {
      p_fingerprint: fingerprint,
      p_limit: 5,
      p_window_seconds: 900,
    }), deadlineAt)));
    return results.every(({ data, error }) => !error && data === true);
  } catch {
    return false;
  }
}
