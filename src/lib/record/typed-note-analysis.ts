import type { SystemBlock } from "@/lib/domain/types";

export const MIN_TYPED_NOTE_CHARACTERS = 21;
export const MAX_CLARIFICATION_QUESTIONS = 5;

export type TypedNoteTheme =
  | "lead_follow_up"
  | "scheduling"
  | "client_intake"
  | "document_chasing"
  | "generic";

export type SuggestedOptionIndex = 0 | 1 | 2;

export interface TypedNoteClarification {
  question: string;
  options: [string, string, string];
  why?: string;
  /** A visual recommendation only. The customer must still confirm an answer. */
  suggestedOptionIndex: SuggestedOptionIndex;
}

export interface TypedNoteAnalysis {
  theme: TypedNoteTheme;
  workThatSlips: string;
  momentItHappens: string;
  desiredOutcome: string;
  clarification: TypedNoteClarification;
  clarifications: TypedNoteClarification[];
  systemBlocks: SystemBlock[];
}

type AnalysisTemplate = Omit<TypedNoteAnalysis, "theme" | "clarifications">;

const detailClarifications = {
  channel: {
    question: "Where should this workflow begin?",
    options: ["Email or a website form", "Phone calls or text messages", "An existing inbox or CRM"],
    suggestedOptionIndex: 0,
    why: "The starting channel determines what the system watches and where the first response belongs.",
  },
  timing: {
    question: "How quickly should the first response go out?",
    options: ["Immediately", "Within five minutes", "During business hours only"],
    suggestedOptionIndex: 0,
    why: "The response window sets the trigger timing and the fallback when the team is unavailable.",
  },
  owner: {
    question: "Who should receive a conversation that needs a person?",
    options: ["The owner or manager", "A specific sales or front-desk person", "A shared team queue"],
    suggestedOptionIndex: 2,
    why: "A named destination prevents a qualified request from becoming another unowned notification.",
  },
  finish: {
    question: "What should count as a successful finish for this workflow?",
    options: ["The missing details are captured", "A booking or next step is confirmed", "A person accepts the handoff"],
    suggestedOptionIndex: 1,
    why: "The finish line tells the system when to stop following up and what result to record.",
  },
} satisfies Record<string, TypedNoteClarification>;

const themeMatchers: Record<Exclude<TypedNoteTheme, "generic">, RegExp[]> = {
  lead_follow_up: [
    /\bleads?\b/,
    /\bprospects?\b/,
    /\benquir(?:y|ies)\b/,
    /\binquir(?:y|ies)\b/,
    /\bfollow[ -]?ups?\b/,
    /\bmissed calls?\b/,
    /\bquotes?\b/,
  ],
  scheduling: [
    /\bappointments?\b/,
    /\bbook(?:ing|ings|ed)?\b/,
    /\bschedul(?:e|es|ed|ing)\b/,
    /\breschedul(?:e|es|ed|ing)\b/,
    /\bcalendars?\b/,
    /\bno[ -]?shows?\b/,
  ],
  client_intake: [
    /\bclient intake\b/,
    /\bintake forms?\b/,
    /\bonboard(?:ing|ed)?\b/,
    /\bnew clients?\b/,
    /\bcustomer details?\b/,
    /\bclient details?\b/,
    /\bregistration forms?\b/,
  ],
  document_chasing: [
    /\bdocuments?\b/,
    /\bpaperwork\b/,
    /\bfiles?\b/,
    /\bsignatures?\b/,
    /\bmissing records?\b/,
    /\bstatements?\b/,
    /\breceipts?\b/,
    /\buploads?\b/,
  ],
};

const themePriority: Array<Exclude<TypedNoteTheme, "generic">> = [
  "lead_follow_up",
  "scheduling",
  "client_intake",
  "document_chasing",
];

