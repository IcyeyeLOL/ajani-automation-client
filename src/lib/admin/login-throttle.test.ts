import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { consumeAdminLoginAllowance } from "./login-throttle";

describe("atomic admin attempt budgets", () => {
  it("requires both stable user and IP allowances", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await consumeAdminLoginAllowance({ rpc } as never, ["actor-bucket", "ip-bucket"])).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("consume_public_request_allowance", { p_fingerprint: "actor-bucket", p_limit: 5, p_window_seconds: 900 });
  });
  it("fails closed for resolved database errors and thrown network errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect(await consumeAdminLoginAllowance({ rpc } as never, ["actor"])).toBe(false);
    rpc.mockRejectedValue(new Error("connection unavailable"));
    expect(await consumeAdminLoginAllowance({ rpc } as never, ["actor"])).toBe(false);
  });
});
