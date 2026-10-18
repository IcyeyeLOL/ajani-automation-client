import { describe, expect, it } from "vitest";
import { parseTable, readDailyTable } from "@/lib/admin/report-table";
import { SAMPLE_DEFINITIONS } from "@/lib/admin/sample-data";

// The real catalog's hand-logged numbers, so header matching is tested against real keys and labels.
const metrics = SAMPLE_DEFINITIONS.filter((metric) => metric.entryMode === "manual" && metric.unit !== "ratio");
const read = (text: string, fileName = "numbers.csv") => readDailyTable(text, fileName, metrics);
const pairs = (text: string, fileName?: string) => read(text, fileName)!.values.map((value) => [value.metricKey, value.date, value.value]);

describe("reading spreadsheets without AI", () => {
  it("explains that Muse's totals file has nothing for a daily chart", () => {
    // The owner's real upload, 2026-10-17.
    const totals = `Totals,,
window,followers,reach,views,interactions,likes,comments,shares,saves,profile_visits,link_taps,contact_taps,posts_published
Last 7 days (2026-10-10 to 2026-10-16),,2202,3649,180,103,8,27,6,102,4,0,2
Last 30 days (2026-09-17 to 2026-10-16),,5325,9244,535,262,14,108,13,441,19,0,15
Last 90 days (2026-07-19 to 2026-10-16),,5504,9977,648,296,15,145,14,708,32,0,18
`;
    const result = read(totals, "instagram-totals.csv")!;
    expect(result.values).toEqual([]);
    expect(result.notUsed.map((note) => note.item)).toEqual([
      "Totals for Last 7 days (2026-10-10 to 2026-10-16)", "Totals for Last 30 days (2026-09-17 to 2026-10-16)", "Totals for Last 90 days (2026-07-19 to 2026-10-16)",
    ]);
    expect(result.note).toMatch(/only has totals for whole periods.*Ask Muse for the daily table/);
  });

  it("reads the daily table the Muse prompt asks for, column by column", () => {
    const daily = `Instagram daily numbers for @ajani_automation
date,followers,reach,views,interactions,likes,comments,shares,saves,profile_visits,link_taps,contact_taps,posts_published
2026-10-08,70,"2,219",3100,140,120,9,6,1,60,3,1,2
2026-10-09,71,1560,,90,70,3,4,0,41,2,,0

Totals
window,reach
Last 7 days,2202
`;
    expect(pairs(daily, "export.csv")).toEqual([
      ["instagram.followers", "2026-10-08", 70], ["instagram.reach", "2026-10-08", 2219], ["instagram.views", "2026-10-08", 3100],
      ["instagram.interactions", "2026-10-08", 140], ["instagram.likes", "2026-10-08", 120], ["instagram.comments", "2026-10-08", 9],
      ["instagram.shares", "2026-10-08", 6], ["instagram.saves", "2026-10-08", 1], ["instagram.profile_visits", "2026-10-08", 60],
      // Link taps include the contact buttons: 3 + 1.
      ["instagram.profile_link_taps", "2026-10-08", 4], ["instagram.posts_published", "2026-10-08", 2],
      // Oct 9: views is blank (unknown) and the contact cell is blank, so link taps stay unknown too.
      ["instagram.followers", "2026-10-09", 71], ["instagram.reach", "2026-10-09", 1560], ["instagram.interactions", "2026-10-09", 90],
      ["instagram.likes", "2026-10-09", 70], ["instagram.comments", "2026-10-09", 3], ["instagram.shares", "2026-10-09", 4],
      ["instagram.saves", "2026-10-09", 0], ["instagram.profile_visits", "2026-10-09", 41], ["instagram.posts_published", "2026-10-09", 0],
    ]);
    const result = read(daily, "export.csv")!;
    expect(result.unresolved).toEqual([]);
    expect(result.note).toBe("Read 20 numbers across 2 days straight from the spreadsheet, column by column. The totals table was left out.");
    expect(result.values[3].evidence).toBe("Row 2026-10-08, column \"interactions\"");
  });

  it("takes the platform from the file name, and keeps prefixed and sales columns exact", () => {
    expect(pairs("date,followers,views\n2026-10-08,512,9000\n", "tiktok-daily.csv")).toEqual([
      ["tiktok.followers", "2026-10-08", 512], ["tiktok.views", "2026-10-08", 9000],
    ]);
    expect(pairs("Date,Instagram followers,LinkedIn followers,Clients signed,Cash collected\n2026-10-14,73,1200,1,\"$1,250.50\"\n")).toEqual([
      ["instagram.followers", "2026-10-14", 73], ["linkedin.followers", "2026-10-14", 1200], ["sales.deals_won", "2026-10-14", 1], ["revenue.cash_collected", "2026-10-14", 1250.5],
    ]);
  });

  it("never guesses a platform, and never takes YouTube's daily subscriber change as the total", () => {
    const unclear = read("date,followers\n2026-10-08,70\n")!;
    expect(unclear.values).toEqual([]);
    expect(unclear.unresolved).toEqual(["followers"]);
    expect(unclear.note).toMatch(/put the platform in the file name/);

    const studio = read("Date,Views,Watch time (hours),Subscribers\n2026-10-08,320,4.5,3\n", "youtube-channel.csv")!;
    expect(studio.values.map((value) => [value.metricKey, value.value])).toEqual([["youtube.views", 320], ["youtube.watch_hours", 4.5]]);
    expect(studio.notUsed).toContainEqual({ item: "Column \"Subscribers\"", reason: "Not a number these charts track" });
  });

  it("reads month names and settles slashed dates from the column, never from a guess", () => {
    expect(pairs("date,instagram_reach\n\"Oct 8, 2026\",5\n8 October 2026,6\n", "x.csv").map(([, date]) => date)).toEqual(["2026-10-08", "2026-10-08"]);
    expect(pairs("date,instagram_reach\n10/08/2026,5\n10/13/2026,6\n").map(([, date]) => date)).toEqual(["2026-10-08", "2026-10-13"]);
    const ambiguous = read("date,instagram_reach\n10/08/2026,5\nTotal,5\n")!;
    expect(ambiguous.values).toEqual([]);
    expect(ambiguous.notUsed).toEqual([
      { item: "Row \"10/08/2026\"", reason: "The date could not be read" },
      { item: "Row \"Total\"", reason: "A total or average row, not a day" },
    ]);
  });

  it("reads Markdown tables, and leaves prose to the AI reader", () => {
    expect(pairs("Reddit this week\n\n| Date | Karma | Upvotes |\n|---|---|---|\n| 2026-10-08 | 340 | 12 |\n", "notes.md")).toEqual([
      ["reddit.karma", "2026-10-08", 340], ["reddit.upvotes", "2026-10-08", 12],
    ]);
    expect(read("Reach jumped to 2,219 on October 8 after the reel.")).toBeNull();
  });

  it("splits CSV with quotes, tabs and semicolons", () => {
    expect(parseTable("a,\"b, c\",\"say \"\"hi\"\"\"\n1,2,3")).toEqual([["a", "b, c", "say \"hi\""], ["1", "2", "3"]]);
    expect(parseTable("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseTable("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