const templates: Record<TypedNoteTheme, AnalysisTemplate> = {
  lead_follow_up: {
    workThatSlips: "New enquiries do not get a consistent follow-up.",
    momentItHappens: "After an enquiry arrives and before a person takes ownership.",
    desiredOutcome: "Give every enquiry a timely response and a clear human handoff.",
    clarification: {
      question: "When should the follow-up leave automation and reach a person?",
      options: [
        "When the lead asks about price or availability",
        "When the lead shares a real date, budget, or project detail",
        "Let a person review every reply",
      ],
      suggestedOptionIndex: 1,
    },
    systemBlocks: [
      block("trigger", "trigger", "A new enquiry arrives", "Capture the enquiry from the channel where it was received."),
      block("reply", "reply", "Acknowledge it promptly", "Confirm receipt in the business's usual tone and set a clear expectation."),
      block("qualify", "qualify", "Collect what matters next", "Ask only for the context needed to determine fit, timing, or the next action."),
      block("handoff", "handoff", "Bring in the right person", "Share the context and recommended next action with the responsible person."),
    ],
  },
  scheduling: {
    workThatSlips: "Booking requests and schedule changes are handled inconsistently.",
    momentItHappens: "Between a scheduling request and a confirmed time on the calendar.",
    desiredOutcome: "Give each scheduling request a clear confirmation or human next step.",
    clarification: {
      question: "What should require a person before a time is confirmed?",
      options: [
        "Only requests outside the available calendar times",
        "Requests with special timing or service requirements",
        "Every booking request before confirmation",
      ],
      suggestedOptionIndex: 1,
    },
    systemBlocks: [
      block("trigger", "trigger", "A scheduling request arrives", "Capture a new booking, cancellation, or time-change request."),
      block("reply", "reply", "Confirm the request was received", "Tell the requester what will happen next without promising an unavailable time."),
      block("qualify", "qualify", "Check the scheduling details", "Collect the service, timing, and exception details needed to choose the next step."),
      block("handoff", "handoff", "Confirm or route the exception", "Confirm an allowed time or send the full context to the person who decides."),
    ],
  },
  client_intake: {
    workThatSlips: "New client details are not collected in one reliable sequence.",
    momentItHappens: "After a client agrees to begin and before the team has what it needs.",
    desiredOutcome: "Give every new client a clear intake path with visible missing information.",
    clarification: {
      question: "When should incomplete intake move to a person?",
      options: [
        "After one reminder for missing information",
        "When a required answer needs interpretation",
        "Before any intake response is accepted",
      ],
      suggestedOptionIndex: 1,
    },
    systemBlocks: [
      block("trigger", "trigger", "A new client starts intake", "Open one intake route when the client is ready to begin."),
      block("reply", "reply", "Send the intake instructions", "Explain what is needed and where the client should provide it."),
      block("qualify", "qualify", "Check for missing essentials", "Identify incomplete required details without making decisions for the team."),
      block("handoff", "handoff", "Prepare the team handoff", "Give the responsible person the collected details and any unresolved items."),
    ],
  },
  document_chasing: {
    workThatSlips: "Required documents are chased manually and missing items are easy to overlook.",
    momentItHappens: "After documents are requested and before the complete set is received.",
    desiredOutcome: "Make outstanding documents visible and give each missing item a clear next action.",
    clarification: {
      question: "When should a missing document be escalated to a person?",
      options: [
        "After one unanswered reminder",
        "When the deadline is close or the document needs review",
        "As soon as any requested item is missing",
      ],
      suggestedOptionIndex: 1,
    },
    systemBlocks: [
      block("trigger", "trigger", "A document request is opened", "Record the required items and the person responsible for providing them."),
      block("reply", "reply", "Send a clear request", "List the outstanding items and explain the approved submission route."),
      block("qualify", "qualify", "Check what is still missing", "Compare received items with the request without judging their professional validity."),
      block("handoff", "handoff", "Escalate the unresolved items", "Give a person the document status, deadline context, and next action."),
    ],
  },
  generic: {
    workThatSlips: "A manual handoff can lose momentum before the next action is clear.",
    momentItHappens: "Between the first request and the person responsible for the next step.",
    desiredOutcome: "Give every request a clear next action, owner, and exception path.",
    clarification: {
      question: "Which event should always bring a person into the workflow?",
      options: [
        "When the request falls outside the normal path",
        "When a decision or approval is required",
        "Before any automatic response is sent",
      ],
      suggestedOptionIndex: 1,
    },
    systemBlocks: [
      block("trigger", "trigger", "A request enters the workflow", "Capture the request and the channel where it arrived."),
      block("reply", "reply", "Acknowledge the request", "Confirm receipt and explain the next expected step."),
      block("qualify", "qualify", "Collect the missing context", "Ask only for the detail needed to choose the next action."),
      block("handoff", "handoff", "Route it to the right person", "Send the request, context, and unresolved decision to the responsible person."),
    ],
  },
};

/**
 * Produces a deterministic, non-generative first draft from recognizable work
 * themes. The returned copy intentionally does not echo the note, preserving
 * names and sensitive details that a customer may have typed.
 */
export function analyzeTypedNote(note: string): TypedNoteAnalysis {
  const normalized = note.trim().replace(/\s+/g, " ");
  if (normalized.length < MIN_TYPED_NOTE_CHARACTERS) {
    throw new RangeError(`A typed note must contain at least ${MIN_TYPED_NOTE_CHARACTERS} characters.`);
  }

  const searchable = normalized.toLocaleLowerCase("en-US");
  const theme = detectTheme(searchable);
  const template = templates[theme];
  const clarifications = buildClarifications(searchable, template.clarification);

  return {
    theme,
    workThatSlips: template.workThatSlips,
    momentItHappens: template.momentItHappens,
    desiredOutcome: template.desiredOutcome,
    clarification: {
      ...template.clarification,
      options: [...template.clarification.options],
    },
    clarifications,
    systemBlocks: template.systemBlocks.map((item) => ({ ...item })),
  };
}

function buildClarifications(note: string, primary: TypedNoteClarification) {
  const questions: TypedNoteClarification[] = [{ ...primary, options: [...primary.options] }];

  if (!/\b(?:email|inbox|website|form|phone|call|text|sms|instagram|facebook|crm|portal)\b/.test(note)) {
    questions.push(detailClarifications.channel);
  }
  if (!/\b(?:immediate|minute|hour|morning|afternoon|evening|overnight|after[ -]?hours|business hours|same day|next day)\b/.test(note)) {
    questions.push(detailClarifications.timing);
  }
  if (!/\b(?:owner|manager|team|staff|sales|front desk|assistant|coordinator|person|employee)\b/.test(note)) {
    questions.push(detailClarifications.owner);
  }
  if (!/\b(?:book|confirm|capture|collect|assign|route|reply|respond|complete|finish|schedule|handoff|hand off)\w*\b/.test(note)) {
    questions.push(detailClarifications.finish);
  }

  return questions.slice(0, MAX_CLARIFICATION_QUESTIONS).map((item): TypedNoteClarification => ({
    ...item,
    options: [item.options[0], item.options[1], item.options[2]],
  }));
}

function detectTheme(note: string): TypedNoteTheme {
  let selected: TypedNoteTheme = "generic";
  let selectedScore = 0;

  for (const theme of themePriority) {
    const score = themeMatchers[theme].reduce(
      (total, matcher) => total + (matcher.test(note) ? 1 : 0),
      0,
    );
    if (score > selectedScore) {
      selected = theme;
      selectedScore = score;
    }
  }

  return selected;
}

function block(
  id: string,
  kind: SystemBlock["kind"],
  title: string,
  detail: string,
): SystemBlock {
  return { id, kind, title, detail };
}
