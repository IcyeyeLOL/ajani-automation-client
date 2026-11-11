import { loadMetricCatalog } from "@/lib/admin/metrics";
import { extractReportValues, REPORT_MAX_BYTES, reportFileKind } from "@/lib/admin/report-import";
import { isSampleMode } from "@/lib/admin/sample-mode";
import { resolveAdminSession } from "@/lib/admin/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const ERRORS: Record<string, [string, number]> = {
  unsupported_file: ["Upload a PDF, a CSV or text file, or a PNG, JPEG or WebP screenshot.", 415],
  no_metrics: ["No numbers can be imported yet. Apply the latest database migration.", 409],
  ai_unavailable: ["The AI reader is unavailable right now, so this file wasn't read. Day-by-day spreadsheets still import without it; for this file, check the Anthropic key in the site settings or type the numbers in by hand.", 503],
};

/**
 * POST multipart: file (a report, export, screenshot or spreadsheet about any
 * platform, cold calls, sales or revenue). A spreadsheet is read column by
 * column, each row on its own platform; the AI agent is asked only about what
 * code can't place, and reads PDFs and screenshots. Returns the rows, the
 * questions for the owner and the per-platform breakdown for review. Saves
 * nothing: the owner saves the reviewed rows with saveReportValuesAction.
 * Lives under /admin so the path-scoped admin session cookie is sent.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const session = await resolveAdminSession();
  if (session.status === "forbidden") return json({ error: "Not found" }, 404);
  if (session.status !== "allowed") return json({ error: "Admin session required" }, 401);
  if (await isSampleMode()) return json({ error: "Sample data is on, so reports can't be imported. Switch to real data first." }, 409);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > REPORT_MAX_BYTES + 64_000) return json({ error: tooLarge() }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The upload could not be read. Try again." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Choose a report file first." }, 400);
  if (file.size > REPORT_MAX_BYTES) return json({ error: tooLarge() }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!reportFileKind(bytes)) return json({ error: ERRORS.unsupported_file[0] }, 415);

  const catalog = await loadMetricCatalog();
  if (catalog.status !== "available") return json({ error: "Trends are unavailable, so nothing can be imported right now." }, 503);

  const result = await extractReportValues({ bytes, fileName: file.name, metrics: catalog.metrics, today: catalog.today, startedAt });
  if (result.status !== "ok") {
    const [message, status] = ERRORS[result.code] ?? ERRORS.ai_unavailable;
    return json({ error: message }, status);
  }
  return json({
    today: catalog.today, method: result.method, agent: result.agent, note: result.note, reportDate: result.reportDate,
    rows: result.rows, questions: result.questions, groups: result.groups, notUsed: result.notUsed, dropped: result.dropped,
  }, 200);
}

function tooLarge() {
  return `That file is over ${Math.round(REPORT_MAX_BYTES / 1_000_000)} MB. Export a smaller file or upload a screenshot.`;
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
