import { processBuildRequestNotifications } from "@/lib/notifications/build-request";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processBuildRequestNotifications({ limit: 25, deadlineAt: Date.now() + 50_000 });
    return Response.json(result);
  } catch (error) {
    console.error("Build request notification sweep failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Notification sweep failed" }, { status: 503 });
  }
}
