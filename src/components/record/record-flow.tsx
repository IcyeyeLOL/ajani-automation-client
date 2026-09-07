"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useAccountAccess } from "@/components/account-access-dialog";
import { VoiceRecorder, type VoiceMemoCapture } from "@/components/home/voice-recorder";
import type { SystemBlock } from "@/lib/domain/types";
import {
  CURRENT_HANDOFF_POLICY_VERSION,
  HANDOFF_NOTICE_COPY,
  PROCESSING_NOTICE_VERSION,
} from "@/lib/legal/policy-versions";
import { CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT } from "@/lib/legal/processing-notice";
import {
  asTypedClarifications,
  approvedAutomationEmailBrief,
  automationEmailBriefSchema,
  fallbackAutomationIntake,
  fallbackAutomationShape,
  type AutomationEmailBrief,
} from "@/lib/record/automation-brief";
import { requestAutomationClarifications, requestAutomationShape } from "@/lib/record/automation-brief-client";
import { normalizeGeneratedText } from "@/lib/ai/generated-prose";
import {
  analyzeTypedNote,
  MAX_CLARIFICATION_QUESTIONS,
  MIN_TYPED_NOTE_CHARACTERS,
  type TypedNoteClarification,
  type TypedNoteAnalysis,
} from "@/lib/record/typed-note-analysis";
import {
  acknowledgeSavedWebsiteRequestDraft,
  claimSavedWebsiteRequestDraft,
  clearSavedWebsiteRequestCapability,
  deleteSavedWebsiteRequestDraft,
  getSavedWebsiteRequestDraft,
  saveWebsiteRequestDraft,
} from "@/lib/request-drafts/client";
import { transcribeCapturedVoiceMemo } from "@/lib/transcription/client";
import { getReducedMotionPreference } from "@/lib/motion/preference";
import { readTabValue, removeTabValue, writeTabValue } from "@/lib/record/tab-storage";
import styles from "./record-flow.module.css";

const stages = ["Tell us", "Clarify", "Shape", "Check", "Handoff"];
const FLOW_STORAGE_KEY = "ajani_record_flow_v3";
const LEGACY_FLOW_STORAGE_KEYS = ["ajani_record_flow_v1", "ajani_record_flow_v2"];

const fallbackBlocks: SystemBlock[] = [
  { id: "trigger", kind: "trigger", title: "A request arrives", detail: "Capture the request and the channel where it arrived." },
  { id: "reply", kind: "reply", title: "Acknowledge it", detail: "Confirm receipt and explain the next expected step." },
  { id: "qualify", kind: "qualify", title: "Collect what matters next", detail: "Ask only for the context needed to choose the next action." },
  { id: "handoff", kind: "handoff", title: "Bring in the right person", detail: "Share the context and recommended next action with the responsible person." },
];

const notePrompts = [
  { n: "01", title: "What happens today", detail: "Walk through the moment where the work gets stuck." },
  { n: "02", title: "Who is involved", detail: "Name the people, tools, or channels already in the route." },
  { n: "03", title: "What good looks like", detail: "Describe the outcome you want to become normal." },
];

const buildIncludes = [
  "Intake from the channels you already use",
  "The response and clarification logic",
  "A clear human handoff",
  "30 days of tuning after launch",
];

const reviewFiles = [
  { id: "source", number: "01", label: "Source note", summary: "What you told us" },
  { id: "problem", number: "02", label: "Problem", summary: "The workflow gap" },
  { id: "decisions", number: "03", label: "Decisions", summary: "Your confirmed answers" },
  { id: "route", number: "04", label: "Route", summary: "The system in order" },
  { id: "protection", number: "05", label: "Protection", summary: "What the build safeguards" },
] as const;

type InputMode = "speak" | "type";
type VoiceTranscriptionStatus = "idle" | "transcribing" | "ready" | "failed";
type AutomationStatus = "idle" | "clarifying" | "shaping" | "ready" | "fallback";
type SubmissionStatus = "idle" | "saving" | "connecting" | "awaiting_account" | "submitted";

type PointerDragGesture = {
  active: boolean;
  canvas: HTMLElement;
  elementHeight: number;
  elementWidth: number;
  element: HTMLElement;
  grabOffsetX: number;
  grabOffsetY: number;
  id: string;
  lastPointerMoveAt: number;
  lastX: number;
  lastY: number;
  moveListener: (event: PointerEvent) => void;
  finishListener: (event: PointerEvent) => void;
  blurListener: () => void;
  lostCaptureListener: () => void;
  mouseMoveListener: (event: MouseEvent) => void;
  mouseUpListener: () => void;
  pointerId: number;
  startX: number;
  startY: number;
  startScroll: number;
  slotCenters: number[];
  translateX: number;
  translateY: number;
  vertical: boolean;
  visibilityListener: () => void;
};

function syncPointerDragVisual(gesture: PointerDragGesture) {
  const bounds = gesture.element.getBoundingClientRect();
  const baseLeft = bounds.left - gesture.translateX;
  const baseTop = bounds.top - gesture.translateY;
  const rawX = gesture.lastX - gesture.grabOffsetX - baseLeft;
  const rawY = gesture.lastY - gesture.grabOffsetY - baseTop;

  gesture.translateX = gesture.vertical ? Math.max(-18, Math.min(18, rawX)) : rawX;
  gesture.translateY = gesture.vertical ? rawY : Math.max(-18, Math.min(18, rawY));
  gesture.element.style.setProperty("--drag-x", `${gesture.translateX}px`);
  gesture.element.style.setProperty("--drag-y", `${gesture.translateY}px`);
}

type ClarificationResponse = {
  answerChoice: string;
  customAnswer: string;
};

type BriefOverrides = {
  workThatSlips?: string;
  momentItHappens?: string;
  desiredOutcome?: string;
  protection?: string;
};

type ReviewEditDraft =
  | { file: 0; source: string }
  | { file: 1; workThatSlips: string; momentItHappens: string; desiredOutcome: string }
  | { file: 2; answers: string[] }
  | { file: 3; blocks: SystemBlock[] }
  | { file: 4; protection: string };

type StoredFlow = {
  version: 5;
  stage: number;
  reached: number;
  inputMode: InputMode;
  written: string;
  clarificationIndex: number;
  clarificationQuestions: TypedNoteClarification[];
  clarificationResponses: ClarificationResponse[];
  blocks: SystemBlock[];
  suggestedBlocks: SystemBlock[];
  routeCustomized: boolean;
  briefOverrides: BriefOverrides;
  emailBrief: AutomationEmailBrief | null;
  automationMethod: "ai" | "deterministic_fallback" | null;
  processingAcknowledged: boolean;
  processingNoticeVersion: string;
};

const emptyClarificationResponse: ClarificationResponse = { answerChoice: "", customAnswer: "" };
const DEFAULT_PROTECTION = "Every real request gets a timely next step, while the conversations that need judgment still reach a person with their context intact.";

function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function reviewDraftError(draft: ReviewEditDraft | null) {
  if (!draft) return "";
  if (draft.file === 0) {
    const length = draft.source.trim().length;
    if (length < MIN_TYPED_NOTE_CHARACTERS) return `Your source note needs at least ${MIN_TYPED_NOTE_CHARACTERS} characters.`;
    if (length > 20_000) return "Your source note must stay under 20,000 characters.";
  }
  if (draft.file === 1) {
    if (![draft.workThatSlips, draft.momentItHappens, draft.desiredOutcome].every((item) => item.trim().length > 0)) {
      return "Complete all three problem fields before saving.";
    }
    if ([draft.workThatSlips, draft.momentItHappens, draft.desiredOutcome].some((item) => item.length > 1_000)) {
      return "Each problem field must stay under 1,000 characters.";
    }
  }
  if (draft.file === 2 && draft.answers.some((answer) => !answer.trim() || answer.length > 500)) {
    return "Every decision needs an answer between 1 and 500 characters.";
  }
  if (draft.file === 3) {
    if (draft.blocks.length < 2) return "Keep at least two route cards.";
    if (draft.blocks.length > 20) return "A route can contain up to 20 cards.";
    if (draft.blocks.some((block) => !block.title.trim() || !block.detail.trim())) return "Every route card needs a title and description.";
    if (draft.blocks.some((block) => block.title.length > 120 || block.detail.length > 1_000)) return "Route titles must stay under 120 characters and descriptions under 1,000.";
  }
  if (draft.file === 4 && (!draft.protection.trim() || draft.protection.length > 2_000)) {
    return "Protection needs a statement between 1 and 2,000 characters.";
  }
  return "";
}

