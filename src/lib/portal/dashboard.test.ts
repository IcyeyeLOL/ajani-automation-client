import { describe, expect, it, vi } from "vitest";
import { loadPortalBuildDetail, shapePortalBuildDetail, shapePortalDashboard } from "@/lib/portal/dashboard";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, clerkClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));

describe("portal build detail lookup", () => {
  it("treats an id that is not a UUID as not found, without asking the database", async () => {
    for (const buildId of ["not-a-uuid", "123", "bfa16669-b62c-49e5-a356-9ac634a969b", "bfa16669-b62c-49e5-a356-9ac634a969bb'--"]) {
      await expect(loadPortalBuildDetail(buildId)).resolves.toEqual({ available: true, detail: null });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("still looks up a real UUID", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null, orgId: null });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await expect(loadPortalBuildDetail("bfa16669-b62c-49e5-a356-9ac634a969bb")).resolves.toEqual({ available: false, detail: null });
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });
});

describe("portal dashboard shaping", () => {
  it("uses reviewed quote data and tenant rows for the portal", () => {
    const data = shapePortalDashboard({
      organization: { business_name: "Northline Studio" },
      builds: [{
        id: "build-1",
        title: "After-hours lead handoff",
        status: "in_review",
        quoted_amount_cents: 100,
        updated_at: "2026-08-23T12:00:00.000Z",
      }],
      quotes: [{ build_request_id: "build-1", amount_cents: 380000 }],
      systems: [{
        name: "Lead handoff",
        status: "live",
        health: "healthy",
        last_success_at: "2026-08-23T12:00:00.000Z",
      }],
      subscriptions: [
        { amount_cents: 35000, status: "active", interval: "month" },
        { amount_cents: 10000, status: "active", interval: "year" },
      ],
    });

    expect(data.businessName).toBe("Northline Studio");
    expect(data.builds[0]).toMatchObject({ price: "$3,800", status: "in_review" });
    expect(data.systems[0]).toMatchObject({ health: "healthy", metric: "Running normally" });
    expect(data.monthlyRetainer).toBe("$350");
  });

  it("returns honest empty values instead of demo account data", () => {
    const data = shapePortalDashboard({ organization: null, builds: [], quotes: [], systems: [], subscriptions: [] });
    expect(data).toMatchObject({ businessName: "Your workspace", builds: [], systems: [], monthlyRetainer: "—" });
  });

  it("preserves five captured clarification decisions in a build receipt", () => {
    const detail = shapePortalBuildDetail({
      build: {
        id: "build-5",
        title: "Affiliate contract handoff",
        status: "in_review",
        transcript: "Generate the affiliate agreement without retyping the same fields.",
        extracted_context: {
          clarificationAnswers: Array.from({ length: 5 }, (_, index) => ({
            question: `Decision ${index + 1}?`,
            answer: `Confirmed answer ${index + 1}`,
          })),
          emailBrief: { overview: "Prepare a signature-ready contract." },
        },
        system_definition: [{ id: "step-1", kind: "trigger", title: "Affiliate added", detail: "Start the route." }],
        plain_language_scope: "Affiliate added: Start the route.",
        created_at: "2026-08-27T12:00:00.000Z",
        updated_at: "2026-08-27T12:00:00.000Z",
      },
      events: [{ id: "event-1", build_request_id: "build-5", event_type: "request_submitted", payload: { internal: "never render" }, created_at: "2026-08-27T12:00:00.000Z" }],
      questions: [],
      quotes: [],
      system: null,
      voiceMemos: [{ status: "ready", duration_seconds: 56 }],
    });

    expect(detail.questions).toHaveLength(5);
    expect(detail.questions[4]).toMatchObject({ question: "Decision 5?", answer: "Confirmed answer 5" });
    expect(detail.steps).toHaveLength(1);
    expect(detail.voiceMemo).toMatchObject({ status: "ready", duration: "56s" });
    expect(JSON.stringify(detail.events)).not.toContain("never render");
  });
});
