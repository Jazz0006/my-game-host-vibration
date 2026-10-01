import type { BotcNightStep } from "./TroubleBrewingNightSequence.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";
import {
  createTroubleBrewingChefInformationCandidates,
  createTroubleBrewingEmpathInformationCandidates,
  createTroubleBrewingPairInformationCandidates,
  isTroubleBrewingPairCandidate,
  type TroubleBrewingInformationReliability,
  type TroubleBrewingNightInformationResult,
  type TroubleBrewingNumericInformationAbilityRoleId,
  type TroubleBrewingNumericInformationResolution,
  type TroubleBrewingPairInformationAbilityRoleId,
  type TroubleBrewingPairInformationResult,
} from "./TroubleBrewingInformation.js";
import {
  createTroubleBrewingFortuneTellerInformationCandidates,
  type TroubleBrewingFortuneTellerInformationResolution,
} from "./TroubleBrewingFortuneTeller.js";
import {
  createFortuneTellerInformationRecommendationRequest,
  createNumericInformationRecommendationRequest,
  createPairInformationRecommendationRequest,
  recommendFortuneTellerInformationBaselineV1,
  recommendNumericInformationBaselineV1,
  recommendPairInformationBaselineV1,
} from "./TroubleBrewingRecommendation.js";
import {
  cloneTroubleBrewingSpyGrimoireSnapshot,
  createTroubleBrewingSpyGrimoireSnapshot,
} from "./TroubleBrewingSpyGrimoire.js";
import type { TroubleBrewingRoleId } from "./TroubleBrewing.js";

export type BotcNightInformationSelectionSource = "baseline_v1";

export type BotcNightInformationState = {
  stepId: BotcNightStep["id"];
  nightNumber: number;
  recipientPlayerId: string;
  result: TroubleBrewingNightInformationResult;
  selectionSource: BotcNightInformationSelectionSource;
  acknowledged: boolean;
};

export type BotcModeratorInformationDecisionView = {
  stepId: BotcNightStep["id"];
  recipientPlayerId: string;
  roleId: TroubleBrewingRoleId;
  committed: boolean;
};

export type BotcNightInformationRuntimeState = {
  phase: "role_reveal" | "first_night" | "day" | "other_night";
  assignments: BotcCanonicalSetupAssignment[];
  seatingPlayerIds: string[];
  deadPlayerIds: string[];
  nightNumber: number;
  informationHistory: BotcNightInformationState[];
  poisonedPlayerId?: string;
  butlerMasterPlayerId?: string;
  redHerring?: { playerId: string };
  fortuneTellerChoice?: {
    nightNumber: number;
    playerIds: [string, string];
  };
};

type BotcInformationAbilityRoleId =
  | TroubleBrewingPairInformationAbilityRoleId
  | TroubleBrewingNumericInformationAbilityRoleId
  | "fortune_teller"
  | "spy";

export type BotcInformationStep = Extract<BotcNightStep, { kind: "role" }> & {
  roleId: BotcInformationAbilityRoleId;
};

function informationStep(
  step: BotcNightStep | undefined,
): BotcInformationStep | undefined {
  if (step?.kind !== "role") return undefined;
  if (
    step.roleId !== "washerwoman" &&
    step.roleId !== "librarian" &&
    step.roleId !== "investigator" &&
    step.roleId !== "chef" &&
    step.roleId !== "empath" &&
    step.roleId !== "fortune_teller" &&
    step.roleId !== "spy"
  ) {
    return undefined;
  }
  return step as BotcInformationStep;
}

function isPairInformationRole(
  roleId: BotcInformationAbilityRoleId,
): roleId is TroubleBrewingPairInformationAbilityRoleId {
  return roleId === "washerwoman" || roleId === "librarian" || roleId === "investigator";
}

function isNumericInformationRole(
  roleId: BotcInformationAbilityRoleId,
): roleId is TroubleBrewingNumericInformationAbilityRoleId {
  return roleId === "chef" || roleId === "empath";
}

export function currentFortuneTellerChoice(
  state: BotcNightInformationRuntimeState,
): BotcNightInformationRuntimeState["fortuneTellerChoice"] | undefined {
  return state.fortuneTellerChoice?.nightNumber === state.nightNumber
    ? state.fortuneTellerChoice
    : undefined;
}

