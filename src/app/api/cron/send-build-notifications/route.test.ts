import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const processBuildRequestNotifications = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/build-request", () => ({ processBuildRequestNotifications }));

import { GET } from "@/app/api/cron/send-build-notifications/route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("build request notification cron", () => {
  it("rejects requests without the cron bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const response = await GET(new Request("https://ajani.test/api/cron/send-build-notifications"));
    expect(response.status).toBe(401);
    expect(processBuildRequestNotifications).not.toHaveBeenCalled();
  });

  it("processes a bounded notification batch", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    processBuildRequestNotifications.mockResolvedValue({
      claimed: 2,
      sent: 2,
      retryableFailures: 0,
      terminalFailures: 0,
    });

    const response = await GET(new Request("https://ajani.test/api/cron/send-build-notifications", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ claimed: 2, sent: 2 });
    expect(processBuildRequestNotifications).toHaveBeenCalledWith({ limit: 25 });
  });
});
