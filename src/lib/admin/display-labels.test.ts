import { describe, expect, it } from "vitest";
import { optionLabel, plural } from "@/lib/admin/display-labels";

describe("display labels", () => {
  it("names stored options the way the owner writes them", () => {
    expect(optionLabel("linkedin")).toBe("LinkedIn");
    expect(optionLabel("Linkedin")).toBe("LinkedIn");
    expect(optionLabel("initial_dm")).toBe("Initial DM");
    expect(optionLabel("Follow Up 1")).toBe("Follow-up 1");
    expect(optionLabel("acceptance_rate")).toBe("Connection acceptance");
  });

  it("leaves free text alone", () => {
    expect(optionLabel("Med spa founders")).toBeUndefined();
  });

  it("uses the singular for exactly one", () => {
    expect(plural(1, "reply", "replies")).toBe("1 reply");
    expect(plural(0, "reply", "replies")).toBe("0 replies");
    expect(plural(1200, "call", "calls")).toBe("1,200 calls");
  });
});
