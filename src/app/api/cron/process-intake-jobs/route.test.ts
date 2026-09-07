import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  notifications: vi.fn(),
  transcriptions: vi.fn(),
  retention: vi.fn(),
  health: vi.fn(),
}));

vi.mock("@/lib/notifications/build-request", () => ({ processBuildRequestNotifications: mocks.notifications }));
vi.mock("@/lib/transcription/worker", () => ({ processVoiceTranscriptions: mocks.transcriptions }));
vi.mock("@/lib/operations/retention", () => ({ purgeOperationalSecurityRecords: mocks.retention }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.health }) }));

import { GET } from "@/app/api/cron/process-intake-jobs/route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("intake worker cron", () => {
  it("requires the cron bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const response = await GET(new Request("https://ajani.test/api/cron/process-intake-jobs"));
    expect(response.status).toBe(401);
    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(mocks.transcriptions).not.toHaveBeenCalled();
    expect(mocks.retention).not.toHaveBeenCalled();
  });

  it("sweeps both durable queues", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    mocks.notifications.mockResolvedValue({ claimed: 1, sent: 1, retryableFailures: 0, terminalFailures: 0 });
    mocks.transcriptions.mockResolvedValue({ claimed: 1, succeeded: 1, retryableFailures: 0, terminalFailures: 0 });
    mocks.retention.mockResolvedValue({ purged: true });
    mocks.health.mockResolvedValue({ data: { transcription: { ready: 0 } }, error: null });

    const response = await GET(new Request("https://ajani.test/api/cron/process-intake-jobs", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      notifications: { sent: 1 },
      transcriptions: { succeeded: 1 },
      retention: { purged: true },
    });
    expect(mocks.notifications).toHaveBeenCalledWith({ limit: 25, deadlineAt: expect.any(Number) });
    expect(mocks.transcriptions).toHaveBeenCalledWith({ limit: 10, deadlineAt: expect.any(Number) });
  });
});