export function informationReadyStep(
  state: BotcNightInformationRuntimeState,
  step: BotcNightStep | undefined,
): BotcInformationStep | undefined {
  const candidate = informationStep(step);
  if (!candidate) return undefined;
  if (candidate.roleId === "fortune_teller" && !currentFortuneTellerChoice(state)) {
    return undefined;
  }
  return candidate;
}

export function currentInformationState(
  state: BotcNightInformationRuntimeState,
  step: BotcNightStep | undefined,
): BotcNightInformationState | undefined {
  if (!step) return undefined;
  for (let index = state.informationHistory.length - 1; index >= 0; index -= 1) {
    const item = state.informationHistory[index]!;
    if (
      item.nightNumber === state.nightNumber &&
      item.stepId === step.id &&
      step.actorPlayerIds.includes(item.recipientPlayerId)
    ) {
      return item;
    }
  }
  return undefined;
}

function informationReliability(
  state: BotcNightInformationRuntimeState,
  step: Extract<BotcNightStep, { kind: "role" }>,
  recipientPlayerId: string,
): TroubleBrewingInformationReliability {
  if (step.actorSource === "shown_drunk") return "drunk";
  if (state.poisonedPlayerId === recipientPlayerId) return "poisoned";
  return "reliable";
}

function cloneNumericInformationResolution(
  resolution: TroubleBrewingNumericInformationResolution,
): TroubleBrewingNumericInformationResolution {
  if (resolution.kind === "chef_pairs") {
    return {
      kind: "chef_pairs",
      pairs: resolution.pairs.map(pair => ({
        ...pair,
        playerIds: [...pair.playerIds] as [string, string],
        leftRegistration: { ...pair.leftRegistration },
        rightRegistration: { ...pair.rightRegistration },
      })),
    };
  }
  return {
    ...resolution,
    clockwiseRegistration: { ...resolution.clockwiseRegistration },
    counterclockwiseRegistration: { ...resolution.counterclockwiseRegistration },
  };
}

function cloneFortuneTellerInformationResolution(
  resolution: TroubleBrewingFortuneTellerInformationResolution,
): TroubleBrewingFortuneTellerInformationResolution {
  return {
    ...resolution,
    selectedPlayerIds: [...resolution.selectedPlayerIds] as [string, string],
    targets: resolution.targets.map(target => ({
      ...target,
      registration: { ...target.registration },
    })) as TroubleBrewingFortuneTellerInformationResolution["targets"],
  };
}

function createCommittedPairInformationResult(
  state: BotcNightInformationRuntimeState,
  step: BotcInformationStep & { roleId: TroubleBrewingPairInformationAbilityRoleId },
  recipientPlayerId: string,
  reliability: TroubleBrewingInformationReliability,
): TroubleBrewingPairInformationResult {
  const legalCandidates = createTroubleBrewingPairInformationCandidates(
    state.assignments,
    step.roleId,
    recipientPlayerId,
  );
  const request = createPairInformationRecommendationRequest(
    step.roleId,
    recipientPlayerId,
    reliability,
    legalCandidates,
  );
  const recommendation = recommendPairInformationBaselineV1(request);
  const selected = legalCandidates.find(
    candidate => candidate.candidateId === recommendation.candidateId,
  );
  if (!selected) {
    throw new Error("Pair information recommendation selected a missing legal candidate");
  }

  if (isTroubleBrewingPairCandidate(selected)) {
    const selectedResolution = [...selected.legalResolutions].sort((left, right) =>
      `${left.matchingPlayerId}:${left.matchSource}`.localeCompare(
        `${right.matchingPlayerId}:${right.matchSource}`,
      ),
    )[0];
    if (!selectedResolution) {
      throw new Error("Pair information candidate has no legal resolution");
    }
    return {
      kind: "pair",
      abilityRoleId: step.roleId,
      recipientPlayerId,
      learnedRoleId: selected.learnedRoleId,
      shownPlayerIds: [...selected.shownPlayerIds] as [string, string],
      reliability,
      semanticTruth: "true",
      selectedCandidateId: selected.candidateId,
      selectedResolution: { ...selectedResolution },
    };
  }

  if (step.roleId !== "librarian") {
    throw new Error("Only Librarian can commit a no-characters information result");
  }
  const selectedResolution = selected.legalResolutions[0];
  if (!selectedResolution) {
    throw new Error("No-characters information candidate has no legal resolution");
  }
  return {
    kind: "no_characters",
    abilityRoleId: "librarian",
    recipientPlayerId,
    noCharacterCategory: selected.noCharacterCategory,
    reliability,
    semanticTruth: "true",
    selectedCandidateId: selected.candidateId,
    selectedResolution: { ...selectedResolution },
  };
}

