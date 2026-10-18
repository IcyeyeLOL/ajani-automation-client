import { describe, expect, it } from "vitest";
import { answerQuestions, countLog, parseTable, readDailyTable, type TableValue } from "@/lib/admin/report-table";
import { SAMPLE_DEFINITIONS } from "@/lib/admin/sample-data";
import { SOCIAL_COMBINED_CSV as COMBINED } from "@/lib/admin/testing/social-combined";

// The real catalog's hand-logged numbers, so header matching is tested against real keys and labels.
const metrics = SAMPLE_DEFINITIONS.filter((metric) => metric.entryMode === "manual" && metric.unit !== "ratio");
const read = (text: string, fileName = "numbers.csv", platform?: string) => readDailyTable(text, fileName, metrics, { platform })!;
const pairs = (text: string, fileName?: string) => read(text, fileName).values.map((value) => [value.metricKey, value.date, value.value]);
const totals = (values: TableValue[]) => {
  const byKey = new Map<string, { days: number; sum: number; first: number; last: number }>();
  for (const value of values) {
    const entry = byKey.get(value.metricKey) ?? { days: 0, sum: 0, first: value.value, last: value.value };
    byKey.set(value.metricKey, { days: entry.days + 1, sum: entry.sum + value.value, first: entry.first, last: value.value });
  }
  return Object.fromEntries(byKey);
};

describe("reading a file that mixes platforms", () => {
  const result = read(COMBINED, "social-analytics-combined-2026-09-18_to_2026-10-17.csv");

  it("puts every row's numbers on that row's platform", () => {
    expect(result.values).toHaveLength(360);
    expect(totals(result.values)).toEqual({
      "instagram.reach": { days: 30, sum: 5622, first: 84, last: 20 },
      "instagram.views": { days: 30, sum: 9329, first: 635, last: 93 },
      "instagram.interactions": { days: 30, sum: 541, first: 102, last: 7 },
      "instagram.likes": { days: 30, sum: 265, first: 24, last: 4 },
      "instagram.comments": { days: 30, sum: 15, first: 0, last: 1 },
      "instagram.shares": { days: 30, sum: 108, first: 37, last: 0 },
      "instagram.saves": { days: 30, sum: 14, first: 0, last: 1 },
      "instagram.profile_visits": { days: 30, sum: 430, first: 9, last: 4 },
      // Link taps include the contact buttons, which are all 0 here.
      "instagram.profile_link_taps": { days: 30, sum: 19, first: 0, last: 0 },
      "instagram.posts_published": { days: 30, sum: 13, first: 0, last: 0 },
      "linkedin.followers": { days: 30, sum: 72965, first: 2362, last: 2533 },
      "linkedin.posts_published": { days: 30, sum: 7, first: 0, last: 0 },
    });
    // Instagram's own rows leave followers blank, so Instagram followers are unknown, never LinkedIn's.
    expect(result.values.some((value) => value.metricKey === "instagram.followers")).toBe(false);
    expect(result.values.find((value) => value.metricKey === "instagram.views" && value.date === "2026-10-09")?.value).toBe(2907);
    expect(result.values.find((value) => value.metricKey === "linkedin.followers" && value.date === "2026-10-01")?.evidence).toBe("LinkedIn row 2026-10-01, column \"followers\"");
  });

  it("asks before using a LinkedIn header that isn't LinkedIn's own word, with its cells attached", () => {
    expect(result.questions.map((question) => [question.header, question.source, question.candidates, question.cells.length, question.cells.reduce((sum, cell) => sum + cell.value, 0)])).toEqual([
      ["views", "linkedin", ["linkedin.impressions"], 30, 2851],
      ["interactions", "linkedin", ["linkedin.engagements"], 30, 28],
    ]);
    expect(result.unresolved).toEqual(["views", "interactions"]);
    const answered = answerQuestions(result.questions, new Map([[result.questions[0].id, "linkedin.impressions"], [result.questions[1].id, null]]));
    expect(answered).toHaveLength(30);
    expect(answered[0]).toEqual({ metricKey: "linkedin.impressions", date: "2026-09-18", value: 39, evidence: "LinkedIn row 2026-09-18, column \"views\"" });
    // An answer that isn't one of the candidates gives nothing.
    expect(answerQuestions(result.questions, new Map([[result.questions[0].id, "instagram.views"]]))).toEqual([]);
  });

  it("breaks the file down by platform, with time zones and a check of the totals against the daily change", () => {
    expect(result.groups.map(({ id, label, decidedBy, rows, timeZone, from, to, blank, checks, read }) => ({ id, label, decidedBy, rows, timeZone, from, to, blank, checks, read: read.length }))).toEqual([
      { id: "instagram", label: "Instagram", decidedBy: "platform column", rows: 30, timeZone: "America/Chicago", from: "2026-09-18", to: "2026-10-17", blank: ["instagram.followers"], checks: [], read: 10 },
      {
        id: "linkedin", label: "LinkedIn", decidedBy: "platform column", rows: 30, timeZone: "UTC", from: "2026-09-18", to: "2026-10-17", blank: ["linkedin.comments"], read: 2,
        checks: [{ ok: true, text: "LinkedIn followers rise by exactly the \"new_followers\" column on all 29 days." }],
      },
    ]);
    // Labels (platform, time zone) are never reported as unused numbers.
    expect(result.notUsed).toEqual([{ item: "Column \"new_followers\" (LinkedIn)", reason: "A day's change, not a total these charts keep" }]);
    expect(result.people).toBe(false);
    expect(result.note).toBe("Read 360 numbers straight from the spreadsheet: Instagram 300 across 30 days and LinkedIn 60 across 30 days. 2 columns need a decision first.");
  });

  it("refuses to read days listed twice when nothing says which platform each row is", () => {
    const unlabelled = COMBINED.split("\n").map((line) => line.split(",").slice(2).join(",")).join("\n");
    const blind = read(unlabelled, "social-analytics-combined.csv");
    expect(blind.values).toEqual([]);
    expect(blind.questions).toEqual([]);
    expect(blind.notUsed[0]).toEqual({ item: "60 rows over 30 days", reason: "Some days appear more than once and nothing says which platform each row is for, so these rows weren't read as daily numbers" });
    // Handed on as a list for the AI agent, which sees column names and numbers, never a guess.
    expect(blind.logs).toHaveLength(1);
    expect(blind.logs[0].rows).toBe(60);
  });
});

