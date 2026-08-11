import { auth } from "@clerk/nextjs/server";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { createClerkServerClient } from "@/lib/supabase/server";
import { buildRequestSchema } from "@/lib/validation/build-request";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const payload = buildRequestSchema.safeParse(body);
  if (!payload.success) {
    return Response.json({ error: "Invalid build request", details: payload.error.flatten() }, { status: 400 });
  }

  if (!hasClerkCredentials()) {
    return Response.json({ error: "Clerk is not configured" }, { status: 503 });
  }

  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const supabase = await createClerkServerClient();

  const { data, error } = await supabase
    .from("build_requests")
    .insert({
      organization_id: payload.data.organizationId,
      created_by: userId,
      title: payload.data.title,
      status: "quoted",
      transcript: payload.data.transcript,
      extracted_context: payload.data.extractedContext,
      system_definition: payload.data.systemBlocks,
      quoted_amount_cents: payload.data.quotedAmountCents ?? null,
    })
    .select("id, status, created_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 422 });
  return Response.json({ buildRequest: data }, { status: 201 });
}
