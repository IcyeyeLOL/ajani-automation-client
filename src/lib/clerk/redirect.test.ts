import { describe, expect, it } from "vitest";
import { authPageUrl, DEFAULT_AUTH_REDIRECT, resolveAuthRedirect } from "@/lib/clerk/redirect";

describe("authentication redirects", () => {
  it("preserves only explicitly allowed application destinations", () => {
    expect(resolveAuthRedirect("/record")).toBe("/record");
    expect(resolveAuthRedirect("/admin/login")).toBe("/admin/login");
    expect(resolveAuthRedirect("https://attacker.example/record")).toBe(DEFAULT_AUTH_REDIRECT);
    expect(resolveAuthRedirect("//attacker.example/record")).toBe(DEFAULT_AUTH_REDIRECT);
    expect(resolveAuthRedirect("/record?next=https://attacker.example")).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("keeps the destination while moving between sign-in and sign-up", () => {
    expect(authPageUrl("/sign-up", "/record")).toBe("/sign-up?redirect_url=%2Frecord");
    expect(authPageUrl("/sign-in", "/portal")).toBe("/sign-in");
  });
});
