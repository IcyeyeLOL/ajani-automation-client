import { describe, expect, it } from "vitest";
import { authPageUrl, DEFAULT_AUTH_REDIRECT, resolveAuthRedirect } from "@/lib/clerk/redirect";

describe("authentication redirects", () => {
  it("keeps the exact top-level destinations", () => {
    expect(resolveAuthRedirect("/record")).toBe("/record");
    expect(resolveAuthRedirect("/admin")).toBe("/admin");
    expect(resolveAuthRedirect("/admin/login")).toBe("/admin/login");
    expect(resolveAuthRedirect("/portal")).toBe("/portal");
    expect(resolveAuthRedirect(["/record", "/admin"])).toBe("/record");
    expect(resolveAuthRedirect(undefined)).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("keeps deep links inside the workspace, with their query", () => {
    expect(resolveAuthRedirect("/portal/builds/bfa16669-b62c-49e5-a356-9ac634a969bb")).toBe("/portal/builds/bfa16669-b62c-49e5-a356-9ac634a969bb");
    expect(resolveAuthRedirect("/portal/systems")).toBe("/portal/systems");
    expect(resolveAuthRedirect("/portal/billing")).toBe("/portal/billing");
    expect(resolveAuthRedirect("/portal?handoff=pending")).toBe("/portal?handoff=pending");
    expect(resolveAuthRedirect("/portal/builds?view=active#top")).toBe("/portal/builds?view=active");
  });

  it("accepts the full ajaniflow.com addresses Clerk sends and returns only the path", () => {
    expect(resolveAuthRedirect("https://ajaniflow.com/portal/builds/abc")).toBe("/portal/builds/abc");
    expect(resolveAuthRedirect("https://www.ajaniflow.com/portal/systems?tab=1")).toBe("/portal/systems?tab=1");
    expect(resolveAuthRedirect("HTTPS://AJANIFLOW.COM/record")).toBe("/record");
  });

  it("falls back to the workspace for other sites and redirect tricks", () => {
    for (const attempt of [
      "https://attacker.example/record",
      "https://ajaniflow.com.attacker.example/portal",
      "https://attacker.example/?https://ajaniflow.com/portal",
      "//attacker.example/portal",
      "///attacker.example/portal",
      "/\\attacker.example/portal",
      "\\\\attacker.example/portal",
      "https:/\\attacker.example/portal",
      "https://attacker.example\\@ajaniflow.com/portal",
      "/\t/attacker.example/portal",
      "/\n/attacker.example/portal",
      " /portal",
      "javascript:alert(1)//ajaniflow.com/portal",
      "data:text/html,<script>alert(1)</script>",
      "ftp://ajaniflow.com/portal",
      "portal",
      "/%2F%2Fattacker.example/portal",
      "/portal/../sign-in",
      "/portal/%2e%2e/%2e%2e/attacker",
      "/PORTAL",
      "/portalx",
      "/record/anything",
      "/admin/users",
      "/sign-in",
      "",
    ]) {
      expect(resolveAuthRedirect(attempt), attempt).toBe(DEFAULT_AUTH_REDIRECT);
    }
  });

  it("only ever returns a path on this site", () => {
    for (const attempt of ["/portal//attacker.example", "/portal/%2F%2Fattacker.example", "https://ajaniflow.com//portal"]) {
      const resolved = resolveAuthRedirect(attempt);
      expect(resolved.startsWith("/portal")).toBe(true);
      expect(new URL(resolved, "https://ajaniflow.com").origin).toBe("https://ajaniflow.com");
    }
    expect(resolveAuthRedirect("/portal/%2e%2e/admin")).toBe("/admin");
  });

  it("keeps the destination while moving between sign-in and sign-up", () => {
    expect(authPageUrl("/sign-up", "/record")).toBe("/sign-up?redirect_url=%2Frecord");
    expect(authPageUrl("/sign-in", "/portal")).toBe("/sign-in");
    expect(authPageUrl("/sign-in", "https://ajaniflow.com/portal/builds/abc")).toBe("/sign-in?redirect_url=%2Fportal%2Fbuilds%2Fabc");
    expect(authPageUrl("/sign-in", "https://attacker.example/portal")).toBe("/sign-in");
  });
});