describe("reading spreadsheets without AI", () => {
  it("explains that Muse's totals file has nothing for a daily chart", () => {
    // The owner's real upload, 2026-10-17.
    const result = read(`Totals,,
window,followers,reach,views,interactions,likes,comments,shares,saves,profile_visits,link_taps,contact_taps,posts_published
Last 7 days (2026-10-10 to 2026-10-16),,2202,3649,180,103,8,27,6,102,4,0,2
Last 30 days (2026-09-17 to 2026-10-16),,5325,9244,535,262,14,108,13,441,19,0,15
Last 90 days (2026-07-19 to 2026-10-16),,5504,9977,648,296,15,145,14,708,32,0,18
`, "instagram-totals.csv");
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
    const result = read(daily, "export.csv");
    expect(result.unresolved).toEqual([]);
    expect(result.groups.map((group) => [group.label, group.decidedBy])).toEqual([["Instagram", "heading"]]);
    expect(result.note).toBe("Read 20 numbers straight from the spreadsheet (Instagram 20 across 2 days). The totals table was left out.");
    expect(result.values[3].evidence).toBe("Row 2026-10-08, column \"interactions\"");
  });

  it("works out a single series' platform from columns only one platform has, and says so", () => {
    const result = read("date,followers,reach,saves\n2026-10-08,73,2219,1\n2026-10-09,73,1560,5\n", "export.csv");
    expect(result.values.map((value) => value.metricKey)).toEqual(["instagram.followers", "instagram.reach", "instagram.saves", "instagram.followers", "instagram.reach", "instagram.saves"]);
    expect(result.groups[0]).toMatchObject({ label: "Instagram", decidedBy: "columns", checks: [{ ok: true, text: "Read as Instagram: \"reach\" and \"saves\" are numbers only Instagram has. If that's wrong, untick these rows." }] });
    // The owner can say which platform unnamed rows are.
    expect(read("date,followers\n2026-10-08,512\n", "export.csv", "linkedin").values).toEqual([{ metricKey: "linkedin.followers", date: "2026-10-08", value: 512, evidence: "Row 2026-10-08, column \"followers\"" }]);
    expect(read("date,followers\n2026-10-08,512\n", "export.csv", "linkedin").groups[0].decidedBy).toBe("you");
  });

  it("takes the platform from the file name, and keeps prefixed and sales columns exact", () => {
    expect(pairs("date,followers,views\n2026-10-08,512,9000\n", "linkedin-daily.csv")).toEqual([["linkedin.followers", "2026-10-08", 512]]);
    expect(read("date,followers,views\n2026-10-08,512,9000\n", "linkedin-daily.csv").unresolved).toEqual(["views"]);
    expect(pairs("date,followers,views\n2026-10-08,73,900\n", "ig-daily.csv")).toEqual([["instagram.followers", "2026-10-08", 73], ["instagram.views", "2026-10-08", 900]]);
    expect(pairs("Date,Instagram followers,LinkedIn followers,Clients signed,Cash collected\n2026-10-14,73,1200,1,\"$1,250.50\"\n")).toEqual([
      ["instagram.followers", "2026-10-14", 73], ["linkedin.followers", "2026-10-14", 1200], ["sales.deals_won", "2026-10-14", 1], ["revenue.cash_collected", "2026-10-14", 1250.5],
    ]);
  });

  it("reads sections headed by platform, the heading beating the file name", () => {
    const sections = `Instagram
date,followers,views
2026-10-08,73,900

LinkedIn
date,followers,impressions
2026-10-08,2475,20
`;
    expect(pairs(sections, "instagram-linkedin.csv")).toEqual([
      ["instagram.followers", "2026-10-08", 73], ["instagram.views", "2026-10-08", 900],
      ["linkedin.followers", "2026-10-08", 2475], ["linkedin.impressions", "2026-10-08", 20],
    ]);
    expect(pairs("LinkedIn\ndate,followers\n2026-10-08,2475\n", "instagram-daily.csv")).toEqual([["linkedin.followers", "2026-10-08", 2475]]);
  });

  it("reads long files (date, platform, metric, value), adding contact taps to link taps", () => {
    const long = `date,platform,metric,value
2026-10-08,IG,reach,2219
2026-10-08,IG,link_taps,3
2026-10-08,IG,contact_taps,1
2026-10-08,li,followers,2475
2026-10-08,LinkedIn Page,impressions,20
`;
    expect(pairs(long)).toEqual([
      ["instagram.reach", "2026-10-08", 2219], ["instagram.profile_link_taps", "2026-10-08", 4],
      ["linkedin.followers", "2026-10-08", 2475], ["linkedin.impressions", "2026-10-08", 20],
    ]);
  });

  it("leaves out platforms the desk doesn't track, total rows and unknown labels", () => {
    const mixed = `platform,date,followers,views
TikTok,2026-10-08,231,1500
Facebook,2026-10-08,40,100
Total,2026-10-08,2746,2500
Website,2026-10-08,,300
Instagram,2026-10-08,73,900
`;
    const result = read(mixed);
    expect(result.values.map((value) => value.metricKey)).toEqual(["instagram.followers", "instagram.views"]);
    expect(result.notUsed).toEqual([
      { item: "TikTok rows (1 row)", reason: "TikTok isn't tracked on these charts" },
      { item: "Facebook rows (1 row)", reason: "Facebook isn't tracked on these charts" },
      { item: "Rows for \"Total\" (1 row)", reason: "A total of the other rows, not a platform" },
      { item: "Rows for \"Website\" (1 row)", reason: "Not a platform or log these charts track" },
    ]);
    // A "Channel" column of channel names is not a platform column.
    const youtube = read("Date,Channel,Views\n2026-10-08,Ajani Automation,320\n", "youtube-daily.csv");
    expect(youtube.values.map((value) => [value.metricKey, value.value])).toEqual([["youtube.views", 320]]);
  });

  it("never puts a number named for one platform on another platform's rows", () => {
    const result = read("platform,date,instagram_reach,impressions\nlinkedin,2026-10-08,99,20\n");
    expect(result.values.map((value) => value.metricKey)).toEqual(["linkedin.impressions"]);
    expect(result.notUsed).toEqual([{ item: "Column \"instagram_reach\"", reason: "Named for Instagram, but these are LinkedIn rows" }]);
    // An Instagram file's "profile views" is not LinkedIn's; business columns still count.
    const instagram = read("Date,Reach,Profile views,Clients signed\n2026-10-08,2219,60,1\n", "instagram-daily.csv");
    expect(instagram.values.map((value) => value.metricKey)).toEqual(["instagram.reach", "sales.deals_won"]);
    expect(instagram.notUsed).toEqual([{ item: "Column \"Profile views\"", reason: "Instagram has no number like this on the charts" }]);
    // A retired platform's file is left out, not read as another platform's.
    const tiktok = read("Date,Followers,Views,Profile views,Videos\n2026-10-08,231,1500,22,1\n", "tiktok-daily.csv");
    expect(tiktok.values).toEqual([]);
    expect(tiktok.notUsed).toEqual([{ item: "TikTok rows (1 row)", reason: "TikTok isn't tracked on these charts" }]);
  });

  it("knows LinkedIn's own words, and never takes a day's change as a running total", () => {
    const linkedin = read("date,impressions,engagements,views,interactions,new_followers,members_reached,engagement_rate\n2026-10-08,20,3,25,4,2,15,1.2%\n", "linkedin-daily.csv");
    expect(linkedin.values.map((value) => [value.metricKey, value.value])).toEqual([["linkedin.impressions", 20], ["linkedin.engagements", 3]]);
    expect(linkedin.questions.map((question) => [question.header, question.candidates])).toEqual([["views", ["linkedin.impressions"]], ["interactions", ["linkedin.engagements"]]]);
    expect(linkedin.notUsed).toEqual([
      { item: "Column \"new_followers\"", reason: "A day's change, not a total these charts keep" },
      { item: "Column \"members_reached\"", reason: "LinkedIn's members reached isn't tracked on these charts" },
      { item: "Column \"engagement_rate\"", reason: "A rate or average; the charts work those out themselves" },
    ]);
    const studio = read("Date,Views,Watch time (hours),Subscribers\n2026-10-08,320,4.5,3\n", "youtube-channel.csv");
    expect(studio.values.map((value) => [value.metricKey, value.value])).toEqual([["youtube.views", 320], ["youtube.watch_hours", 4.5]]);
    expect(studio.notUsed).toContainEqual({ item: "Column \"Subscribers\"", reason: "YouTube's daily \"Subscribers\" is that day's net change, not the total" });
  });

  it("checks a running total against its daily change and says when they disagree", () => {
    const result = read("date,followers,new_followers\n2026-10-08,100,\n2026-10-09,102,2\n2026-10-10,103,1\n2026-10-11,110,2\n", "linkedin-daily.csv");
    expect(result.values.map((value) => value.value)).toEqual([100, 102, 103, 110]);
    expect(result.groups[0].checks).toEqual([{ ok: false, text: "LinkedIn followers match the \"new_followers\" column on only 2 of 3 days, so some totals may be estimates." }]);
  });

  it("asks which platform when a shared header's rows name none", () => {
    const unclear = read("date,followers\n2026-10-08,70\n");
    expect(unclear.values).toEqual([]);
    expect(unclear.questions.map((question) => [question.header, question.source, question.candidates])).toEqual([["followers", null, ["instagram.followers", "linkedin.followers"]]]);
    expect(unclear.note).toBe("Nothing in this file could be read for certain yet. 1 column needs a decision first.");
  });

  it("drops a column that gives two numbers for the same day more than once", () => {
    const result = read("Long story\ndate,caller,dials,instagram_reach\n2026-10-08,Sam,40,10\n2026-10-08,Ade,30,12\n2026-10-09,Sam,20,11\n2026-10-09,Ade,25,13\n", "export.csv");
    // Dials add up per day (one row per caller); Instagram reach can't, so it isn't used.
    expect(result.values.map((value) => [value.metricKey, value.date, value.value])).toEqual([["cold_calls.dials", "2026-10-08", 70], ["cold_calls.dials", "2026-10-09", 45]]);
    expect(result.notUsed).toContainEqual({ item: "Column \"instagram_reach\"", reason: "It gives two different numbers for the same day on 2 days, so none of it was used" });
  });

  it("adds up a cold-call log's callers per day, checking a Total row instead of adding it", () => {
    const log = `date,caller,dials,positive,neutral,negative,follow_ups,meetings_booked
2026-10-14,Sam,22,1,1,1,1,1
2026-10-14,Ade,20,0,1,1,1,0
2026-10-14,Total,42,1,2,2,2,1
2026-10-15,Sam,38,0,1,3,1,
2026-10-15,Total,40,0,1,3,1,
`;
    const result = read(log, "cold-calls.csv");
    expect(result.values.filter((value) => value.date === "2026-10-14").map((value) => [value.metricKey, value.value])).toEqual([
      ["cold_calls.dials", 42], ["cold_calls.positive_replies", 1], ["cold_calls.neutral_replies", 2], ["cold_calls.negative_replies", 2], ["cold_calls.follow_ups", 2], ["cold_calls.meetings_booked", 1],
    ]);
    expect(result.values.find((value) => value.metricKey === "cold_calls.dials" && value.date === "2026-10-15")).toEqual({ metricKey: "cold_calls.dials", date: "2026-10-15", value: 38, evidence: "1 row for 2026-10-15 added up, column \"dials\"" });
    expect(result.groups[0].checks).toEqual([{ ok: false, text: "2026-10-15: the \"Total\" row says 40 for \"dials\", but the rows add up to 38. The rows were used." }]);
    // No caller's name appears in any evidence.
    expect(result.values.some((value) => /Sam|Ade/.test(value.evidence))).toBe(false);
  });

  it("reads a cold-call log with one row per day", () => {
    expect(pairs("Date,Dials,Positive,Neutral,Negative,Follow-ups,Meetings booked\n2026-10-14,42,1,2,2,2,1\n2026-10-15,38,0,1,3,1,\n", "calls.csv")).toEqual([
      ["cold_calls.dials", "2026-10-14", 42], ["cold_calls.positive_replies", "2026-10-14", 1], ["cold_calls.neutral_replies", "2026-10-14", 2],
      ["cold_calls.negative_replies", "2026-10-14", 2], ["cold_calls.follow_ups", "2026-10-14", 2], ["cold_calls.meetings_booked", "2026-10-14", 1],
      ["cold_calls.dials", "2026-10-15", 38], ["cold_calls.positive_replies", "2026-10-15", 0], ["cold_calls.neutral_replies", "2026-10-15", 1],
      ["cold_calls.negative_replies", "2026-10-15", 3], ["cold_calls.follow_ups", "2026-10-15", 1],
    ]);
  });

  it("hands a list with one row per call to the AI agent, and counts it exactly once told what counts", () => {
    const calls = `Date,Prospect,Phone,Outcome
2026-10-14,Jane Doe,555-123-4567,Interested
2026-10-14,John Roe,555-222-3333,No answer
2026-10-14,Ann Poe,555-444-5555,Not interested
2026-10-15,Bob Loe,555-666-7777,Booked
2026-10-15,Kim Moe,555-888-9999,No answer
`;
    const result = read(calls, "cold-calls-october.csv");
    expect(result.people).toBe(true);
    expect(result.values).toEqual([]);
    expect(result.logs).toHaveLength(1);
    const [log] = result.logs;
    // The list keeps outcomes, never names or phone numbers.
    expect(log.columns).toEqual([{ id: "c0", header: "Outcome", numeric: false, values: [{ value: "No answer", count: 2 }, { value: "Interested", count: 1 }, { value: "Not interested", count: 1 }, { value: "Booked", count: 1 }] }]);
    expect(JSON.stringify(log)).not.toMatch(/Jane|555-/);
    const counted = countLog(log, [
      { metricKey: "cold_calls.dials", columnId: null, equals: [], amountColumnId: null },
      { metricKey: "cold_calls.positive_replies", columnId: "c0", equals: ["Interested", "Booked"], amountColumnId: null },
      { metricKey: "cold_calls.meetings_booked", columnId: "c0", equals: ["Booked"], amountColumnId: null },
      { metricKey: "instagram.views", columnId: null, equals: [], amountColumnId: null },
      { metricKey: "cold_calls.negative_replies", columnId: "c0", equals: ["Rude"], amountColumnId: null },
    ], metrics);
    expect(counted.values.map((value) => [value.metricKey, value.date, value.value])).toEqual([
      ["cold_calls.dials", "2026-10-14", 3], ["cold_calls.dials", "2026-10-15", 2],
      ["cold_calls.positive_replies", "2026-10-14", 1], ["cold_calls.positive_replies", "2026-10-15", 1],
      ["cold_calls.meetings_booked", "2026-10-14", 0], ["cold_calls.meetings_booked", "2026-10-15", 1],
    ]);
    expect(counted.values[2].evidence).toBe("1 row of 3 on 2026-10-14 where \"Outcome\" is \"Interested\" or \"Booked\"");
    expect(counted.refused.map((note) => note.reason)).toEqual(["A Instagram number from Cold calls rows", "The values to count aren't in the list"]);
  });

  it("never reads a list of people, and never hands it on", () => {
    const leads = read("Name,Email,Company,Date added\nJane Doe,jane@example.com,Acme,2026-10-14\n", "dripify-leads.csv");
    expect(leads.people).toBe(true);
    expect(leads.values).toEqual([]);
    expect(read("Full name,Profile URL\nJane Doe,https://www.linkedin.com/in/jane\n", "Connections.csv").people).toBe(true);
    expect(readDailyTable("Name,Email\nJane,jane@example.com\n", "list.csv", metrics)).toMatchObject({ people: true, values: [] });
  });

  it("reads month names and settles slashed dates from the column, never from a guess", () => {
    expect(pairs("date,instagram_reach\n\"Oct 8, 2026\",5\n9 October 2026,6\n", "x.csv").map(([, date]) => date)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(pairs("date,instagram_reach\n10/08/2026,5\n10/13/2026,6\n").map(([, date]) => date)).toEqual(["2026-10-08", "2026-10-13"]);
    const ambiguous = read("date,instagram_reach\n10/08/2026,5\nTotal,5\n");
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
    expect(readDailyTable("Reach jumped to 2,219 on October 8 after the reel.", "notes.txt", metrics)).toBeNull();
  });

  it("splits CSV with quotes, tabs and semicolons", () => {
    expect(parseTable("a,\"b, c\",\"say \"\"hi\"\"\"\n1,2,3")).toEqual([["a", "b, c", "say \"hi\""], ["1", "2", "3"]]);
    expect(parseTable("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseTable("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
