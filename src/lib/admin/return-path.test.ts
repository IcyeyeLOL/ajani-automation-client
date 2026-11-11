import { describe, expect, it } from "vitest";
import { adminBuildLink, adminReturnPath } from "@/lib/admin/return-path";

const buildId = "21000000-0000-4000-8000-000000000001";

describe("where the desk returns after unlocking", () => {
  it("allows the client builds list and one build", () => {
    expect(adminReturnPath("/admin/builds")).toBe("/admin/builds");
    expect(adminReturnPath(`/admin/builds/${buildId}`)).toBe(`/admin/builds/${buildId}`);
    expect(adminReturnPath([`/admin/builds/${buildId}`, "/elsewhere"])).toBe(`/admin/builds/${buildId}`);
  });

  it.each([
    "https://evil.example/admin/builds",
    "//evil.example/admin/builds",
    "/admin",
    "/admin/builds/../reports/read",
    `/admin/builds/${buildId}/extra`,
    `/admin/builds/${buildId}?x=1`,
    "/admin/builds/not-a-build",
    "",
  ])("refuses %s", (value) => expect(adminReturnPath(value)).toBeNull());

  it("refuses anything that is not a string", () => {
    expect(adminReturnPath(undefined)).toBeNull();
    expect(adminReturnPath(null)).toBeNull();
  });

  it("links an email to one build through the unlock page", () => {
    const link = adminBuildLink("https://ajaniflow.com", buildId);
    expect(link).toBe(`https://ajaniflow.com/admin/login?next=%2Fadmin%2Fbuilds%2F${buildId}`);
    expect(adminReturnPath(new URL(link).searchParams.get("next"))).toBe(`/admin/builds/${buildId}`);
  });
});
