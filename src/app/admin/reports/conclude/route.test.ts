import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), sample: vi.fn(), conclude: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/session", () => ({ resolveAdminSession: mocks.session }));
vi.mock("@/lib/admin/sample-mode", () => ({ isSampleMode: mocks.sample }));
vi.mock("@/lib/admin/report-import", () => ({ concludeImport: mocks.conclude }));

import { POST } from "@/app/admin/reports/conclude/route";

const facts = [
  { id: "f1", text: "Instagram views, Sep 18 – Oct 2", value: "2,086" },
  { id: "f2", text: "Instagram views, Oct 3 – Oct 17", value: "7,243" },
  { id: "f3", text: "Instagram views, second half against the first", value: "3.5×" },
];
const request = (body: unknown) => new Request("https://ajani.test/admin/reports/conclude", { method: "POST", body: JSON.stringify(body) });

describe("the AI agent's take on an import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ status: "allowed", userId: "user_admin" });
    mocks.sample.mockResolvedValue(false);
    mocks.conclude.mockResolvedValue({ note: "Views went from 2,086 to 7,243 (3.5×).", cautions: [], provider: "anthropic", model: "claude-opus-5-5" });
  });

  it("needs an admin session and real data", async () => {
    mocks.session.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await POST(request({ facts, warnings: [] }))).status).toBe(401);
    mocks.sample.mockResolvedValueOnce(true);
    expect((await POST(request({ facts, warnings: [] }))).status).toBe(409);
    expect(mocks.conclude).not.toHaveBeenCalled();
  });

  it("takes only well-formed facts", async () => {
    for (const body of [{ facts: facts.slice(0, 2), warnings: [] }, { facts: [{ ...facts[0], id: "x1" }, ...facts.slice(1)], warnings: [] }, { facts, warnings: [], extra: true }, { facts: facts.map((fact) => ({ ...fact, value: "9".repeat(61) })), warnings: [] }]) {
      expect((await POST(request(body))).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(mocks.conclude).not.toHaveBeenCalled();
  });

  it("returns the note with its numbers filled in by code, and says when the agent is away", async () => {
    const response = await POST(request({ facts, warnings: ["Instagram's rows leave followers blank."] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ note: "Views went from 2,086 to 7,243 (3.5×).", cautions: [] });
    expect(mocks.conclude).toHaveBeenCalledWith({ facts, warnings: ["Instagram's rows leave followers blank."] });
    mocks.conclude.mockResolvedValueOnce(null);
    expect((await POST(request({ facts, warnings: [] }))).status).toBe(503);
  });
});
