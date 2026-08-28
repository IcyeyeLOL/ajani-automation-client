import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  processBuildRequestNotifications,
  renderBuildRequestEmail,
  RESEND_TIMEOUT_MS,
} from "@/lib/notifications/build-request";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("build request email", () => {
  it("contains the approved implementation brief without the raw voice note", () => {
    const html = renderBuildRequestEmail({
      title: "Website lead → sales handoff",
      organization: "Northstar Services",
      createdAt: "2026-08-27T12:00:00.000Z",
      requestId: "request-123",
      requesterName: "Aja Ni",
      requesterEmail: "client@example.com",
      requesterPhone: "+15555550123",
      adminUrl: "https://ajani.test/admin",
      overview: "Reply to qualified website leads after hours and preserve ownership context.",
      problem: "Qualified leads wait until the next morning.",
      moment: "After the website form arrives and before sales opens the inbox.",
      protection: "Pricing decisions always reach a sales manager.",
      implementationNotes: ["Capture the website form", "Escalate pricing questions"],
      decisions: ["Exception owner: Sales manager"],
      assumptions: ["CRM access still needs confirmation"],
    });

    expect(html).toContain("New automation development brief");
    expect(html).toContain("Requester contact");
    expect(html).toContain("client@example.com");
    expect(html).toContain("+15555550123");
    expect(html).toContain("Qualified leads wait until the next morning.");
    expect(html).toContain("Capture the website form");
    expect(html).toContain("Exception owner: Sales manager");
    expect(html).toContain("CRM access still needs confirmation");
    expect(html).toContain("raw voice note is intentionally omitted");
  });

  it("escapes model-generated and customer-controlled email content", () => {
    const html = renderBuildRequestEmail({
      title: "<script>alert(1)</script>",
      organization: "A & B",
      createdAt: "2026-08-27T12:00:00.000Z",
      requestId: "request-123",
      requesterName: "<img src=x onerror=alert(1)>",
      requesterEmail: "client+test@example.com",
      requesterPhone: "",
      adminUrl: "https://ajani.test/admin",
      overview: "<img src=x onerror=alert(1)>",
      problem: "",
      moment: "",
      protection: "",
      implementationNotes: [],
      decisions: [],
      assumptions: [],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("Not provided in Clerk");
  });

  it("bounds Resend delivery and marks a timeout for retry", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-test-key");
    vi.stubEnv("INTERNAL_NOTIFICATION_TO", "ops@ajani.test");
    vi.stubEnv("RESEND_FROM", "Ajani <requests@ajani.test>");
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("Resend timed out"), {
      name: "TimeoutError",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { admin, updateJob } = notificationAdmin();

    const result = await processBuildRequestNotifications({
      buildRequestId: "request-123",
      limit: 1,
      admin,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(RESEND_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ signal: timeoutSignal }),
    );
    expect(updateJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "retryable_failed",
      next_attempt_at: expect.any(String),
      last_error: "Resend timed out",
    }));
    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      retryableFailures: 1,
      terminalFailures: 0,
    });
  });
});

function notificationAdmin() {
  const updateJob = vi.fn();
  const stateStatusEq = vi.fn().mockResolvedValue({ error: null });
  const stateRequestEq = vi.fn(() => ({ eq: stateStatusEq }));
  const request = {
    id: "request-123",
    created_by: "user-123",
    title: "Route qualified leads",
    status: "submitted",
    created_at: "2026-08-27T12:00:00.000Z",
    extracted_context: {},
    system_definition: [],
    plain_language_scope: "Route qualified leads to the right owner.",
    organizations: { business_name: "Northstar Services" },
  };
  const admin = {
    rpc: vi.fn().mockResolvedValue({
      data: [{ build_request_id: request.id, attempt_count: 1 }],
      error: null,
    }),
    from: vi.fn((table: string) => {
      if (table === "build_requests") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: request, error: null }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { full_name: "Aja Ni", email: "client@example.com", phone: null },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "build_request_notification_jobs") {
        return {
          update: (value: unknown) => {
            updateJob(value);
            return { eq: stateRequestEq };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    admin: admin as never,
    updateJob,
  };
}
