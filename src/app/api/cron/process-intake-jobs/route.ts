import { processBuildRequestNotifications } from "@/lib/notifications/build-request";
import { purgeOperationalSecurityRecords } from "@/lib/operations/retention";
import { processVoiceTranscriptions } from "@/lib/transcription/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOTIFICATION_BATCH_SIZE = 4;
const TRANSCRIPTION_BATCH_SIZE = 1;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [notifications, transcriptions, retention] = await Promise.all([
      processBuildRequestNotifications({ limit: NOTIFICATION_BATCH_SIZE }),
      processVoiceTranscriptions({ limit: TRANSCRIPTION_BATCH_SIZE }),
      purgeOperationalSecurityRecords(),
    ]);
    return Response.json({ notifications, transcriptions, retention });
  } catch (error) {
    console.error("Intake background job sweep failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Background job sweep failed" }, { status: 503 });
  }
}