function createCommittedNumericInformationResult(
  state: BotcNightInformationRuntimeState,
  step: BotcInformationStep & { roleId: TroubleBrewingNumericInformationAbilityRoleId },
  recipientPlayerId: string,
  reliability: TroubleBrewingInformationReliability,
): TroubleBrewingNightInformationResult {
  const legalCandidates = step.roleId === "chef"
    ? createTroubleBrewingChefInformationCandidates(
        state.assignments,
        state.seatingPlayerIds,
      )
    : createTroubleBrewingEmpathInformationCandidates(
        state.assignments,
        state.seatingPlayerIds,
        state.deadPlayerIds,
        recipientPlayerId,
      );
  const request = createNumericInformationRecommendationRequest(
    step.roleId,
    recipientPlayerId,
    reliability,
    legalCandidates,
  );
  const recommendation = recommendNumericInformationBaselineV1(request);
  const selected = legalCandidates.find(
    candidate => candidate.candidateId === recommendation.candidateId,
  );
  if (!selected) {
    throw new Error("Numeric information recommendation selected a missing legal candidate");
  }
  const selectedResolution = selected.legalResolutions[0];
  if (!selectedResolution) {
    throw new Error("Numeric information candidate has no legal resolution");
  }
  return {
    kind: "number",
    abilityRoleId: step.roleId,
    recipientPlayerId,
    value: selected.value,
    reliability,
    semanticTruth: "true",
    selectedCandidateId: selected.candidateId,
    selectedResolution: cloneNumericInformationResolution(selectedResolution),
  };
}

function createCommittedFortuneTellerInformationResult(
  state: BotcNightInformationRuntimeState,
  step: BotcInformationStep & { roleId: "fortune_teller" },
  recipientPlayerId: string,
  reliability: TroubleBrewingInformationReliability,
): TroubleBrewingNightInformationResult {
  const choice = currentFortuneTellerChoice(state);
  if (!choice) {
    throw new Error("Fortune Teller must choose two players before information can be committed");
  }
  if (!state.redHerring) {
    throw new Error("Fortune Teller Red Herring is not committed");
  }
  const legalCandidates = createTroubleBrewingFortuneTellerInformationCandidates(
    state.assignments,
    choice.playerIds,
    state.redHerring.playerId,
  );
  const request = createFortuneTellerInformationRecommendationRequest(
    recipientPlayerId,
    reliability,
    legalCandidates,
  );
  const recommendation = recommendFortuneTellerInformationBaselineV1(request);
  const selected = legalCandidates.find(
    candidate => candidate.candidateId === recommendation.candidateId,
  );
  if (!selected) {
    throw new Error("Fortune Teller recommendation selected a missing legal candidate");
  }
  const selectedResolution = selected.legalResolutions[0];
  if (!selectedResolution) {
    throw new Error("Fortune Teller information candidate has no legal resolution");
  }
  return {
    kind: "boolean",
    abilityRoleId: step.roleId,
    recipientPlayerId,
    value: selected.value,
    reliability,
    semanticTruth: "true",
    selectedCandidateId: selected.candidateId,
    selectedResolution: cloneFortuneTellerInformationResolution(selectedResolution),
  };
}

