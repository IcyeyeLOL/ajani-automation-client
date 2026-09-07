import { processBuildRequestNotifications } from "@/lib/notifications/build-request";
import { purgeOperationalSecurityRecords } from "@/lib/operations/retention";
import { processVoiceTranscriptions } from "@/lib/transcription/worker";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withinDeadline } from "@/lib/operations/deadline";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOTIFICATION_BATCH_SIZE = 25;
const TRANSCRIPTION_BATCH_SIZE = 10;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deadlineAt = Date.now() + 50_000;
    const outcomes = await Promise.allSettled([
      processBuildRequestNotifications({ limit: NOTIFICATION_BATCH_SIZE, deadlineAt }),
      processVoiceTranscriptions({ limit: TRANSCRIPTION_BATCH_SIZE, deadlineAt }),
      purgeOperationalSecurityRecords(deadlineAt),
    ]);
    const [notifications, transcriptions, retention] = outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : { error: "sweep_failed" });
    const { data: queueHealth, error: healthError } = await withinDeadline(createSupabaseAdminClient().rpc("queue_recovery_health"), Math.min(deadlineAt + 3_000, Date.now() + 3_000));
    const failed = outcomes.some((outcome) => outcome.status === "rejected") || Boolean(healthError) || Date.now() >= deadlineAt;
    const result = { notifications, transcriptions, retention, queueHealth: healthError ? null : queueHealth };
    console.info("Intake recovery sweep", result);
    return Response.json(result, { status: failed ? 503 : 200 });
  } catch (error) {
    console.error("Intake background job sweep failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Background job sweep failed" }, { status: 503 });
  }
}
