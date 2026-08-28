import { recentRequestSaveDiagnostics } from "@/lib/operations/request-save-diagnostics";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const accessKey = process.env.AJANI_ADMIN_ACCESS_KEY;
  if (!accessKey || request.headers.get("x-test-key") !== accessKey) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ events: recentRequestSaveDiagnostics() });
}
