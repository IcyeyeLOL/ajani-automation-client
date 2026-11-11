/**
 * Made-up clients and builds for previewing the build conversation screens:
 * the control desk's "Sample data" mode and the portal's local preview. Rows
 * have the same shape the database returns, so the real shaping code runs on
 * them. Nothing here is ever written anywhere.
 */

type Row = Record<string, unknown>;

export type SampleBuildWorkspace = {
  builds: Row[];
  events: Row[];
  messages: Row[];
  organizations: Row[];
  profiles: Row[];
  quotes: Row[];
};

export const SAMPLE_CLIENT_ORGANIZATION_ID = "5a300000-0000-4000-8000-000000000001";

const ids = {
  dental: SAMPLE_CLIENT_ORGANIZATION_ID,
  realty: "5a300000-0000-4000-8000-000000000002",
  missedCalls: "5a310000-0000-4000-8000-000000000001",
  intake: "5a310000-0000-4000-8000-000000000002",
  reviews: "5a310000-0000-4000-8000-000000000003",
  showings: "5a310000-0000-4000-8000-000000000004",
};

export function sampleBuildWorkspace(now = new Date()): SampleBuildWorkspace {
  const at = (days: number, hours = 0) => new Date(now.getTime() - (days * 24 + hours) * 3_600_000).toISOString();
  const step = (id: string, kind: string, title: string, detail: string) => ({ id, kind, title, detail });
  return {
    organizations: [
      { id: ids.dental, business_name: "Northline Dental (sample)" },
      { id: ids.realty, business_name: "Harbor Street Realty (sample)" },
    ],
    profiles: [
      { id: "sample-dana", full_name: "Dana Whitfield", email: "dana@example.com", phone: "+1 410 555 0142" },
      { id: "sample-marcus", full_name: "Marcus Bell", email: "marcus@example.com", phone: null },
    ],
    builds: [
      {
        id: ids.intake,
        organization_id: ids.dental,
        created_by: "sample-dana",
        title: "New patient forms into the practice system",
        status: "needs_attention",
        quoted_amount_cents: 180_000,
        created_at: at(12),
        updated_at: at(0, 3),
        transcript: "New patients fill out a paper clipboard form and someone types it in at the end of the day. Half the time it's missing insurance info and we find out when they're in the chair.",
        plain_language_scope: "A secure online intake form sent with every new booking. Answers go straight into the practice system, and missing insurance details are flagged to the front desk the day before the visit.",
        extracted_context: { emailBrief: { overview: "Send intake forms with each booking and file the answers automatically." }, demand: { demandCategory: "Intake and onboarding" } },
        system_definition: [
          step("intake-1", "trigger", "New booking made", "A new patient appointment is booked online or by the front desk."),
          step("intake-2", "reply", "Intake form sent", "The patient gets a secure form by text and email."),
          step("intake-3", "qualify", "Insurance check", "Missing or unreadable insurance details are flagged."),
          step("intake-4", "handoff", "Front desk heads-up", "The day before the visit, the desk sees anything still missing."),
        ],
      },
      {
        id: ids.missedCalls,
        organization_id: ids.dental,
        created_by: "sample-dana",
        title: "Text back every missed call",
        status: "in_progress",
        quoted_amount_cents: 120_000,
        created_at: at(9),
        updated_at: at(1, 2),
        transcript: "When we're with patients the phone rings out. People don't leave voicemails, they just call the next dentist.",
        plain_language_scope: "Every missed call during office hours gets a friendly text within a minute with a booking link. Replies go to the front desk inbox.",
        extracted_context: { emailBrief: { overview: "Answer every missed call with a text and a booking link." }, demand: { demandCategory: "Lead response" } },
        system_definition: [
          step("calls-1", "trigger", "Call goes unanswered", "The phone system reports a missed call during office hours."),
          step("calls-2", "reply", "Text sent", "The caller gets a text with a booking link within a minute."),
          step("calls-3", "handoff", "Replies to the desk", "Any reply lands in the shared front desk inbox."),
        ],
      },
      {
        id: ids.reviews,
        organization_id: ids.dental,
        created_by: "sample-dana",
        title: "Review requests after cleanings",
        status: "live",
        quoted_amount_cents: 90_000,
        created_at: at(40),
        updated_at: at(6),
        transcript: "We forget to ask for reviews. Happy patients leave and we never hear from them again.",
        plain_language_scope: "Two hours after a cleaning, patients get a short thank-you text with a review link. Anyone who rates low is routed to the office manager instead.",
        extracted_context: { emailBrief: { overview: "Ask happy patients for a review after each cleaning." }, demand: { demandCategory: "Reviews and reputation" } },
        system_definition: [
          step("reviews-1", "trigger", "Cleaning completed", "The visit is marked complete."),
          step("reviews-2", "reply", "Thank-you text", "Two hours later the patient gets a thank-you and a review link."),
        ],
      },
      {
        id: ids.showings,
        organization_id: ids.realty,
        created_by: "sample-marcus",
        title: "Showing requests into one calendar",
        status: "in_review",
        quoted_amount_cents: null,
        created_at: at(0, 20),
        updated_at: at(0, 1),
        transcript: "Showing requests come in from Zillow, our site and texts, and agents double book.",
        plain_language_scope: "Every showing request lands in one shared calendar with the listing attached.",
        extracted_context: { emailBrief: { overview: "Collect showing requests from every source into one calendar." }, demand: { demandCategory: "Scheduling" } },
        system_definition: [],
      },
    ],
    quotes: [],
    messages: [
      { id: "5a320000-0000-4000-8000-000000000001", build_request_id: ids.missedCalls, author_role: "ajani", kind: "update", body: "Kicked off the build. Your phone provider can report missed calls, so no new hardware is needed.", link_url: null, link_label: null, created_at: at(7) },
      { id: "5a320000-0000-4000-8000-000000000002", build_request_id: ids.missedCalls, author_role: "client", kind: "message", body: "Great. Can the text say it's from Northline and not a random number?", link_url: null, link_label: null, created_at: at(6, 20) },
      { id: "5a320000-0000-4000-8000-000000000003", build_request_id: ids.missedCalls, author_role: "ajani", kind: "update", body: "Yes. Texts now come from your main office number and open with \"Hi, it's Northline Dental.\" Here's a two-minute walkthrough of the first working version.", link_url: "https://www.loom.com/share/sample-walkthrough", link_label: "Watch the walkthrough", created_at: at(1, 2) },
      { id: "5a320000-0000-4000-8000-000000000004", build_request_id: ids.intake, author_role: "ajani", kind: "update", body: "The form is built and sends with every new booking in the test setup.", link_url: null, link_label: null, created_at: at(2) },
      { id: "5a320000-0000-4000-8000-000000000005", build_request_id: ids.intake, author_role: "ajani", kind: "question", body: "When insurance details are missing, should the front desk get a text the day before, or is a note in the morning list enough?", link_url: null, link_label: null, created_at: at(0, 3) },
      { id: "5a320000-0000-4000-8000-000000000006", build_request_id: ids.reviews, author_role: "ajani", kind: "update", body: "This is live. 14 review texts went out this week and nothing needs your attention.", link_url: null, link_label: null, created_at: at(6) },
      { id: "5a320000-0000-4000-8000-000000000007", build_request_id: ids.showings, author_role: "client", kind: "message", body: "Do you need logins for Zillow, or can it read the emails they send us?", link_url: null, link_label: null, created_at: at(0, 1) },
    ],
    events: [
      { id: "5a330000-0000-4000-8000-000000000001", build_request_id: ids.missedCalls, event_type: "request_submitted", payload: {}, created_at: at(9) },
      { id: "5a330000-0000-4000-8000-000000000002", build_request_id: ids.missedCalls, event_type: "status_changed", payload: { from: "in_review", to: "in_progress" }, created_at: at(7) },
      { id: "5a330000-0000-4000-8000-000000000003", build_request_id: ids.intake, event_type: "request_submitted", payload: {}, created_at: at(12) },
      { id: "5a330000-0000-4000-8000-000000000004", build_request_id: ids.intake, event_type: "status_changed", payload: { from: "in_review", to: "in_progress" }, created_at: at(10) },
      { id: "5a330000-0000-4000-8000-000000000005", build_request_id: ids.intake, event_type: "status_changed", payload: { from: "in_progress", to: "needs_attention" }, created_at: at(0, 3) },
      { id: "5a330000-0000-4000-8000-000000000006", build_request_id: ids.reviews, event_type: "request_submitted", payload: {}, created_at: at(40) },
      { id: "5a330000-0000-4000-8000-000000000007", build_request_id: ids.reviews, event_type: "status_changed", payload: { from: "in_progress", to: "live" }, created_at: at(6) },
      { id: "5a330000-0000-4000-8000-000000000008", build_request_id: ids.showings, event_type: "request_submitted", payload: {}, created_at: at(0, 20) },
    ],
  };
}
