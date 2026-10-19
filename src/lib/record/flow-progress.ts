import type { SystemBlock } from "@/lib/domain/types";
import { removeTabValue } from "@/lib/record/tab-storage";

/** This tab's progress through /record. */
export const RECORD_FLOW_STORAGE_KEY = "ajani_record_flow_v3";

// The build desk rejects longer steps (see systemBlockSchema).
export const ROUTE_STEP_TITLE_LIMIT = 120;
export const ROUTE_STEP_DETAIL_LIMIT = 1_000;

const CHECK_STAGE = 3;
const HANDOFF_STAGE = 4;

/** Forget this tab's /record progress once Ajani has the request, so it cannot be sent twice. */
export function clearRecordFlowProgress() {
  return removeTabValue(RECORD_FLOW_STORAGE_KEY);
}

export function routeStepsWithinLimits(blocks: SystemBlock[]) {
  return blocks.every((block) => block.title.length <= ROUTE_STEP_TITLE_LIMIT && block.detail.length <= ROUTE_STEP_DETAIL_LIMIT);
}

/**
 * Where a reload of /record reopens. The handoff step only comes back while a
 * saved draft is still waiting for its account step. Without one the brief
 * reopens at Check, so a request that already reached Ajani is not resent.
 */
export function restoredFlowPosition(
  stored: { stage: number; reached: number },
  { acknowledged, noteReady, hasPendingDraft }: { acknowledged: boolean; noteReady: boolean; hasPendingDraft: boolean },
) {
  const lastStage = hasPendingDraft ? HANDOFF_STAGE : CHECK_STAGE;
  const stage = acknowledged && noteReady ? Math.min(stored.stage, lastStage) : 0;
  const reached = acknowledged ? Math.min(Math.max(stage, stored.reached), lastStage) : 0;
  return { stage, reached };
}