function createCommittedSpyGrimoireResult(
  state: BotcNightInformationRuntimeState,
  recipientPlayerId: string,
  reliability: TroubleBrewingInformationReliability,
): TroubleBrewingNightInformationResult {
  const snapshot = createTroubleBrewingSpyGrimoireSnapshot({
    assignments: state.assignments,
    seatingPlayerIds: state.seatingPlayerIds,
    deadPlayerIds: state.deadPlayerIds,
    ...(state.poisonedPlayerId
      ? { poisonedPlayerId: state.poisonedPlayerId }
      : {}),
    ...(state.butlerMasterPlayerId
      ? { butlerMasterPlayerId: state.butlerMasterPlayerId }
      : {}),
    ...(state.redHerring?.playerId
      ? { redHerringPlayerId: state.redHerring.playerId }
      : {}),
    includeFirstNightPairInformation: state.phase === "first_night",
  });
  return {
    kind: "spy_grimoire",
    abilityRoleId: "spy",
    recipientPlayerId,
    reliability,
    semanticTruth: "true",
    selectedCandidateId: "spy:grimoire:truthful",
    ...snapshot,
  };
}

export function commitCurrentNightInformation(
  state: BotcNightInformationRuntimeState,
  step: BotcNightStep | undefined,
): BotcNightInformationState {
  const activeStep = informationReadyStep(state, step);
  if (!activeStep) {
    throw new Error("Active BotC night step does not support committed information yet");
  }
  const recipientPlayerId = activeStep.actorPlayerIds[0];
  if (!recipientPlayerId || activeStep.actorPlayerIds.length !== 1) {
    throw new Error("Night information requires exactly one active recipient");
  }
  if (currentInformationState(state, activeStep)) {
    throw new Error("Active BotC night information is already committed");
  }

  const reliability = informationReliability(state, activeStep, recipientPlayerId);
  const result = isPairInformationRole(activeStep.roleId)
    ? createCommittedPairInformationResult(
        state,
        activeStep as BotcInformationStep & {
          roleId: TroubleBrewingPairInformationAbilityRoleId;
        },
        recipientPlayerId,
        reliability,
      )
    : isNumericInformationRole(activeStep.roleId)
      ? createCommittedNumericInformationResult(
          state,
          activeStep as BotcInformationStep & {
            roleId: TroubleBrewingNumericInformationAbilityRoleId;
          },
          recipientPlayerId,
          reliability,
        )
      : activeStep.roleId === "spy"
        ? createCommittedSpyGrimoireResult(state, recipientPlayerId, reliability)
        : createCommittedFortuneTellerInformationResult(
            state,
            activeStep as BotcInformationStep & { roleId: "fortune_teller" },
            recipientPlayerId,
            reliability,
          );

  const committed: BotcNightInformationState = {
    stepId: activeStep.id,
    nightNumber: state.nightNumber,
    recipientPlayerId,
    result,
    selectionSource: "baseline_v1",
    acknowledged: false,
  };
  state.informationHistory.push(committed);
  return committed;
}

export function cloneNightInformationState(
  information: BotcNightInformationState,
): BotcNightInformationState {
  const result = information.result.kind === "pair"
    ? {
        ...information.result,
        shownPlayerIds: [...information.result.shownPlayerIds] as [string, string],
        selectedResolution: { ...information.result.selectedResolution },
      }
    : information.result.kind === "number"
      ? {
          ...information.result,
          selectedResolution: cloneNumericInformationResolution(
            information.result.selectedResolution,
          ),
        }
      : information.result.kind === "boolean"
        ? {
            ...information.result,
            selectedResolution: cloneFortuneTellerInformationResolution(
              information.result.selectedResolution,
            ),
          }
        : information.result.kind === "spy_grimoire"
          ? {
              ...information.result,
              ...cloneTroubleBrewingSpyGrimoireSnapshot(information.result),
            }
          : {
              ...information.result,
              selectedResolution: { ...information.result.selectedResolution },
            };
  return {
    ...information,
    result,
  };
}

export function moderatorInformationDecision(
  state: BotcNightInformationRuntimeState,
  step: BotcNightStep | undefined,
): BotcModeratorInformationDecisionView | undefined {
  const activeStep = informationReadyStep(state, step);
  const recipientPlayerId = activeStep?.actorPlayerIds[0];
  if (!activeStep || !recipientPlayerId) return undefined;
  return {
    stepId: activeStep.id,
    recipientPlayerId,
    roleId: activeStep.roleId,
    committed: Boolean(currentInformationState(state, activeStep)),
  };
}
