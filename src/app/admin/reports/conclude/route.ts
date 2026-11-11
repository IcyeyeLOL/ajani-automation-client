import { z } from "zod";
import { concludeImport } from "@/lib/admin/report-import";
import { isSampleMode } from "@/lib/admin/sample-mode";
import { resolveAdminSession } from "@/lib/admin/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  facts: z.array(z.object({ id: z.string().regex(/^f\d{1,3}$/), text: z.string().min(1).max(160), value: z.string().min(1).max(60) }).strict()).min(3).max(80),
  warnings: z.array(z.string().min(1).max(240)).max(8),
}).strict();

/**
 * POST JSON { facts, warnings }: the AI agent's short conclusion about an
 * import, worded from facts the review worked out. Every number in it is filled
 * in by code from a fact id. Saves nothing. Lives under /admin so the
 * path-scoped admin session cookie is sent.
 */
export async function POST(request: Request) {
  const session = await resolveAdminSession();
  if (session.status === "forbidden") return json({ error: "Not found" }, 404);
  if (session.status !== "allowed") return json({ error: "Admin session required" }, 401);
  if (await isSampleMode()) return json({ error: "Sample data is on." }, 409);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "That request could not be read." }, 400);
  const result = await concludeImport(parsed.data);
  if (!result) return json({ error: "The AI agent is unavailable right now." }, 503);
  return json({ note: result.note, cautions: result.cautions }, 200);
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
