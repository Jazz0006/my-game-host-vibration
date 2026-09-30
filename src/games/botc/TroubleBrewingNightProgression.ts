import {
  createTroubleBrewingOtherNightSequence,
  type BotcNightStep,
  type TroubleBrewingOtherNightFacts,
} from "./TroubleBrewingNightSequence.js";

export const TROUBLE_BREWING_OTHER_NIGHT_PROGRESS_ORDER = [
  "role:poisoner",
  "role:monk",
  "role:spy",
  "role_change:scarlet_woman_to_imp",
  "role:imp",
  "role_change:imp_self_kill_to_imp",
  "role:ravenkeeper",
  "role:undertaker",
  "role:empath",
  "role:fortune_teller",
  "role:butler",
] as const;

export type TroubleBrewingOtherNightProgressStepId =
  typeof TROUBLE_BREWING_OTHER_NIGHT_PROGRESS_ORDER[number];

export type TroubleBrewingOtherNightProgress = {
  completedThroughStepId?: TroubleBrewingOtherNightProgressStepId;
  activeStep?: BotcNightStep;
};

function progressIndex(stepId: BotcNightStep["id"]): number {
  return TROUBLE_BREWING_OTHER_NIGHT_PROGRESS_ORDER.indexOf(
    stepId as TroubleBrewingOtherNightProgressStepId,
  );
}

function assertOtherNightStep(
  step: BotcNightStep,
): asserts step is BotcNightStep & {
  id: TroubleBrewingOtherNightProgressStepId;
} {
  if (progressIndex(step.id) < 0) {
    throw new Error(`Unsupported Trouble Brewing other-night step: ${step.id}`);
  }
}

function nextStepAfter(
  facts: TroubleBrewingOtherNightFacts,
  completedThroughStepId?: TroubleBrewingOtherNightProgressStepId,
): BotcNightStep | undefined {
  const completedIndex = completedThroughStepId
    ? progressIndex(completedThroughStepId)
    : -1;

  for (const step of createTroubleBrewingOtherNightSequence(facts)) {
    assertOtherNightStep(step);
    if (progressIndex(step.id) > completedIndex) return step;
  }

  return undefined;
}

/**
 * Starts a live Trouble Brewing other-night cursor from the current
 * authoritative facts.
 *
 * The chosen active step is snapshotted so later rule-resolution changes do
 * not replace the action already in progress. After that action completes,
 * eligibility is recomputed from fresh authoritative facts.
 */
export function startTroubleBrewingOtherNightProgress(
  facts: TroubleBrewingOtherNightFacts,
): TroubleBrewingOtherNightProgress {
  const activeStep = nextStepAfter(facts);
  return activeStep ? { activeStep } : {};
}

export type TroubleBrewingOtherNightAdvanceResult = {
  progress: TroubleBrewingOtherNightProgress;
  completedStep: BotcNightStep;
  nextStep?: BotcNightStep;
};

/**
 * Completes the snapshotted active step and selects the next eligible later
 * canonical slot from fresh authoritative facts.
 *
 * This high-water-mark cursor is intentionally monotonic: newly eligible
 * later steps may appear, while already-passed slots are never replayed.
 */
export function advanceTroubleBrewingOtherNightProgress(
  facts: TroubleBrewingOtherNightFacts,
  progress: TroubleBrewingOtherNightProgress,
): TroubleBrewingOtherNightAdvanceResult {
  const completedStep = progress.activeStep;
  if (!completedStep) {
    throw new Error("There is no active Trouble Brewing other-night step");
  }
  assertOtherNightStep(completedStep);

  const nextStep = nextStepAfter(facts, completedStep.id);
  return {
    completedStep,
    progress: {
      completedThroughStepId: completedStep.id,
      ...(nextStep ? { activeStep: nextStep } : {}),
    },
    ...(nextStep ? { nextStep } : {}),
  };
}
