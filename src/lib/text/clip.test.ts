import { describe, expect, it } from "vitest";
import { clipText } from "./clip";

describe("clipText", () => {
  it("cuts to the limit", () => {
    expect(clipText("abcdef", 4)).toBe("abcd");
    expect(clipText("abc", 4)).toBe("abc");
  });

  it("drops half an emoji at the cut, and keeps a whole one", () => {
    // "😀" is two UTF-16 units: the cut at 4 would keep only its first half.
    expect(clipText("abc😀def", 4)).toBe("abc");
    expect(clipText("abc😀def", 5)).toBe("abc😀");
    expect(clipText("😀😀", 2)).toBe("😀");
  });
});