function readStoredFlow(): StoredFlow | null {
  try {
    const raw = readTabValue(FLOW_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Omit<StoredFlow, "version">> & {
      version?: number;
      answerChoice?: unknown;
      customAnswer?: unknown;
    };
    if (value.version !== 5 || typeof value.written !== "string" || !Array.isArray(value.blocks)) return null;
    const restoredResponses = Array.isArray(value.clarificationResponses)
      ? value.clarificationResponses.filter((item): item is ClarificationResponse => (
        Boolean(item)
        && typeof item.answerChoice === "string"
        && typeof item.customAnswer === "string"
      )).slice(0, MAX_CLARIFICATION_QUESTIONS)
      : [{
        answerChoice: typeof value.answerChoice === "string" ? value.answerChoice : "",
        customAnswer: typeof value.customAnswer === "string" ? value.customAnswer : "",
      }];
    const restoredQuestions = Array.isArray(value.clarificationQuestions)
      ? value.clarificationQuestions.filter((item): item is TypedNoteClarification => (
        Boolean(item)
        && typeof item.question === "string"
        && Array.isArray(item.options)
        && item.options.length === 3
        && item.options.every((option) => typeof option === "string")
      )).slice(0, MAX_CLARIFICATION_QUESTIONS)
      : value.written.trim().length >= MIN_TYPED_NOTE_CHARACTERS
        ? analyzeTypedNote(value.written).clarifications
        : [];
    const processingAcknowledged = value.processingAcknowledged === true
      && value.processingNoticeVersion === PROCESSING_NOTICE_VERSION;
    return {
      version: 5,
      stage: Math.max(0, Math.min(Number(value.stage) || 0, stages.length - 1)),
      reached: Math.max(0, Math.min(Number(value.reached) || 0, stages.length - 1)),
      inputMode: value.inputMode === "type" ? "type" : "speak",
      written: value.written,
      clarificationIndex: Math.max(0, Math.min(Number(value.clarificationIndex) || 0, MAX_CLARIFICATION_QUESTIONS - 1)),
      clarificationQuestions: restoredQuestions,
      clarificationResponses: restoredResponses,
      blocks: value.blocks.length > 0 ? value.blocks : fallbackBlocks,
      suggestedBlocks: Array.isArray(value.suggestedBlocks) && value.suggestedBlocks.length > 0 ? value.suggestedBlocks : value.blocks,
      routeCustomized: Boolean(value.routeCustomized),
      briefOverrides: value.briefOverrides && typeof value.briefOverrides === "object"
        ? Object.fromEntries(Object.entries(value.briefOverrides).filter(([, item]) => typeof item === "string"))
        : {},
      emailBrief: automationEmailBriefSchema.safeParse(value.emailBrief).success
        ? automationEmailBriefSchema.parse(value.emailBrief)
        : null,
      automationMethod: value.automationMethod === "ai" || value.automationMethod === "deterministic_fallback"
        ? value.automationMethod
        : null,
      processingAcknowledged,
      processingNoticeVersion: PROCESSING_NOTICE_VERSION,
    };
  } catch {
    return null;
  }
}

type ClerkSetActive = ReturnType<typeof useClerk>["setActive"];
type StageDirection = "forward" | "backward";

export function RecordFlow() {
  const { clerkEnabled } = useAccountAccess();

  return clerkEnabled
    ? <ConfiguredRecordFlow />
    : <RecordFlowExperience isLoaded isSignedIn={false} setActive={null} />;
}

function ConfiguredRecordFlow() {
  const { isLoaded, isSignedIn } = useAuth();
  const { setActive } = useClerk();

  return <RecordFlowExperience
    isLoaded={isLoaded}
    isSignedIn={Boolean(isSignedIn)}
    setActive={setActive}
  />;
}

function RecordFlowExperience({ isLoaded, isSignedIn, setActive }: {
  isLoaded: boolean;
  isSignedIn: boolean;
  setActive: ClerkSetActive | null;
}) {
  const { openAccountAccess } = useAccountAccess();
  const router = useRouter();
  const [stage, setStage] = useState(0);
  const [stageDirection, setStageDirection] = useState<StageDirection>("forward");
  const [reached, setReached] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>("speak");
  const [capture, setCapture] = useState<VoiceMemoCapture | null>(null);
  const [voiceRecordingActive, setVoiceRecordingActive] = useState(false);
  const [voiceTranscriptionStatus, setVoiceTranscriptionStatus] = useState<VoiceTranscriptionStatus>("idle");
  const [voiceTranscriptionError, setVoiceTranscriptionError] = useState<string | null>(null);
  const [written, setWritten] = useState("");
  const [clarificationIndex, setClarificationIndex] = useState(0);
  const [clarificationQuestions, setClarificationQuestions] = useState<TypedNoteClarification[]>([]);
  const [clarificationResponses, setClarificationResponses] = useState<ClarificationResponse[]>([]);
  const [blocks, setBlocks] = useState(fallbackBlocks);
  const [suggestedBlocks, setSuggestedBlocks] = useState(fallbackBlocks);
  const [routeCustomized, setRouteCustomized] = useState(false);
  const [briefOverrides, setBriefOverrides] = useState<BriefOverrides>({});
  const [emailBrief, setEmailBrief] = useState<AutomationEmailBrief | null>(null);
  const [automationMethod, setAutomationMethod] = useState<"ai" | "deterministic_fallback" | null>(null);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus>("idle");
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [reviewFile, setReviewFile] = useState(0);
  const [reviewDraft, setReviewDraft] = useState<ReviewEditDraft | null>(null);
  const [reviewEditMessage, setReviewEditMessage] = useState("");
  const [sourceNoteScrollable, setSourceNoteScrollable] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [mobileRouteMode, setMobileRouteMode] = useState<"edit" | "reorder">("edit");
  const [mobileActiveBlockId, setMobileActiveBlockId] = useState(fallbackBlocks[0]?.id ?? "");
  const [mobileRouteAnnouncement, setMobileRouteAnnouncement] = useState("Step 1 selected");
  const [processingAcknowledged, setProcessingAcknowledged] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [savedDraftPersistence, setSavedDraftPersistence] = useState<"session" | "memory" | null>(null);
  const [submittedBuildRequestId, setSubmittedBuildRequestId] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>("idle");
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState("Preparing this tab…");
  const [hydrated, setHydrated] = useState(false);
  const stageHeading = useRef<HTMLHeadingElement | null>(null);
  const clarificationHeading = useRef<HTMLLegendElement | null>(null);
  const previousClarificationIndex = useRef(clarificationIndex);
  const reviewTabs = useRef<Array<HTMLButtonElement | null>>([]);
  const reviewFileNav = useRef<HTMLElement | null>(null);
  const sourceNotePreview = useRef<HTMLQuoteElement | null>(null);
  const reviewEditButton = useRef<HTMLButtonElement | null>(null);
  const firstReviewEditField = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const saveErrorRef = useRef<HTMLParagraphElement | null>(null);
  const deleteErrorRef = useRef<HTMLParagraphElement | null>(null);
  const pointerDrag = useRef<PointerDragGesture | null>(null);
  const blockElements = useRef(new Map<string, HTMLElement>());
  const mobileBlockElements = useRef(new Map<string, HTMLElement>());
  const mobileRouteMap = useRef<HTMLElement | null>(null);
  const mobileRouteSteps = useRef(new Map<string, HTMLButtonElement>());
  const pendingBlockPositions = useRef<Map<string, DOMRect> | null>(null);
  const pendingBlockElementMap = useRef<Map<string, HTMLElement> | null>(null);
  const blocksRef = useRef(blocks);
  const writtenRef = useRef(written);
  const transcriptionRequest = useRef(0);
  const automationRequest = useRef(0);
  const transcriptionController = useRef<AbortController | null>(null);
  const automationController = useRef<AbortController | null>(null);
  const didMount = useRef(false);

  const cancelTranscription = useCallback(() => {
    transcriptionRequest.current += 1;
    transcriptionController.current?.abort();
    transcriptionController.current = null;
  }, []);
  const cancelAutomation = useCallback(() => {
    automationRequest.current += 1;
    automationController.current?.abort();
    automationController.current = null;
  }, []);

  useEffect(() => () => {
    cancelTranscription();
    cancelAutomation();
  }, [cancelAutomation, cancelTranscription]);

  const writtenReady = written.trim().length >= MIN_TYPED_NOTE_CHARACTERS;
  const capturedNoteReady = capture !== null && voiceTranscriptionStatus === "ready" && writtenReady;
  const noteReady = automationStatus !== "clarifying" && !voiceRecordingActive && (
    capturedNoteReady
    || (!capture && writtenReady)
  );
  const noteHint = !processingAcknowledged
    ? "Review and acknowledge the processing notice before continuing"
    : voiceRecordingActive
    ? "Finish the voice note before continuing"
    : capture && voiceTranscriptionStatus === "transcribing"
      ? "Putting your voice note into writing…"
      : capture && voiceTranscriptionStatus === "failed"
        ? voiceTranscriptionError || "Redo the note or switch to typing."
        : automationStatus === "clarifying"
          ? "Reading your note and writing the questions that change this build…"
        : noteReady
          ? undefined
          : "Record a note or write at least 21 characters to continue";
  const analysis = useMemo<TypedNoteAnalysis | null>(() => {
    if (!writtenReady) return null;
    return analyzeTypedNote(written);
  }, [written, writtenReady]);
  const effectiveProblem = {
    workThatSlips: normalizeGeneratedText(briefOverrides.workThatSlips?.trim() || analysis?.workThatSlips || "A manual handoff loses momentum before the next action is clear."),
    momentItHappens: normalizeGeneratedText(briefOverrides.momentItHappens?.trim() || analysis?.momentItHappens || "Between the first request and the person responsible for the next step."),
    desiredOutcome: normalizeGeneratedText(briefOverrides.desiredOutcome?.trim() || analysis?.desiredOutcome || "Every request has a clear next action and human handoff."),
  };
  const effectiveProtection = normalizeGeneratedText(briefOverrides.protection?.trim() || DEFAULT_PROTECTION);
  const clarifications = clarificationQuestions;
  const currentClarification = clarifications[clarificationIndex] ?? null;
  const currentResponse = clarificationResponses[clarificationIndex] ?? emptyClarificationResponse;
  const currentAnswer = currentResponse.answerChoice === "custom"
    ? currentResponse.customAnswer.trim()
    : currentResponse.answerChoice;
  const clarificationAnswers = clarifications.map((clarification, index) => {
    const response = clarificationResponses[index] ?? emptyClarificationResponse;
    return {
      question: clarification.question,
      answer: response.answerChoice === "custom" ? response.customAnswer.trim() : response.answerChoice,
    };
  });
  const allClarificationsReady = writtenReady
    && clarifications.length > 0
    && clarificationAnswers.every((item) => item.answer.length > 0);
  const hasHumanHandoff = blocks.some((block) => block.kind === "handoff");
  const routeReady = blocks.length >= 2
    && hasHumanHandoff
    && blocks.every((block) => block.title.trim().length > 0 && block.detail.trim().length > 0);
  const questionsNeedRefresh = stage === 1 && writtenReady && automationMethod === null;
  const currentReviewDraftError = reviewDraftError(reviewDraft);
  const resolvedMobileActiveBlockId = blocks.some((block) => block.id === mobileActiveBlockId)
    ? mobileActiveBlockId
    : blocks[0]?.id ?? "";
  const mobileActiveIndex = Math.max(0, blocks.findIndex((block) => block.id === resolvedMobileActiveBlockId));
  const mobileActiveBlock = blocks[mobileActiveIndex] ?? blocks[0] ?? null;
  const sourceNoteText = written.trim();
  const sourceCharacterCount = sourceNoteText.length;
  const sourceWordCount = sourceNoteText ? sourceNoteText.split(/\s+/).length : 0;
  const humanHandoffs = blocks.filter((block) => block.kind === "handoff").length;
  const canRemoveBlock = (block: SystemBlock, route = blocks) => route.length > 2
    && (block.kind !== "handoff" || route.filter((item) => item.kind === "handoff").length > 1);
  const handoffTitle = `${blocks[0]?.title ?? "Your workflow"} → ${blocks.at(-1)?.title ?? "human handoff"}`;
  const handoffOverview = effectiveProblem.desiredOutcome;
  const receiptReference = savedDraftId ? savedDraftId.slice(0, 8).toUpperCase() : "DRAFT";
  const buildReference = submittedBuildRequestId?.slice(0, 8).toUpperCase() || receiptReference;
  const submittedLabel = submittedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(submittedAt))
    : null;
  const handoffComplete = submissionStatus === "submitted";
  const handoffButtonLabel = saving
    ? submissionStatus === "connecting" ? "Sending to Ajani…" : "Saving your build brief…"
    : handoffComplete
      ? "Open your workspace"
      : savedDraftId
        ? isLoaded && isSignedIn ? "Retry sending to Ajani" : "Continue to account"
        : "Send to Ajani";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storageAvailable = LEGACY_FLOW_STORAGE_KEYS.map(removeTabValue).every(Boolean);
      const stored = readStoredFlow();
      if (stored) {
        const pendingDraft = getSavedWebsiteRequestDraft();
        const restoredStage = stored.processingAcknowledged
          && stored.written.trim().length >= MIN_TYPED_NOTE_CHARACTERS
          ? stored.stage
          : 0;
        setStage(restoredStage);
        setReached(stored.processingAcknowledged ? Math.max(restoredStage, stored.reached) : 0);
        setInputMode(stored.inputMode);
        setWritten(stored.written);
        setClarificationIndex(stored.clarificationIndex);
        setClarificationQuestions(stored.clarificationQuestions);
        setClarificationResponses(stored.clarificationResponses);
        setBlocks(stored.blocks);
        setSuggestedBlocks(stored.suggestedBlocks);
        setRouteCustomized(stored.routeCustomized);
        setBriefOverrides(stored.briefOverrides);
        setEmailBrief(stored.emailBrief);
        setAutomationMethod(stored.automationMethod);
        setProcessingAcknowledged(stored.processingAcknowledged);
        setAutomationStatus(stored.automationMethod === "deterministic_fallback" ? "fallback" : stored.automationMethod ? "ready" : "idle");
        if (pendingDraft && restoredStage === 4) {
          setSavedDraftId(pendingDraft.id);
          setSavedDraftPersistence(pendingDraft.persistence);
          setSubmissionStatus("awaiting_account");
        }
        setSaveStatus("Restored from this tab");
      } else {
        setSaveStatus(storageAvailable ? "Saved in this tab" : "Keep this tab open to keep your progress");
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stage !== 2 || !window.matchMedia("(max-width: 700px)").matches) return;
    const map = mobileRouteMap.current;
    const activeStep = mobileRouteSteps.current.get(resolvedMobileActiveBlockId);
    if (!map || !activeStep) return;

    const frame = window.requestAnimationFrame(() => {
      const mapBounds = map.getBoundingClientRect();
      const stepBounds = activeStep.getBoundingClientRect();
      const left = map.scrollLeft + stepBounds.left - mapBounds.left - (mapBounds.width - stepBounds.width) / 2;
      map.scrollTo({ behavior: "smooth", left: Math.max(0, left) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resolvedMobileActiveBlockId, stage]);

  useEffect(() => {
    if (stage !== 3 || !window.matchMedia("(max-width: 700px)").matches) return;
    const nav = reviewFileNav.current;
    const activeTab = reviewTabs.current[reviewFile];
    if (!nav || !activeTab) return;

    const frame = window.requestAnimationFrame(() => {
      const navBounds = nav.getBoundingClientRect();
      const tabBounds = activeTab.getBoundingClientRect();
      const left = nav.scrollLeft + tabBounds.left - navBounds.left - (navBounds.width - tabBounds.width) / 2;
      nav.scrollTo({ behavior: "smooth", left: Math.max(0, left) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reviewFile, stage]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const state: StoredFlow = {
        version: 5,
        stage,
        reached,
        inputMode,
        written,
        clarificationIndex,
        clarificationQuestions,
        clarificationResponses,
        blocks,
        suggestedBlocks,
        routeCustomized,
        briefOverrides,
        emailBrief,
        automationMethod,
        processingAcknowledged,
        processingNoticeVersion: PROCESSING_NOTICE_VERSION,
      };
      const saved = writeTabValue(FLOW_STORAGE_KEY, JSON.stringify(state));
      setSaveStatus(saved ? "Saved in this tab" : "Keep this tab open to keep your progress");
    }, 320);
    return () => window.clearTimeout(timer);
  }, [automationMethod, blocks, briefOverrides, clarificationIndex, clarificationQuestions, clarificationResponses, emailBrief, hydrated, inputMode, processingAcknowledged, reached, routeCustomized, stage, suggestedBlocks, written]);

  useEffect(() => {
    return () => {
      if (capture?.objectUrl) URL.revokeObjectURL(capture.objectUrl);
    };
  }, [capture]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    stageHeading.current?.focus();
  }, [handoffComplete, stage]);

  useEffect(() => {
    if (saveError) saveErrorRef.current?.focus();
    else if (deleteError) deleteErrorRef.current?.focus();
  }, [deleteError, saveError]);

  useEffect(() => {
    const previous = previousClarificationIndex.current;
    previousClarificationIndex.current = clarificationIndex;
    if (stage !== 1 || previous === clarificationIndex) return;
    const frame = window.requestAnimationFrame(() => clarificationHeading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [clarificationIndex, stage]);

  useLayoutEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useLayoutEffect(() => {
    writtenRef.current = written;
  }, [written]);

  useLayoutEffect(() => {
    const node = sourceNotePreview.current;
    if (stage !== 3 || reviewFile !== 0 || reviewDraft?.file === 0 || !node) {
      setSourceNoteScrollable(false);
      return;
    }

    const measure = () => setSourceNoteScrollable(node.scrollHeight > node.clientHeight + 1);
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [reviewDraft?.file, reviewFile, stage, written]);

  useLayoutEffect(() => {
    const previous = pendingBlockPositions.current;
    const animatedElements = pendingBlockElementMap.current ?? blockElements.current;
    pendingBlockPositions.current = null;
    pendingBlockElementMap.current = null;
    const gesture = pointerDrag.current;
    if (gesture?.active) syncPointerDragVisual(gesture);
    if (!previous) return;
    if (getReducedMotionPreference()) return;

    for (const [id, element] of animatedElements) {
      if (id === dragged) continue;
      const before = previous.get(id);
      if (!before) continue;
      const after = element.getBoundingClientRect();
      const deltaX = before.left - after.left;
      const deltaY = before.top - after.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
      element.animate([
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ], { duration: 260, easing: "cubic-bezier(.22, .8, .28, 1)" });
    }

  }, [blocks, dragged]);

  const go = (index: number) => {
    const target = Math.max(0, Math.min(index, stages.length - 1));
    if (target > 0 && !processingAcknowledged) return;
    if (reviewDraft && target !== stage) {
      setReviewEditMessage("Save or cancel this file before leaving the development brief.");
      firstReviewEditField.current?.focus();
      return;
    }
    // A result belongs to the step/input snapshot that requested it.
    cancelAutomation();
    setAutomationStatus((current) => current === "clarifying" || current === "shaping"
      ? automationMethod === "ai" ? "ready" : automationMethod === "deterministic_fallback" ? "fallback" : "idle"
      : current);
    if (target === 1 && clarifications.length > 0) {
      setClarificationResponses((current) => clarifications.map((clarification, questionIndex) => {
        const existing = current[questionIndex];
        if (existing?.answerChoice === "custom" || (existing?.answerChoice && clarification.options.includes(existing.answerChoice))) {
          return existing;
        }
        return emptyClarificationResponse;
      }));
      setClarificationIndex(0);
    }
    if (target !== stage) setStageDirection(target > stage ? "forward" : "backward");
    setStage(target);
    setReached((high) => Math.max(high, target));
  };

  const chooseInputMode = (mode: InputMode) => {
    if (mode === inputMode) return;
    cancelAutomation();
    setAutomationStatus(automationMethod === "ai" ? "ready" : automationMethod === "deterministic_fallback" ? "fallback" : "idle");
    if (mode === "type") {
      cancelTranscription();
      setCapture(null);
      setVoiceTranscriptionStatus("idle");
      setVoiceTranscriptionError(null);
    }
    setInputMode(mode);
  };

  const continueFromNote = async () => {
    if (!processingAcknowledged) return;
    if (capture && (!writtenReady || voiceTranscriptionStatus !== "ready")) return;
    if (!writtenReady || automationStatus === "clarifying") return;
    if (automationMethod && clarifications.length > 0) {
      go(1);
      return;
    }

    cancelAutomation();
    const requestId = automationRequest.current;
    const controller = new AbortController();
    automationController.current = controller;
    setAutomationStatus("clarifying");
    setAutomationError(null);
    try {
      const result = await requestAutomationClarifications(
        written.trim(),
        CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT,
        controller.signal,
      );
      if (automationRequest.current !== requestId) return;
      setClarificationQuestions(asTypedClarifications(result));
      setClarificationResponses([]);
      setClarificationIndex(0);
      setBriefOverrides(result.problem);
      setAutomationMethod(result.method);
      setAutomationStatus(result.method === "ai" ? "ready" : "fallback");
      setSaveStatus(result.method === "ai" ? "AI questions ready · saved in this tab" : "Editable fallback ready · saved in this tab");
    } catch (error) {
      if (automationRequest.current !== requestId) return;
      const result = fallbackAutomationIntake(written.trim());
      setClarificationQuestions(asTypedClarifications(result));
      setClarificationResponses([]);
      setClarificationIndex(0);
      setBriefOverrides(result.problem);
      setAutomationMethod(result.method);
      setAutomationStatus("fallback");
      setAutomationError(error instanceof Error ? error.message : "AI analysis is temporarily unavailable.");
    } finally {
      if (automationRequest.current === requestId) automationController.current = null;
    }
    setStage(1);
    setReached((high) => Math.max(high, 1));
  };

  const updateWritten = (value: string) => {
    cancelAutomation();
    writtenRef.current = value;
    setWritten(value);
    setReached((high) => Math.min(high, stage));
    setEmailBrief(null);
    setSuggestedBlocks(fallbackBlocks);
    setAutomationMethod(null);
    setAutomationStatus("idle");
    setAutomationError(null);
    if (value.trim().length < MIN_TYPED_NOTE_CHARACTERS) {
      setBlocks(fallbackBlocks);
      setRouteCustomized(false);
      setBriefOverrides({});
      setClarificationQuestions([]);
      setClarificationIndex(0);
      setClarificationResponses([]);
      return;
    }
    if (stage === 0) {
      setBlocks(fallbackBlocks);
      setRouteCustomized(false);
      setBriefOverrides({});
      setClarificationQuestions([]);
      setClarificationIndex(0);
      setClarificationResponses([]);
    }
  };

  const resetVoiceCapture = () => {
    cancelTranscription();
    setCapture(null);
    setVoiceTranscriptionStatus("idle");
    setVoiceTranscriptionError(null);
  };

  const handleVoiceCaptured = async (nextCapture: VoiceMemoCapture) => {
    if (!processingAcknowledged) return;
    cancelTranscription();
    const requestId = transcriptionRequest.current;
    setCapture(nextCapture);
    setVoiceTranscriptionError(null);

    if (nextCapture.transcriptSource === "manual") {
      const enoughDetail = writtenRef.current.trim().length >= MIN_TYPED_NOTE_CHARACTERS;
      setVoiceTranscriptionStatus(enoughDetail ? "ready" : "failed");
      if (!enoughDetail) setVoiceTranscriptionError("Your edits are preserved. Switch to typing to add a little more detail before continuing.");
      return;
    }

    setVoiceTranscriptionStatus("transcribing");
    const controller = new AbortController();
    transcriptionController.current = controller;
    try {
      const transcript = await transcribeCapturedVoiceMemo(
        nextCapture.blob,
        CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT,
        controller.signal,
      );
      if (transcriptionRequest.current !== requestId) return;
      if (transcript.length < MIN_TYPED_NOTE_CHARACTERS) {
        throw new Error("We heard the note, but it needs a little more detail before Clarify.");
      }
      updateWritten(transcript);
      setVoiceTranscriptionStatus("ready");
    } catch (error) {
      if (transcriptionRequest.current !== requestId) return;
      if (writtenRef.current.trim().length >= MIN_TYPED_NOTE_CHARACTERS) {
        setVoiceTranscriptionStatus("ready");
        return;
      }
      setVoiceTranscriptionStatus("failed");
      setVoiceTranscriptionError(error instanceof Error ? error.message : "We could not put this voice note into writing.");
    } finally {
      if (transcriptionRequest.current === requestId) transcriptionController.current = null;
    }
  };

  const updateBlock = (id: string, field: "title" | "detail", value: string) => {
    setRouteCustomized(true);
    setReached((high) => Math.min(high, 2));
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, [field]: value } : block)));
  };

  const captureBlockPositions = (elements = blockElements.current) => {
    pendingBlockElementMap.current = elements;
    pendingBlockPositions.current = new Map(
      Array.from(elements, ([id, element]) => [id, element.getBoundingClientRect()]),
    );
  };

  const moveBlock = (id: string, direction: -1 | 1, elements = blockElements.current) => {
    captureBlockPositions(elements);
    setRouteCustomized(true);
    setReached((high) => Math.min(high, 2));
    setBlocks((current) => {
      const currentIndex = current.findIndex((block) => block.id === id);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
      return next;
    });
  };

  const movePointerDrag = (event: PointerEvent | MouseEvent, fromMouse = false) => {
    const gesture = pointerDrag.current;
    if (!gesture) return;
    if (event instanceof PointerEvent) {
      if (gesture.pointerId !== event.pointerId) return;
      gesture.lastPointerMoveAt = event.timeStamp;
    } else if (!fromMouse || event.timeStamp - gesture.lastPointerMoveAt < 40) {
      return;
    }
    if (!gesture.active) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (distance < 4) return;
      gesture.active = true;
      flushSync(() => setDragged(gesture.id));
    }

    event.preventDefault();
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    syncPointerDragVisual(gesture);

    const axis = gesture.vertical
      ? event.clientY - gesture.grabOffsetY + gesture.elementHeight / 2
      : event.clientX - gesture.grabOffsetX + gesture.elementWidth / 2;
    const currentScroll = gesture.vertical ? gesture.canvas.scrollTop : gesture.canvas.scrollLeft;
    const scrollDelta = currentScroll - gesture.startScroll;
    let targetIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    gesture.slotCenters.forEach((slotCenter, index) => {
      const distance = Math.abs(axis - (slotCenter - scrollDelta));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        targetIndex = index;
      }
    });

    const current = blocksRef.current;
    const currentIndex = current.findIndex((block) => block.id === gesture.id);
    if (currentIndex >= 0 && targetIndex !== currentIndex && targetIndex < current.length) {
      captureBlockPositions(gesture.vertical ? mobileBlockElements.current : blockElements.current);
      const next = [...current];
      const [moving] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, moving);
      blocksRef.current = next;
      setBlocks(next);
      setRouteCustomized(true);
      setReached((high) => Math.min(high, 2));
    }

    if (!gesture.vertical) {
      const bounds = gesture.canvas.getBoundingClientRect();
      const edge = Math.min(96, bounds.width * .15);
      if (event.clientX < bounds.left + edge) gesture.canvas.scrollBy({ left: -24 });
      if (event.clientX > bounds.right - edge) gesture.canvas.scrollBy({ left: 24 });
    }
  };

  const finishPointerDrag = (event?: PointerEvent) => {
    const gesture = pointerDrag.current;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    window.removeEventListener("pointermove", gesture.moveListener, true);
    window.removeEventListener("mousemove", gesture.mouseMoveListener, true);
    window.removeEventListener("pointerup", gesture.finishListener, true);
    window.removeEventListener("pointercancel", gesture.finishListener, true);
    window.removeEventListener("mouseup", gesture.mouseUpListener, true);
    window.removeEventListener("blur", gesture.blurListener);
    document.removeEventListener("visibilitychange", gesture.visibilityListener);
    gesture.element.removeEventListener("lostpointercapture", gesture.lostCaptureListener);
    pointerDrag.current = null;
    try {
      if (gesture.element.hasPointerCapture(gesture.pointerId)) {
        gesture.element.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // The global pointer/mouse listeners still provide a complete fallback.
    }
    gesture.element.style.removeProperty("--drag-x");
    gesture.element.style.removeProperty("--drag-y");
    if (gesture.active && event?.cancelable) event.preventDefault();
    if (gesture.active && gesture.vertical) {
      const finalIndex = blocksRef.current.findIndex((block) => block.id === gesture.id);
      const movedBlock = blocksRef.current[finalIndex];
      if (movedBlock && finalIndex >= 0) {
        setMobileRouteAnnouncement(`${movedBlock.title} moved to step ${finalIndex + 1}`);
      }
    }
    flushSync(() => setDragged(null));
  };

  const startPointerDrag = (event: React.PointerEvent<HTMLElement>, id: string, orientation?: "horizontal" | "vertical") => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("button, select, a, [contenteditable='true']")) return;
    if (orientation === "vertical" && !target.closest(`.${styles.mobileDragHandle}`)) return;
    finishPointerDrag();

    const element = event.currentTarget;
    const canvas = element.parentElement;
    if (!canvas) return;
    const pointerId = Number.isFinite(event.nativeEvent.pointerId)
      ? event.nativeEvent.pointerId
      : event.pointerId;
    const bounds = element.getBoundingClientRect();
    const vertical = orientation ? orientation === "vertical" : window.matchMedia("(max-width: 700px)").matches;
    const slotCenters = Array.from(canvas.children, (child) => {
      const childBounds = (child as HTMLElement).getBoundingClientRect();
      return vertical
        ? childBounds.top + childBounds.height / 2
        : childBounds.left + childBounds.width / 2;
    });
    const gesture: PointerDragGesture = {
      active: !target.closest("input, textarea"),
      blurListener: () => undefined,
      canvas,
      elementHeight: bounds.height,
      elementWidth: bounds.width,
      element,
      finishListener: () => undefined,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      id,
      lastPointerMoveAt: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      lostCaptureListener: () => undefined,
      mouseMoveListener: () => undefined,
      mouseUpListener: () => undefined,
      moveListener: () => undefined,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: vertical ? canvas.scrollTop : canvas.scrollLeft,
      slotCenters,
      translateX: 0,
      translateY: 0,
      vertical,
      visibilityListener: () => undefined,
    };
    gesture.moveListener = (nativeEvent) => movePointerDrag(nativeEvent);
    gesture.finishListener = (nativeEvent) => finishPointerDrag(nativeEvent);
    gesture.blurListener = () => finishPointerDrag();
    // React may move the keyed card node while its pointer is captured. Some
    // browsers report that DOM move as lost capture even though the pointer is
    // still down, so global pointerup/cancel/blur listeners own completion.
    gesture.lostCaptureListener = () => undefined;
    gesture.mouseMoveListener = (nativeEvent) => movePointerDrag(nativeEvent, true);
    gesture.mouseUpListener = () => finishPointerDrag();
    gesture.visibilityListener = () => {
      if (document.visibilityState !== "visible") finishPointerDrag();
    };
    pointerDrag.current = gesture;
    if (gesture.active) flushSync(() => setDragged(id));

    window.addEventListener("pointermove", gesture.moveListener, { capture: true, passive: false });
    window.addEventListener("mousemove", gesture.mouseMoveListener, { capture: true, passive: false });
    window.addEventListener("pointerup", gesture.finishListener, true);
    window.addEventListener("pointercancel", gesture.finishListener, true);
    window.addEventListener("mouseup", gesture.mouseUpListener, true);
    window.addEventListener("blur", gesture.blurListener);
    document.addEventListener("visibilitychange", gesture.visibilityListener);
    element.addEventListener("lostpointercapture", gesture.lostCaptureListener);
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Some embedded browsers do not expose pointer capture consistently.
    }
  };

  useEffect(() => () => {
    const gesture = pointerDrag.current;
    if (!gesture) return;
    window.removeEventListener("pointermove", gesture.moveListener, true);
    window.removeEventListener("mousemove", gesture.mouseMoveListener, true);
    window.removeEventListener("pointerup", gesture.finishListener, true);
    window.removeEventListener("pointercancel", gesture.finishListener, true);
    window.removeEventListener("mouseup", gesture.mouseUpListener, true);
    window.removeEventListener("blur", gesture.blurListener);
    document.removeEventListener("visibilitychange", gesture.visibilityListener);
    gesture.element.removeEventListener("lostpointercapture", gesture.lostCaptureListener);
    pointerDrag.current = null;
  }, []);

  const selectReviewFile = (index: number, focus = false) => {
    const next = Math.max(0, Math.min(index, reviewFiles.length - 1));
    if (reviewDraft && next !== reviewFile) {
      setReviewEditMessage("Save or cancel this file before opening another brief file.");
      firstReviewEditField.current?.focus();
      return;
    }
    setReviewFile(next);
    setReviewEditMessage("");
    if (focus) reviewTabs.current[next]?.focus();
  };

  const startReviewEdit = () => {
    const nextDraft: ReviewEditDraft = reviewFile === 0
      ? { file: 0, source: written }
      : reviewFile === 1
        ? { file: 1, ...effectiveProblem }
        : reviewFile === 2
          ? { file: 2, answers: clarificationAnswers.map((item) => item.answer) }
          : reviewFile === 3
            ? { file: 3, blocks: blocks.map((block) => ({ ...block })) }
            : { file: 4, protection: effectiveProtection };
    setReviewDraft(nextDraft);
    setReviewEditMessage("");
    window.requestAnimationFrame(() => firstReviewEditField.current?.focus());
  };

  const cancelReviewEdit = () => {
    setReviewDraft(null);
    setReviewEditMessage("Changes discarded.");
    window.requestAnimationFrame(() => reviewEditButton.current?.focus());
  };

  const saveReviewEdit = () => {
    if (!reviewDraft || reviewDraftError(reviewDraft)) return;
    if (reviewDraft.file === 0) {
      setBriefOverrides((current) => ({
        workThatSlips: current.workThatSlips || effectiveProblem.workThatSlips,
        momentItHappens: current.momentItHappens || effectiveProblem.momentItHappens,
        desiredOutcome: current.desiredOutcome || effectiveProblem.desiredOutcome,
        protection: current.protection || effectiveProtection,
      }));
      setWritten(reviewDraft.source.trim());
      setInputMode("type");
    }
    if (reviewDraft.file === 1) {
      setBriefOverrides((current) => ({
        ...current,
        workThatSlips: reviewDraft.workThatSlips.trim(),
        momentItHappens: reviewDraft.momentItHappens.trim(),
        desiredOutcome: reviewDraft.desiredOutcome.trim(),
      }));
    }
    if (reviewDraft.file === 2) {
      setClarificationResponses(reviewDraft.answers.map((answer) => ({ answerChoice: "custom", customAnswer: answer.trim() })));
    }
    if (reviewDraft.file === 3) {
      setBlocks(reviewDraft.blocks.map((block) => ({ ...block, title: block.title.trim(), detail: block.detail.trim() })));
      setRouteCustomized(true);
    }
    if (reviewDraft.file === 4) {
      setBriefOverrides((current) => ({ ...current, protection: reviewDraft.protection.trim() }));
    }
    setEmailBrief(null);
    setReached((high) => Math.min(high, 3));
    setReviewDraft(null);
    setReviewEditMessage("Changes saved in this tab.");
    setSaveStatus("Development brief saved");
    window.requestAnimationFrame(() => reviewEditButton.current?.focus());
  };

  const updateReviewRouteBlock = (id: string, field: "title" | "detail", value: string) => {
    setReviewDraft((current) => current?.file === 3
      ? { ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, [field]: value } : block) }
      : current);
  };

  const moveReviewRouteBlock = (id: string, position: number) => {
    setReviewDraft((current) => {
      if (current?.file !== 3) return current;
      const from = current.blocks.findIndex((block) => block.id === id);
      const to = Math.max(0, Math.min(position, current.blocks.length - 1));
      if (from < 0 || from === to) return current;
      const blocks = [...current.blocks];
      const [block] = blocks.splice(from, 1);
      blocks.splice(to, 0, block);
      return { ...current, blocks };
    });
  };

  const onReviewPanelKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!reviewDraft) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelReviewEdit();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !currentReviewDraftError) {
      event.preventDefault();
      saveReviewEdit();
    }
  };

  const onReviewFileKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      selectReviewFile((index + 1) % reviewFiles.length, true);
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectReviewFile((index - 1 + reviewFiles.length) % reviewFiles.length, true);
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectReviewFile(0, true);
    }
    if (event.key === "End") {
      event.preventDefault();
      selectReviewFile(reviewFiles.length - 1, true);
    }
  };

  const addBlock = () => {
    if (blocks.length >= 20) {
      setSaveStatus("A route can contain up to 20 steps");
      return;
    }
    setRouteCustomized(true);
    setReached((high) => Math.min(high, 2));
    const id = `step-${Date.now()}`;
    setBlocks((current) => [...current, {
      id,
      kind: hasHumanHandoff ? "custom" : "handoff",
      title: hasHumanHandoff ? "New step" : "Human handoff",
      detail: hasHumanHandoff ? "Describe what should happen here." : "Send exceptions and decisions requiring judgment to a person with the full context.",
    }]);
    setMobileActiveBlockId(id);
    setMobileRouteMode("edit");
    setMobileRouteAnnouncement(`Step ${blocks.length + 1} added and selected`);
  };

  const resetRoute = () => {
    const suggestedRoute = suggestedBlocks.length > 0 ? suggestedBlocks : analysis?.systemBlocks ?? fallbackBlocks;
    setBlocks(suggestedRoute);
    setRouteCustomized(false);
    setReached((high) => Math.min(high, 2));
    setMobileActiveBlockId(suggestedRoute[0]?.id ?? "");
    setMobileRouteMode("edit");
    setMobileRouteAnnouncement("Suggested route restored. Step 1 selected");
  };

  const removeBlock = (id: string) => {
    const currentIndex = blocks.findIndex((block) => block.id === id);
    if (currentIndex < 0) return;
    const block = blocks[currentIndex];
    if (!canRemoveBlock(block)) {
      setSaveStatus(block.kind === "handoff" ? "Keep one human handoff in the route" : "A route needs at least two steps");
      setMobileRouteAnnouncement(block.kind === "handoff" ? "The route must keep one human handoff" : "The route must keep at least two steps");
      return;
    }
    const nextBlocks = blocks.filter((block) => block.id !== id);
    const nextIndex = Math.min(currentIndex, nextBlocks.length - 1);
    setRouteCustomized(true);
    setReached((high) => Math.min(high, 2));
    setBlocks(nextBlocks);
    if (mobileActiveBlockId === id) {
      setMobileActiveBlockId(nextBlocks[nextIndex]?.id ?? "");
      setMobileRouteAnnouncement(`Step removed. Step ${nextIndex + 1} selected`);
    }
  };

  const updateClarificationResponse = (update: Partial<ClarificationResponse>) => {
    cancelAutomation();
    setAutomationStatus(automationMethod === "ai" ? "ready" : automationMethod === "deterministic_fallback" ? "fallback" : "idle");
    setEmailBrief(null);
    setClarificationResponses((current) => {
      const next = [...current];
      next[clarificationIndex] = { ...(next[clarificationIndex] ?? emptyClarificationResponse), ...update };
      return next;
    });
    setReached((high) => Math.min(high, 1));
  };

  const advanceClarification = async () => {
    if (!processingAcknowledged) {
      go(0);
      return;
    }
    if (!currentAnswer) return;
    if (clarificationIndex < clarifications.length - 1) {
      setClarificationIndex((current) => current + 1);
      return;
    }
    if (!allClarificationsReady) {
      const missing = clarificationAnswers.findIndex((item) => !item.answer);
      if (missing >= 0) setClarificationIndex(missing);
      return;
    }
    if (automationStatus === "shaping") return;
    cancelAutomation();
    const requestId = automationRequest.current;
    const controller = new AbortController();
    automationController.current = controller;
    setAutomationStatus("shaping");
    setAutomationError(null);
    let result;
    try {
      result = await requestAutomationShape(
        written.trim(),
        clarificationAnswers,
        CURRENT_PROCESSING_NOTICE_ACKNOWLEDGMENT,
        controller.signal,
      );
      if (automationRequest.current !== requestId) return;
    } catch (error) {
      if (automationRequest.current !== requestId) return;
      result = fallbackAutomationShape(written.trim(), clarificationAnswers);
      setAutomationError(error instanceof Error ? error.message : "AI route generation is temporarily unavailable.");
    } finally {
      if (automationRequest.current === requestId) automationController.current = null;
    }
    setBriefOverrides({ ...result.problem, protection: result.protection });
    setBlocks(result.systemBlocks);
    setSuggestedBlocks(result.systemBlocks);
    setRouteCustomized(false);
    setEmailBrief(result.emailBrief);
    setAutomationMethod(result.method);
    setAutomationStatus(result.method === "ai" ? "ready" : "fallback");
    setSaveStatus(result.method === "ai" ? "AI route ready · saved in this tab" : "Editable fallback ready · saved in this tab");
    setMobileActiveBlockId(result.systemBlocks[0]?.id ?? "");
    go(2);
  };

  const sendRequest = async () => {
    if (saving || !writtenReady || !allClarificationsReady) return;
    if (!legalAccepted) {
      setSaveError("Review and accept the Terms, Acceptable Use Policy, and Privacy Policy before sending your request.");
      return;
    }
    if (submissionStatus === "submitted") {
      router.push("/portal");
      return;
    }
    setSaving(true);
    setSaveError(null);

    try {
      let draftId = savedDraftId;
      const existingDraftNeedsAcknowledgment = Boolean(draftId);
      if (!draftId) {
        setSubmissionStatus("saving");
        const firstStep = blocks[0]?.title ?? "Your request";
        const finalStep = blocks.at(-1)?.title ?? "human handoff";
        const clarificationAnswer = clarificationAnswers.map((item) => item.answer).join("\n").slice(0, 2_000);
        const draft = await saveWebsiteRequestDraft({
          legalAcceptanceAcknowledged: true,
          legalAcceptanceVersions: CURRENT_HANDOFF_POLICY_VERSION,
          title: `${firstStep} → ${finalStep}`.slice(0, 120),
          transcript: written.trim(),
          clarificationAnswer,
          clarificationAnswers,
          developmentBrief: {
            ...effectiveProblem,
            protection: effectiveProtection,
          },
          emailBrief: approvedAutomationEmailBrief(blocks, effectiveProblem, routeCustomized ? null : emailBrief),
          systemBlocks: blocks,
          voiceMemo: capture ? {
            durationSeconds: capture.seconds,
            byteLength: capture.bytes,
            mimeType: capture.mimeType,
          } : null,
        }, capture?.blob);
        draftId = draft.id;
        setSavedDraftId(draft.id);
        setSavedDraftPersistence(getSavedWebsiteRequestDraft()?.persistence ?? "memory");
      }

      if (existingDraftNeedsAcknowledgment) {
        await acknowledgeSavedWebsiteRequestDraft(CURRENT_HANDOFF_POLICY_VERSION, draftId);
      }

      if (isLoaded && isSignedIn) {
        setSubmissionStatus("connecting");
        let result = await claimSavedWebsiteRequestDraft(draftId);
        if (result.status === "organization_activation_required" && result.organizationId) {
          if (!setActive) throw new Error("Account access is unavailable. Please retry.");
          await setActive({ organization: result.organizationId });
          result = await claimSavedWebsiteRequestDraft(draftId);
        }
        if (result.status !== "submitted") {
          throw new Error(result.error || "Your request was saved, but Ajani has not received it yet. Please retry.");
        }
        clearSavedWebsiteRequestCapability(draftId);
        removeTabValue(FLOW_STORAGE_KEY);
        setSubmittedBuildRequestId(result.buildRequest?.build_request_id ?? draftId);
        setSubmittedAt(result.buildRequest?.build_request_created_at ?? new Date().toISOString());
        setSubmissionStatus("submitted");
      } else {
        setSubmissionStatus("awaiting_account");
        // Let the user see the persistence warning before starting an auth
        // method which might navigate away and lose this memory-only capability.
        if (!existingDraftNeedsAcknowledgment && getSavedWebsiteRequestDraft()?.persistence === "memory") return;
        openAccountAccess("request", "/portal?handoff=pending");
      }
    } catch (error) {
      setSubmissionStatus(savedDraftId ? "awaiting_account" : "idle");
      setSaveError(error instanceof Error ? error.message : "Your request could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSavedRequest = async () => {
    if (!savedDraftId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSavedWebsiteRequestDraft();
      removeTabValue(FLOW_STORAGE_KEY);
      setSavedDraftId(null);
      setSavedDraftPersistence(null);
      setSubmittedBuildRequestId(null);
      setSubmissionStatus("idle");
      setSubmittedAt(null);
      setProcessingAcknowledged(false);
      setLegalAccepted(false);
      setStage(0);
      setReached(0);
      setInputMode("speak");
      cancelTranscription();
      cancelAutomation();
      setCapture(null);
      setVoiceRecordingActive(false);
      setVoiceTranscriptionStatus("idle");
      setVoiceTranscriptionError(null);
      setWritten("");
      setClarificationIndex(0);
      setClarificationResponses([]);
      setBlocks(fallbackBlocks);
      setSuggestedBlocks(fallbackBlocks);
      setRouteCustomized(false);
      setBriefOverrides({});
      setEmailBrief(null);
      setAutomationMethod(null);
      setAutomationStatus("idle");
      setAutomationError(null);
      setSaveStatus("Deleted from this tab and private storage");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "The saved request could not be deleted.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      aria-busy={!hydrated}
      className={styles.flow}
      data-hydrated={hydrated ? "true" : "false"}
      inert={hydrated ? undefined : true}
    >
      <nav aria-label="Build request progress" className={styles.steps}>
        <div className={styles.mobileProgress}>
          <span>{handoffComplete ? "Request complete" : `Step ${stage + 1} of ${stages.length}`}</span>
          <b>{handoffComplete ? "Received" : stages[stage]}</b>
          <i aria-hidden="true"><span style={{ width: `${((stage + 1) / stages.length) * 100}%` }} /></i>
        </div>
        <ol>
          {stages.map((name, index) => {
            const state = index === stage ? "current" : index <= reached ? "done" : "locked";
            return (
              <li data-rail={index < reached ? "on" : "off"} data-state={state} key={name}>
                <button
                  aria-current={index === stage ? "step" : undefined}
                  disabled={!hydrated || (!processingAcknowledged && index > 0) || (savedDraftId ? index !== stage : index > reached)}
                  onClick={() => go(index)}
                  type="button"
                >
                  <i aria-hidden="true">{index < stage ? "✓" : `0${index + 1}`}</i>
                  <b>{name}</b>
                </button>
              </li>
            );
          })}
        </ol>
        <span aria-live="polite" className={styles.tabSaveStatus} role="status"><i aria-hidden="true" />{saveStatus}</span>
      </nav>

      {stage === 0 ? (
        <Stage
          copy="Speak or type it exactly as it happens. Ajani will turn the messy part into a route you can review."
          direction={stageDirection}
          eyebrow="01 / Tell us"
          headingRef={stageHeading}
          key="s0"
          title={<>Tell us where the work <em>gets stuck.</em></>}
        >
          <div className={styles.modeSwitch} role="group" aria-label="Choose how to share your note">
            <button aria-pressed={inputMode === "speak"} disabled={!hydrated} onClick={() => chooseInputMode("speak")} type="button">Speak</button>
            <button aria-pressed={inputMode === "type"} disabled={!hydrated} onClick={() => chooseInputMode("type")} type="button">Type</button>
          </div>

          <p className={styles.processingDisclosure}>
            <i aria-hidden="true" />
            Your note may be sent to Ajani&apos;s transcription or AI providers to create editable text, questions, and a proposed route. Do not include sensitive or regulated personal information. <Link href="/privacy#notice-at-collection">How processing works</Link>.
          </p>

          <div className={styles.processingConsent}>
            <input
              checked={processingAcknowledged}
              disabled={voiceRecordingActive}
              id="request-processing-acceptance"
              onChange={(event) => {
                setProcessingAcknowledged(event.target.checked);
                if (!event.target.checked) {
                  cancelAutomation();
                  setAutomationStatus("idle");
                  cancelTranscription();
                  if (voiceTranscriptionStatus === "transcribing") {
                    setVoiceTranscriptionStatus("failed");
                    setVoiceTranscriptionError("Processing paused. Review the notice before retrying this recording.");
                  }
                }
              }}
              type="checkbox"
            />
            <div>
              <label htmlFor="request-processing-acceptance"><strong>I confirm I am 18 or older, am authorized to share this note, and have permission from anyone recorded.</strong></label>
              <span>I acknowledge that Ajani may process the note as described in the <Link href="/privacy#notice-at-collection">Privacy Policy</Link>. The <Link href="/terms">Terms of Service</Link> also apply to this request tool.</span>
            </div>
          </div>

          <div className={styles.split}>
            <div className={styles.inputSurface} data-mode={inputMode} key={inputMode}>
              {inputMode === "speak" ? (
                <>
                  <VoiceRecorder
                    embedded
                    id="record"
                    onActiveChange={setVoiceRecordingActive}
                    onCaptured={(nextCapture) => void handleVoiceCaptured(nextCapture)}
                    onInvalidated={resetVoiceCapture}
                    onTranscriptChange={updateWritten}
                    processingAllowed={processingAcknowledged}
                    savedCapture={capture}
                    transcript={written}
                  />
                  {capture && voiceTranscriptionStatus !== "ready" ? (
                    <p className={styles.transcriptionNotice} data-state={voiceTranscriptionStatus} role="status">
                      <i aria-hidden="true" />
                      {voiceTranscriptionStatus === "transcribing"
                        ? "Putting your voice note into writing…"
                        : voiceTranscriptionError || "We could not put this note into writing. Redo it or switch to typing."}
                      {voiceTranscriptionStatus === "failed" ? (
                        <button disabled={!processingAcknowledged} onClick={() => void handleVoiceCaptured(capture)} type="button">Retry transcription</button>
                      ) : null}
                    </p>
                  ) : null}
                </>
              ) : (
                <article className={styles.writingCard}>
                  <label htmlFor="written-note">Tell us where the work gets stuck</label>
                  <textarea
                    id="written-note"
                    maxLength={20_000}
                    onChange={(event) => updateWritten(event.target.value)}
                    placeholder="For example: enquiries arrive after hours, but nobody follows up until the next morning…"
                    rows={10}
                    value={written}
                  />
                  <footer>
                    <span>{written.trim().length} characters</span>
                    <b>{writtenReady ? "Enough to continue" : `Write at least ${MIN_TYPED_NOTE_CHARACTERS} characters`}</b>
                  </footer>
                </article>
              )}
            </div>

            <aside className={styles.guide}>
              <p className={styles.label}>A useful note covers</p>
              <ol>
                {notePrompts.map((prompt) => (
                  <li key={prompt.n}>
                    <b>{prompt.n}</b>
                    <div><strong>{prompt.title}</strong><span>{prompt.detail}</span></div>
                  </li>
                ))}
              </ol>
              <p className={styles.callout}>This is source material, not a test. Names and sensitive details are not needed.</p>
            </aside>
          </div>

          <Actions
            hint={noteHint}
            onPrimary={() => void continueFromNote()}
            primary={automationStatus === "clarifying" ? "Writing your questions…" : "Continue to clarify"}
            primaryDisabled={!processingAcknowledged || !noteReady}
          />
        </Stage>
      ) : null}

      {stage === 1 ? (
        <Stage
          copy={`Answer only the details the route still needs. Ajani asks them one at a time and never asks more than ${MAX_CLARIFICATION_QUESTIONS}.`}
          direction={stageDirection}
          eyebrow="02 / Clarify"
          headingRef={stageHeading}
          key="s1"
          title={<>Clarify the details that <em>change the route.</em></>}
        >
          {capture ? (
            <div className={styles.voiceNotice} role="status">
              <b>Voice note transcribed · {clock(capture.seconds)}</b>
              <span>Your recording is saved. Confirm the written note below so the first route reflects exactly what you meant.</span>
            </div>
          ) : null}

          <div className={styles.aiNotice} data-method={automationMethod ?? "pending"} role="status">
            <b>{automationMethod === "ai" ? "AI questions built from your note" : automationMethod === "deterministic_fallback" ? "Editable backup questions" : "Your edited note stays in context"}</b>
            <span>{automationMethod === "ai" ? "Only the missing decisions that can change the automation are included." : automationError || "Your confirmed answers will be combined with the full note before the route is shaped."}</span>
          </div>

          <div className={styles.clarifyGrid}>
            <article className={styles.understood}>
              <header><p className={styles.label}>Your note, in writing</p><span>{writtenReady ? "Ready" : "Required"}</span></header>
              <textarea
                aria-label="Add or confirm the written version"
                maxLength={20_000}
                onChange={(event) => updateWritten(event.target.value)}
                placeholder="Summarize the work that gets stuck, who is involved, and what good should look like…"
                rows={7}
                value={written}
              />
              <small>{written.trim().length} characters · saved only in this tab until you send</small>
            </article>

            <article className={styles.question} key={`clarification-${clarificationIndex}`}>
              <div className={styles.questionProgress} aria-label={`Clarification question ${clarificationIndex + 1} of ${Math.max(clarifications.length, 1)}`}>
                <p className={styles.label}>Question {clarificationIndex + 1} of {Math.max(clarifications.length, 1)}</p>
                <span>{MAX_CLARIFICATION_QUESTIONS} maximum</span>
                <i aria-hidden="true"><span style={{ width: `${((clarificationIndex + 1) / Math.max(clarifications.length, 1)) * 100}%` }} /></i>
              </div>
              <fieldset disabled={!currentClarification || questionsNeedRefresh || automationStatus === "shaping"}>
                <legend ref={clarificationHeading} tabIndex={-1}>{currentClarification?.question ?? "Add the written version to see the question that fits your note."}</legend>
                <p className={styles.why}>{currentClarification?.why ?? "Your answer sets the next decision in the route."}</p>
                <div className={styles.options}>
                  {currentClarification?.options.map((option, index) => (
                    <label data-selected={currentResponse.answerChoice === option ? "true" : "false"} key={option}>
                      <input
                        checked={currentResponse.answerChoice === option}
                        name={`clarification-${clarificationIndex}`}
                        onChange={() => updateClarificationResponse({ answerChoice: option, customAnswer: "" })}
                        type="radio"
                        value={option}
                      />
                      <span><b>{String.fromCharCode(65 + index)}</b>{option}</span>
                      {index === currentClarification.suggestedOptionIndex ? <em>Suggested</em> : null}
                    </label>
                  ))}
                  <label data-selected={currentResponse.answerChoice === "custom" ? "true" : "false"}>
                    <input checked={currentResponse.answerChoice === "custom"} name={`clarification-${clarificationIndex}`} onChange={() => updateClarificationResponse({ answerChoice: "custom" })} type="radio" value="custom" />
                    <span><b>D</b>Something else</span>
                  </label>
                </div>
              </fieldset>
              {currentResponse.answerChoice === "custom" ? (
                <textarea
                  aria-label="Clarification in your own words"
                  autoFocus
                  maxLength={400}
                  onChange={(event) => updateClarificationResponse({ customAnswer: event.target.value })}
                  placeholder="Add the detail in your own words…"
                  rows={4}
                  value={currentResponse.customAnswer}
                />
              ) : null}
            </article>
          </div>

          <Actions
            hint={!processingAcknowledged ? "Review and acknowledge the processing notice before continuing" : automationStatus === "shaping" ? "Combining your transcript and every confirmed answer…" : questionsNeedRefresh ? "Refresh the questions so they match your edited note." : !writtenReady ? "Add or confirm the written version first" : !currentAnswer ? "Choose the answer that fits" : undefined}
            onPrimary={() => void (questionsNeedRefresh ? continueFromNote() : advanceClarification())}
            onSecondary={clarificationIndex > 0 ? () => {
              cancelAutomation();
              setAutomationStatus(automationMethod === "ai" ? "ready" : automationMethod === "deterministic_fallback" ? "fallback" : "idle");
              setClarificationIndex((current) => current - 1);
            } : () => go(0)}
            primary={automationStatus === "clarifying" ? "Refreshing your questions…" : automationStatus === "shaping" ? "Shaping your automation…" : questionsNeedRefresh ? "Refresh questions" : clarificationIndex < clarifications.length - 1 ? "Next question" : "Build the first route"}
            primaryDisabled={!processingAcknowledged || automationStatus === "clarifying" || automationStatus === "shaping" || (!questionsNeedRefresh && (!currentAnswer || (clarificationIndex === clarifications.length - 1 && !allClarificationsReady)))}
            secondary={clarificationIndex > 0 ? "Previous question" : "Back to your note"}
          />
        </Stage>
      ) : null}

      {stage === 2 ? (
        <Stage
          copy="Edit any block, add a step, or move the sequence. This is the system you will approve."
          direction={stageDirection}
          eyebrow="03 / System editor"
          headingRef={stageHeading}
          key="s2"
          title={<>Shape the route before <em>we build it.</em></>}
        >
          <div className={styles.aiNotice} data-method={automationMethod ?? "pending"} role="status">
            <b>{automationMethod === "ai" ? "AI-shaped implementation route" : "Editable route ready"}</b>
            <span>{automationMethod === "ai" ? `Built from the complete transcript and ${clarificationAnswers.length} confirmed ${clarificationAnswers.length === 1 ? "decision" : "decisions"}.` : automationError || "Review every step before approval."}</span>
          </div>
          <div className={styles.desktopRouteEditor}>
            <div className={styles.editorBar}>
              <span aria-live="polite" role="status"><i aria-hidden="true" />System canvas · {saveStatus}</span>
              <div><button disabled={blocks.length >= 20} onClick={addBlock} type="button">+ Add step</button><button onClick={resetRoute} type="button">Reset suggestion</button></div>
            </div>

            <ol
              aria-describedby="route-editor-instructions"
              aria-label="Editable system route"
              className={styles.canvas}
              data-reordering={dragged ? "true" : "false"}
            >
              {blocks.map((block, index) => (
                <li
                  aria-label={`System block ${index + 1}: ${block.title}`}
                  data-block-id={block.id}
                  data-dragging={dragged === block.id ? "true" : "false"}
                  data-kind={block.kind}
                  key={block.id}
                  onPointerDown={(event) => startPointerDrag(event, block.id, "horizontal")}
                  ref={(node) => {
                    if (node) blockElements.current.set(block.id, node);
                    else blockElements.current.delete(block.id);
                  }}
                >
                  <div className={styles.blockMeta} aria-hidden="true">
                    <span>Step {String(index + 1).padStart(2, "0")}</span>
                    <b>{block.kind}</b>
                  </div>
                  <textarea
                    aria-label="Step name"
                    className={styles.blockTitle}
                    maxLength={120}
                    onChange={(event) => updateBlock(block.id, "title", event.target.value)}
                    rows={3}
                    value={block.title}
                  />
                  <textarea aria-label="What happens" onChange={(event) => updateBlock(block.id, "detail", event.target.value)} rows={3} value={block.detail} />
                  <footer>
                    <div className={styles.moveControls}>
                      {index > 0 ? <button aria-label={`Move ${block.title} left`} onClick={() => moveBlock(block.id, -1)} type="button">← Move left</button> : null}
                      {index < blocks.length - 1 ? <button aria-label={`Move ${block.title} right`} onClick={() => moveBlock(block.id, 1)} type="button">Move right →</button> : null}
                    </div>
                    <button aria-label={`Remove ${block.title}`} disabled={!canRemoveBlock(block)} onClick={() => removeBlock(block.id)} type="button">Remove</button>
                  </footer>
                </li>
              ))}
            </ol>
            <p className={styles.hint} id="route-editor-instructions">Grab anywhere on a card to move it, or use Move left and Move right. The route shifts with you as you drag.</p>
          </div>

          <section aria-label="Mobile system editor" className={styles.mobileRouteEditor}>
            <header className={styles.mobileRouteToolbar}>
              <div>
                <span><i aria-hidden="true" />System route</span>
                <small>{blocks.length} steps · {saveStatus}</small>
              </div>
              <button
                aria-pressed={mobileRouteMode === "reorder"}
                onClick={() => {
                  const nextMode = mobileRouteMode === "edit" ? "reorder" : "edit";
                  setMobileRouteMode(nextMode);
                  setMobileRouteAnnouncement(nextMode === "reorder" ? "Reorder mode opened" : `Reorder complete. Step ${mobileActiveIndex + 1} selected`);
                }}
                type="button"
              >
                {mobileRouteMode === "reorder" ? "Done" : "Reorder"}
              </button>
            </header>

            <nav aria-label="Choose a route step" className={styles.mobileRouteMap} ref={mobileRouteMap}>
              <ol>
                {blocks.map((block, index) => (
                  <li data-complete={index < mobileActiveIndex ? "true" : "false"} key={block.id}>
                    <button
                      aria-current={resolvedMobileActiveBlockId === block.id ? "step" : undefined}
                      aria-label={`Edit step ${index + 1}: ${block.title}`}
                      onClick={() => {
                        setMobileActiveBlockId(block.id);
                        setMobileRouteMode("edit");
                        setMobileRouteAnnouncement(`Step ${index + 1} selected: ${block.title}`);
                      }}
                      ref={(node) => {
                        if (node) mobileRouteSteps.current.set(block.id, node);
                        else mobileRouteSteps.current.delete(block.id);
                      }}
                      type="button"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            {mobileRouteMode === "edit" && mobileActiveBlock ? (
              <article className={styles.mobileRouteCard} data-kind={mobileActiveBlock.kind} key={mobileActiveBlock.id}>
                <header>
                  <span>Step {String(mobileActiveIndex + 1).padStart(2, "0")}</span>
                  <b>{mobileActiveBlock.kind}</b>
                </header>
                <label>
                  <span>Step name</span>
                  <textarea
                    aria-label="Step name"
                    className={styles.mobileRouteTitle}
                    maxLength={120}
                    onChange={(event) => updateBlock(mobileActiveBlock.id, "title", event.target.value)}
                    rows={2}
                    value={mobileActiveBlock.title}
                  />
                </label>
                <label>
                  <span>What happens</span>
                  <textarea aria-label="What happens" maxLength={1_000} onChange={(event) => updateBlock(mobileActiveBlock.id, "detail", event.target.value)} rows={4} value={mobileActiveBlock.detail} />
                </label>
                <footer>
                  <div>
                    <button
                      disabled={mobileActiveIndex === 0}
                      onClick={() => {
                        const previous = blocks[mobileActiveIndex - 1];
                        if (!previous) return;
                        setMobileActiveBlockId(previous.id);
                        setMobileRouteAnnouncement(`Step ${mobileActiveIndex} selected: ${previous.title}`);
                      }}
                      type="button"
                    >
                      ← Previous
                    </button>
                    <button
                      disabled={mobileActiveIndex === blocks.length - 1}
                      onClick={() => {
                        const next = blocks[mobileActiveIndex + 1];
                        if (!next) return;
                        setMobileActiveBlockId(next.id);
                        setMobileRouteAnnouncement(`Step ${mobileActiveIndex + 2} selected: ${next.title}`);
                      }}
                      type="button"
                    >
                      Next →
                    </button>
                  </div>
                  <button disabled={!canRemoveBlock(mobileActiveBlock)} onClick={() => removeBlock(mobileActiveBlock.id)} type="button">Remove this step</button>
                </footer>
              </article>
            ) : (
              <div className={styles.mobileReorderPanel}>
                <p>Press and drag a row, or use the arrow buttons.</p>
                <ol aria-label="Reorder system route" data-reordering={dragged ? "true" : "false"}>
                  {blocks.map((block, index) => (
                    <li
                      aria-label={`Step ${index + 1}: ${block.title}. Drag to reorder.`}
                      data-dragging={dragged === block.id ? "true" : "false"}
                      data-kind={block.kind}
                      key={block.id}
                      onPointerDown={(event) => startPointerDrag(event, block.id, "vertical")}
                      ref={(node) => {
                        if (node) mobileBlockElements.current.set(block.id, node);
                        else mobileBlockElements.current.delete(block.id);
                      }}
                    >
                      <span aria-hidden="true" className={styles.mobileDragHandle}>•••</span>
                      <div><b>{String(index + 1).padStart(2, "0")}</b><strong>{block.title}</strong><small>{block.kind}</small></div>
                      <div className={styles.mobileReorderButtons}>
                        <button
                          aria-label={`Move ${block.title} up`}
                          disabled={index === 0}
                          onClick={() => {
                            moveBlock(block.id, -1, mobileBlockElements.current);
                            setMobileRouteAnnouncement(`${block.title} moved to step ${index}`);
                          }}
                          type="button"
                        >↑</button>
                        <button
                          aria-label={`Move ${block.title} down`}
                          disabled={index === blocks.length - 1}
                          onClick={() => {
                            moveBlock(block.id, 1, mobileBlockElements.current);
                            setMobileRouteAnnouncement(`${block.title} moved to step ${index + 2}`);
                          }}
                          type="button"
                        >↓</button>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className={styles.mobileRouteUtilities}>
              <button disabled={blocks.length >= 20} onClick={addBlock} type="button">+ Add step</button>
              <button onClick={resetRoute} type="button">Reset suggestion</button>
            </div>
            <p aria-live="polite" className={styles.srOnly} role="status">{mobileRouteAnnouncement}</p>
          </section>

          <div className={styles.routeActions}>
            <Actions
              hint={routeReady ? undefined : !hasHumanHandoff ? "Keep one human handoff in the route before review." : "Every step needs a name and a description before review."}
              onPrimary={() => go(3)}
              onSecondary={() => go(1)}
              primary="Check this route"
              primaryDisabled={!routeReady}
              secondary="Back to clarify"
            />
          </div>
        </Stage>
      ) : null}

      {stage === 3 ? (
        <Stage
          copy="Review the outcome, route, launch window, and approval terms. Nothing is submitted yet."
          direction={stageDirection}
          eyebrow="04 / Check"
          headingRef={stageHeading}
          key="s3"
          title={<>Confirm the system you <em>want built.</em></>}
        >
          <article className={styles.outcomeBand}>
            <header>
              <span><i aria-hidden="true" /> Development brief editable</span>
              <b>Source · note + {clarificationAnswers.length} {clarificationAnswers.length === 1 ? "answer" : "answers"}</b>
            </header>
            <div>
              <small>OUTCOME.01</small>
              <h3>{effectiveProblem.desiredOutcome}</h3>
              <button className={styles.outcomeReadMore} onClick={() => selectReviewFile(1, true)} type="button">Read the full outcome in file 02 <span aria-hidden="true">↓</span></button>
            </div>
            <footer>
              <span><b>{String(blocks.length).padStart(2, "0")}</b> route blocks</span>
              <span><b>{String(clarificationAnswers.length).padStart(2, "0")}</b> decisions confirmed</span>
              <span><b>{String(humanHandoffs).padStart(2, "0")}</b> human {humanHandoffs === 1 ? "handoff" : "handoffs"}</span>
            </footer>
          </article>

          <div className={styles.reviewGrid}>
            <article className={styles.review}>
              <header>
                <div><p className={styles.label}>Development brief</p><h3>Review one file at a time</h3></div>
                <b>{reviewFile + 1} of {reviewFiles.length}</b>
              </header>

              <div className={styles.reviewWorkspace}>
                <nav aria-label="Development brief files" className={styles.reviewFileNav} ref={reviewFileNav}>
                  <div aria-orientation="vertical" role="tablist">
                    {reviewFiles.map((file, index) => (
                      <button
                        aria-controls={`review-file-${file.id}`}
                        aria-selected={reviewFile === index}
                        id={`review-tab-${file.id}`}
                        key={file.id}
                        onClick={() => selectReviewFile(index)}
                        onKeyDown={(event) => onReviewFileKey(event, index)}
                        ref={(node) => { reviewTabs.current[index] = node; }}
                        role="tab"
                        tabIndex={reviewFile === index ? 0 : -1}
                        type="button"
                      >
                        <b>{file.number}</b>
                        <span>{file.label}<small>{file.summary}</small></span>
                      </button>
                    ))}
                  </div>
                </nav>

                <section
                  aria-labelledby={`review-tab-${reviewFiles[reviewFile].id}`}
                  className={styles.reviewFilePanel}
                  id={`review-file-${reviewFiles[reviewFile].id}`}
                  key={reviewFiles[reviewFile].id}
                  onKeyDown={onReviewPanelKey}
                  role="tabpanel"
                  tabIndex={0}
                >
                  {reviewFile === 0 ? (
                    <div className={styles.reviewFileContent}>
                      <header><div><p className={styles.briefKicker}>01 / Source note</p><h4>What you told us</h4></div>{reviewDraft ? <span className={styles.reviewEditing}>Editing</span> : <button onClick={startReviewEdit} ref={reviewEditButton} type="button">Edit this file</button>}</header>
                      {reviewDraft?.file === 0 ? (
                        <label className={styles.reviewEditField}>
                          <span>Source note</span>
                          <textarea aria-describedby="review-edit-help" aria-invalid={Boolean(currentReviewDraftError)} maxLength={20_000} onChange={(event) => setReviewDraft({ file: 0, source: event.target.value })} ref={(node) => { firstReviewEditField.current = node; }} rows={8} value={reviewDraft.source} />
                        </label>
                      ) : (
                        <div className={styles.sourceNotePreview} data-scrollable={sourceNoteScrollable ? "true" : "false"}>
                          <header>
                            <span>{capture ? `Voice note · ${clock(capture.seconds)}` : "Written note"}</span>
                            <b>{sourceCharacterCount.toLocaleString()} characters · {sourceWordCount.toLocaleString()} words</b>
                          </header>
                          <blockquote aria-label={sourceNoteScrollable ? "Full source note. Scroll to read all." : undefined} ref={sourceNotePreview} tabIndex={sourceNoteScrollable ? 0 : undefined}>{sourceNoteText}</blockquote>
                          {sourceNoteScrollable ? <small>Scroll inside the note to read the full transcript.</small> : null}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {reviewFile === 1 ? (
                    <div className={styles.reviewFileContent}>
                      <header><div><p className={styles.briefKicker}>02 / Problem definition</p><h4>The workflow we are solving</h4></div>{reviewDraft ? <span className={styles.reviewEditing}>Editing</span> : <button onClick={startReviewEdit} ref={reviewEditButton} type="button">Edit this file</button>}</header>
                      {reviewDraft?.file === 1 ? (
                        <div className={styles.reviewEditGrid}>
                          {([
                            ["Work that slips", "workThatSlips"],
                            ["When it happens", "momentItHappens"],
                            ["Success looks like", "desiredOutcome"],
                          ] as const).map(([label, field], index) => (
                            <label className={styles.reviewEditField} key={field}>
                              <span>{label}</span>
                              <textarea aria-invalid={Boolean(currentReviewDraftError)} maxLength={1_000} onChange={(event) => setReviewDraft((current) => current?.file === 1 ? { ...current, [field]: event.target.value } : current)} ref={index === 0 ? (node) => { firstReviewEditField.current = node; } : undefined} rows={4} value={reviewDraft[field]} />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.briefFacts}>
                          <article><small>WORK THAT SLIPS</small><p>{effectiveProblem.workThatSlips}</p></article>
                          <article><small>WHEN IT HAPPENS</small><p>{effectiveProblem.momentItHappens}</p></article>
                          <article><small>SUCCESS LOOKS LIKE</small><p>{effectiveProblem.desiredOutcome}</p></article>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {reviewFile === 2 ? (
                    <div className={styles.reviewFileContent}>
                      <header><div><p className={styles.briefKicker}>03 / Confirmed decisions</p><h4>{clarificationAnswers.length} build {clarificationAnswers.length === 1 ? "decision" : "decisions"}</h4></div>{reviewDraft ? <span className={styles.reviewEditing}>Editing</span> : <button onClick={startReviewEdit} ref={reviewEditButton} type="button">Edit this file</button>}</header>
                      <ol aria-label="Confirmed build decisions" className={styles.decisionCards}>
                        {clarificationAnswers.map((item, index) => (
                          <li key={item.question}><b>{String(index + 1).padStart(2, "0")}</b><div><span>{item.question}</span>{reviewDraft?.file === 2 ? <label className={styles.decisionEdit}><span>Confirmed answer</span><textarea aria-invalid={Boolean(currentReviewDraftError)} maxLength={500} onChange={(event) => setReviewDraft((current) => current?.file === 2 ? { ...current, answers: current.answers.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer) } : current)} ref={index === 0 ? (node) => { firstReviewEditField.current = node; } : undefined} rows={3} value={reviewDraft.answers[index] ?? ""} /></label> : <strong>{item.answer}</strong>}</div></li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {reviewFile === 3 ? (
                    <div className={styles.reviewFileContent}>
                      <header><div><p className={styles.briefKicker}>04 / Approved route</p><h4>{blocks.length} cards in build order</h4></div>{reviewDraft ? <span className={styles.reviewEditing}>Editing</span> : <button onClick={startReviewEdit} ref={reviewEditButton} type="button">Edit this file</button>}</header>
                      {reviewDraft?.file === 3 ? (
                        <div className={styles.reviewRouteEditor}>
                          <div className={styles.reviewRouteToolbar}><span>Edit the build order here</span><button disabled={reviewDraft.blocks.length >= 20} onClick={() => setReviewDraft((current) => current?.file === 3 ? { ...current, blocks: [...current.blocks, { id: `review-step-${Date.now()}`, kind: "custom", title: "New step", detail: "Describe what should happen here." }] } : current)} type="button">+ Add card</button></div>
                          <ol aria-label="Editable approved route">
                            {reviewDraft.blocks.map((block, index) => (
                              <li key={block.id}>
                                <label><span>Card {String(index + 1).padStart(2, "0")} title</span><input aria-invalid={Boolean(currentReviewDraftError)} maxLength={120} onChange={(event) => updateReviewRouteBlock(block.id, "title", event.target.value)} ref={index === 0 ? (node) => { firstReviewEditField.current = node; } : undefined} value={block.title} /></label>
                                <label><span>What happens</span><textarea aria-invalid={Boolean(currentReviewDraftError)} maxLength={1_000} onChange={(event) => updateReviewRouteBlock(block.id, "detail", event.target.value)} rows={3} value={block.detail} /></label>
                                <footer><label><span>Position</span><select aria-label={`Position of ${block.title}`} onChange={(event) => moveReviewRouteBlock(block.id, Number(event.target.value))} value={index}>{reviewDraft.blocks.map((_, position) => <option key={position} value={position}>{String(position + 1).padStart(2, "0")}</option>)}</select></label><button disabled={!canRemoveBlock(block, reviewDraft.blocks)} onClick={() => setReviewDraft((current) => current?.file === 3 ? { ...current, blocks: current.blocks.filter((item) => item.id !== block.id) } : current)} type="button">Remove</button></footer>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : (
                        <ol aria-label="Approved route cards" className={styles.reviewRouteCards}>
                          {blocks.map((block, index) => (
                            <li key={block.id}><header><b>{String(index + 1).padStart(2, "0")}</b><span>{block.kind}</span></header><strong>{block.title}</strong><p>{block.detail}</p></li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ) : null}

                  {reviewFile === 4 ? (
                    <div className={styles.reviewFileContent}>
                      <header><div><p className={styles.briefKicker}>05 / Protection</p><h4>What this protects</h4></div>{reviewDraft ? <span className={styles.reviewEditing}>Editing</span> : <button onClick={startReviewEdit} ref={reviewEditButton} type="button">Edit this file</button>}</header>
                      {reviewDraft?.file === 4 ? (
                        <label className={styles.reviewEditField}>
                          <span>Protection statement</span>
                          <textarea aria-invalid={Boolean(currentReviewDraftError)} maxLength={2_000} onChange={(event) => setReviewDraft({ file: 4, protection: event.target.value })} ref={(node) => { firstReviewEditField.current = node; }} rows={7} value={reviewDraft.protection} />
                        </label>
                      ) : <div className={styles.protectionNote}><span aria-hidden="true">05</span><strong>{effectiveProtection}</strong></div>}
                    </div>
                  ) : null}

                  <footer className={styles.reviewFilePager}>
                    <div><span>File {reviewFile + 1} of {reviewFiles.length}</span><progress aria-label="Brief review progress" max={reviewFiles.length} value={reviewFile + 1} /></div>
                    {reviewDraft ? <div><button onClick={cancelReviewEdit} type="button">Cancel</button><button disabled={Boolean(currentReviewDraftError)} onClick={saveReviewEdit} type="button">Save changes</button></div> : <div><button disabled={reviewFile === 0} onClick={() => selectReviewFile(reviewFile - 1)} type="button">← Previous</button><button disabled={reviewFile === reviewFiles.length - 1} onClick={() => selectReviewFile(reviewFile + 1)} type="button">Next file →</button></div>}
                  </footer>
                  <p className={styles.reviewEditStatus} id="review-edit-help" role={currentReviewDraftError ? "alert" : "status"}>{currentReviewDraftError || reviewEditMessage || (reviewDraft ? "Press Control or Command + Enter to save. Press Escape to cancel." : "")}</p>
                </section>
              </div>
            </article>

            <aside className={styles.commercial}>
              <header><p className={styles.label}>Delivery parameters</p><b><i aria-hidden="true" /> Ready</b></header>
              <dl>
                <div><dt>Build investment</dt><dd>Based on your budget</dd></div>
                <div><dt>Time to live</dt><dd>7–10 days</dd></div>
                <div><dt>Payment</dt><dd>After you approve</dd></div>
              </dl>
              <ul>{buildIncludes.map((item) => <li key={item}><i aria-hidden="true">✓</i>{item}</li>)}</ul>
            </aside>
          </div>

          <Actions hint={reviewDraft ? "Save or cancel the open file before approval." : undefined} onPrimary={() => go(4)} onSecondary={() => go(2)} primary="Approve this route" primaryDisabled={Boolean(reviewDraft) || !writtenReady || !allClarificationsReady} secondary="Back to shaping" />
        </Stage>
      ) : null}

      {stage === 4 ? (
        <Stage
          copy={handoffComplete ? "Your approved build brief and account contact are now in the Ajani build desk." : "Review the complete handoff below. This is exactly what Ajani will receive when you send it."}
          direction={stageDirection}
          eyebrow="05 / Handoff"
          headingRef={stageHeading}
          key={`s4-${handoffComplete ? "complete" : "preview"}`}
          title={handoffComplete ? <>Build brief <em>received.</em></> : <>Your build brief <em>is ready.</em></>}
        >
          {handoffComplete ? (
            <section aria-labelledby="handoff-confirmation-title" className={styles.handoffConfirmation} role="status">
              <div aria-hidden="true" className={styles.confirmationMark}>✓</div>
              <p>Submission confirmed</p>
              <h2 id="handoff-confirmation-title">Your request is with Ajani.</h2>
              <span>We received the approved workflow and attached the email from your authenticated account. You can safely leave this page.</span>
              <dl>
                <div><dt>Reference</dt><dd>{buildReference}</dd></div>
                <div><dt>Status</dt><dd>In the build desk</dd></div>
                <div><dt>Received</dt><dd>{submittedLabel ?? "Just now"}</dd></div>
              </dl>
              <div className={styles.confirmationActions}>
                <button onClick={() => router.push("/portal")} type="button">Open your workspace <span aria-hidden="true">→</span></button>
                <Link href="/">Return home</Link>
              </div>
              <small>A confirmation is also recorded in your private workspace. This request cannot be submitted twice.</small>
            </section>
          ) : <>
          {saveError ? <p className={styles.saveError} ref={saveErrorRef} role="alert" tabIndex={-1}>{saveError} <button onClick={() => void sendRequest()} type="button">Try again</button></p> : null}
          {deleteError ? <p className={styles.saveError} ref={deleteErrorRef} role="alert" tabIndex={-1}>{deleteError} <button onClick={() => void deleteSavedRequest()} type="button">Try deletion again</button></p> : null}
          <div className={styles.handoffGrid}>
            <article className={styles.handoffReceipt} data-submitted="false">
              <header className={styles.receiptStatus}>
                <span><i aria-hidden="true" />Handoff preview</span>
                <b>{submissionStatus === "awaiting_account" ? "Account needed" : "Ready to hand off"}</b>
              </header>

              <div className={styles.receiptIntro}>
                <p>Approved build brief</p>
                <h2>{handoffTitle}</h2>
                <span>{handoffOverview}</span>
                <dl>
                  <div><dt>Reference</dt><dd>{receiptReference}</dd></div>
                  <div><dt>Status</dt><dd>{savedDraftId ? "Saved, not sent" : "Approved draft"}</dd></div>
                </dl>
              </div>

              <div className={styles.receiptMetrics}>
                <span><b>{String(blocks.length).padStart(2, "0")}</b> workflow steps</span>
                <span><b>{String(clarificationAnswers.length).padStart(2, "0")}</b> decisions</span>
                <span><b>{String(humanHandoffs).padStart(2, "0")}</b> human {humanHandoffs === 1 ? "handoff" : "handoffs"}</span>
                <span><b>7–10</b> days to live</span>
              </div>

              <section className={styles.receiptSection}>
                <header><span>01</span><div><p>Problem definition</p><h3>The workflow we are solving</h3></div></header>
                <div className={styles.receiptProblem}>
                  <article><small>Work that slips</small><p>{effectiveProblem.workThatSlips}</p></article>
                  <article><small>When it happens</small><p>{effectiveProblem.momentItHappens}</p></article>
                  <article><small>Success looks like</small><p>{effectiveProblem.desiredOutcome}</p></article>
                </div>
              </section>

              <section className={styles.receiptSection}>
                <header><span>02</span><div><p>Approved route</p><h3>{blocks.length} steps in build order</h3></div></header>
                <ol className={styles.receiptRoute}>
                  {blocks.map((block, index) => (
                    <li key={block.id}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <div><strong>{block.title}</strong><p>{block.detail}</p></div>
                      <span>{block.kind}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className={styles.receiptSection}>
                <header><span>03</span><div><p>Confirmed decisions</p><h3>The choices shaping this build</h3></div></header>
                <ol className={styles.receiptDecisions}>
                  {clarificationAnswers.map((item, index) => (
                    <li key={item.question}><b>{String(index + 1).padStart(2, "0")}</b><div><span>{item.question}</span><strong>{item.answer}</strong></div></li>
                  ))}
                </ol>
              </section>

              <section className={styles.receiptSection}>
                <header><span>04</span><div><p>Safety boundary</p><h3>What this protects</h3></div></header>
                <blockquote className={styles.receiptProtection}>{effectiveProtection}</blockquote>
              </section>

              <details className={styles.receiptSource}>
                <summary><span>05 / Source note</span><b>{capture ? `Voice · ${clock(capture.seconds)}` : "Written note"}</b></summary>
                <p>{written.trim()}</p>
              </details>

              <footer className={styles.receiptFooter}>
                <span>Ajani Automation · Approved build brief</span>
                <b>{receiptReference}</b>
              </footer>
            </article>

            <article aria-label="Mobile handoff receipt" className={styles.mobileHandoffReceipt} data-submitted="false">
              <header><span><i aria-hidden="true" />Handoff preview</span><b>{receiptReference}</b></header>
              <div className={styles.mobileReceiptIntro}>
                <p>Approved build brief</p>
                <h2>{handoffTitle}</h2>
                <span>{handoffOverview}</span>
                <a className={styles.mobileReceiptJump} href="#handoff-summary">Continue to the send summary <span aria-hidden="true">↓</span></a>
              </div>
              <ul className={styles.mobileReceiptMetrics}>
                <li><b>{blocks.length}</b><span>Steps</span></li>
                <li><b>{clarificationAnswers.length}</b><span>Decisions</span></li>
                <li><b>{humanHandoffs}</b><span>Human review</span></li>
                <li><b>7–10</b><span>Days</span></li>
              </ul>
              <div className={styles.mobileReceiptFiles}>
                <details><summary><b>01</b><span>Problem definition<small>The workflow we are solving</small></span></summary><div aria-label="Problem definition. Scroll to read all." className={styles.mobileReceiptBody} tabIndex={0}><strong>Work that slips</strong><p>{effectiveProblem.workThatSlips}</p><strong>When it happens</strong><p>{effectiveProblem.momentItHappens}</p><strong>Success looks like</strong><p>{effectiveProblem.desiredOutcome}</p></div></details>
                <details><summary><b>02</b><span>Approved route<small>{blocks.length} steps in build order</small></span></summary><ol aria-label="Approved route. Scroll to read all." className={styles.mobileReceiptRoute} tabIndex={0}>{blocks.map((block, index) => <li key={block.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{block.title}</strong><p>{block.detail}</p></div></li>)}</ol></details>
                <details><summary><b>03</b><span>Confirmed decisions<small>{clarificationAnswers.length} choices shaping the build</small></span></summary><ol aria-label="Confirmed decisions. Scroll to read all." className={styles.mobileReceiptDecisions} tabIndex={0}>{clarificationAnswers.map((item, index) => <li key={item.question}><b>{String(index + 1).padStart(2, "0")}</b><div><span>{item.question}</span><strong>{item.answer}</strong></div></li>)}</ol></details>
                <details><summary><b>04</b><span>Safety boundary<small>What this protects</small></span></summary><p aria-label="Safety boundary. Scroll to read all." className={styles.mobileReceiptProtection} tabIndex={0}>{effectiveProtection}</p></details>
                <details><summary><b>05</b><span>Source note<small>{capture ? `Voice · ${clock(capture.seconds)}` : "Written note"}</small></span></summary><p aria-label="Full source note. Scroll to read all." className={styles.mobileReceiptSource} tabIndex={0}>{written.trim()}</p></details>
              </div>
            </article>

            <aside className={styles.handoffPanel} id="handoff-summary">
              <header><div><p className={styles.label}>Handoff summary</p><strong>{savedDraftId ? "Your brief is saved and ready to finish." : "You are sending exactly this."}</strong></div><span data-saved="false">{submissionStatus === "awaiting_account" ? "Account needed" : "Ready"}</span></header>
              <dl>
                <div><dt>Workflow</dt><dd>{blocks.length} approved steps</dd></div>
                <div><dt>Decisions</dt><dd>{clarificationAnswers.length} confirmed</dd></div>
                <div><dt>Human review</dt><dd>{humanHandoffs} {humanHandoffs === 1 ? "handoff" : "handoffs"}</dd></div>
                <div><dt>Target window</dt><dd>7–10 days</dd></div>
                <div><dt>Payment</dt><dd>After approval</dd></div>
              </dl>
              <div className={styles.handoffIncludes}>
                <p>Included in the handoff</p>
                <ul>{buildIncludes.map((item) => <li key={item}><i aria-hidden="true">✓</i>{item}</li>)}</ul>
              </div>
              <div className={styles.legalAcceptance}>
                <input
                  aria-describedby="handoff-legal-detail"
                  checked={legalAccepted}
                  id="handoff-legal-acceptance"
                  onChange={(event) => {
                    setLegalAccepted(event.target.checked);
                    if (event.target.checked && saveError?.includes("Acceptable Use Policy")) setSaveError(null);
                  }}
                  type="checkbox"
                />
                <div>
                  <label htmlFor="handoff-legal-acceptance"><strong>{HANDOFF_NOTICE_COPY.agreement}</strong></label>
                  <span id="handoff-legal-detail">Review the <Link href="/terms">Terms of Service</Link>, <Link href="/acceptable-use">Acceptable Use Policy</Link>, and <Link href="/privacy">Privacy Policy</Link>. {HANDOFF_NOTICE_COPY.detail}</span>
                </div>
              </div>
              <div className={styles.handoffControls}>
                {savedDraftPersistence === "memory" ? (
                  <p role="status">Your browser blocks tab storage. Keep this page open to finish account access. Reloading or a sign-in redirect will lose access to this saved draft; enable site storage before using a sign-in method that leaves this page.</p>
                ) : null}
                <button className={styles.handoffPrimary} disabled={saving || !legalAccepted} onClick={() => void sendRequest()} type="button">
                  {handoffButtonLabel}<span aria-hidden="true">→</span>
                </button>
                {!savedDraftId ? <button className={styles.handoffBack} onClick={() => go(3)} type="button"><span aria-hidden="true">←</span>Back to check</button> : null}
                <small>{savedDraftId ? "The saved brief still needs its authenticated handoff to finish." : isLoaded && isSignedIn ? "You will stay here until the build desk confirms receipt." : "Account access opens after saving so your email can be attached."}</small>
                {savedDraftId ? <button className={styles.handoffDelete} disabled={deleting} onClick={() => void deleteSavedRequest()} type="button">{deleting ? "Deleting request…" : "Delete saved request and upload"}</button> : null}
              </div>
              <p className={styles.handoffTerms}><i aria-hidden="true" />Nothing is charged now. Scope and price are agreed in writing before work begins.</p>
            </aside>
          </div>
          </>}
        </Stage>
      ) : null}

      {!handoffComplete ? <p className={styles.escape}>Not ready to hand off? <Link href="/">Go back to the homepage</Link>. Your session-only progress stays in this tab.</p> : null}
    </div>
  );
}

function Stage({ eyebrow, title, copy, children, headingRef, direction }: {
  eyebrow: string;
  title: ReactNode;
  copy: string;
  children: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  direction: StageDirection;
}) {
  return (
    <section className={styles.stage} data-direction={direction}>
      <header className={styles.stageHead}>
        <div><p className={styles.label}>{eyebrow}</p><h1 ref={headingRef} tabIndex={-1}>{title}</h1></div>
        <p>{copy}</p>
      </header>
      {children}
    </section>
  );
}

function Actions({ primary, secondary, onPrimary, onSecondary, primaryDisabled = false, hint }: {
  primary: string;
  secondary?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
  hint?: string;
}) {
  return (
    <div className={styles.actions}>
      {secondary && onSecondary ? <button className={styles.back} onClick={onSecondary} type="button"><span aria-hidden="true">←</span>{secondary}</button> : <span />}
      <div className={styles.forward}>{hint ? <small>{hint}</small> : null}<button className={styles.next} disabled={primaryDisabled} onClick={onPrimary} type="button">{primary}<span aria-hidden="true">→</span></button></div>
    </div>
  );
}
