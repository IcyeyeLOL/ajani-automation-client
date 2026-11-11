import { afterEach, describe, expect, it } from "vitest";
import { coldCallAnswersProblem, entryDayLabel, localDay } from "@/lib/admin/metric-query";

describe("entry dates", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("defaults to the browser's calendar day, not the UTC one", () => {
    process.env.TZ = "America/New_York";
    // 10pm on Oct 18 in New York is 2am on Oct 19 in UTC.
    const evening = new Date("2026-10-19T02:00:00Z");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(localDay(evening)).toBe("2026-10-18");
    expect(localDay(new Date(2026, 0, 5, 9))).toBe("2026-01-05");
  });

  it("shows the year only outside the current one, so a mistyped year is visible", () => {
    expect(entryDayLabel("2026-10-18", "2026-10-19")).toBe("Oct 18");
    expect(entryDayLabel("2025-10-18", "2026-10-19")).toBe("Oct 18, 2025");
    expect(entryDayLabel("2027-01-02", "2026-10-19")).toBe("Jan 2, 2027");
  });
});

describe("cold call answers", () => {
  const day = (values: Record<string, number>) => new Map(Object.entries(values));

  it("can't outnumber the calls made", () => {
    expect(coldCallAnswersProblem(day({ "cold_calls.dials": 5, "cold_calls.positive_replies": 8, "cold_calls.negative_replies": 9 }), "2026-10-18", "2026-10-19"))
      .toBe("Answers (17) can't be more than calls made (5) for Oct 18.");
    expect(coldCallAnswersProblem(day({ "cold_calls.dials": 1200, "cold_calls.neutral_replies": 1201 }), "2025-12-31", "2026-10-19"))
      .toBe("Answers (1,201) can't be more than calls made (1,200) for Dec 31, 2025.");
  });

  it("fits when every call was answered, and is unknown without calls made", () => {
    expect(coldCallAnswersProblem(day({ "cold_calls.dials": 17, "cold_calls.positive_replies": 8, "cold_calls.negative_replies": 9 }), "2026-10-18", "2026-10-19")).toBeNull();
    expect(coldCallAnswersProblem(day({ "cold_calls.positive_replies": 8 }), "2026-10-18", "2026-10-19")).toBeNull();
    // Follow-ups and meetings are already counted in an answer.
    expect(coldCallAnswersProblem(day({ "cold_calls.dials": 2, "cold_calls.positive_replies": 2, "cold_calls.follow_ups": 2, "cold_calls.meetings_booked": 1 }), "2026-10-18", "2026-10-19")).toBeNull();
  });
});
