import type {
  GameCommandContext,
  GameCommandResult,
  GameModule,
  GameModuleDependencies,
  GameViewContext,
} from "../../core/game/GameModule.js";
import {
  TROUBLE_BREWING_SCRIPT_ID,
  troubleBrewingRole,
  type BotcRoleCategory,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import {
  createTroubleBrewingFirstNightSequence,
  type BotcNightStep,
  type TroubleBrewingOtherNightFacts,
  type TroubleBrewingOtherNightRoleTransition,
} from "./TroubleBrewingNightSequence.js";
import {
  advanceTroubleBrewingOtherNightProgress,
  startTroubleBrewingOtherNightProgress,
  type TroubleBrewingOtherNightProgress,
} from "./TroubleBrewingNightProgression.js";
import {
  resolveTroubleBrewingNightChoice,
  troubleBrewingNightChoiceSpec,
  type TroubleBrewingNightChoiceSpec,
} from "./TroubleBrewingNightInteraction.js";
import {
  normalizeTroubleBrewingSetup,
  type BotcCanonicalSetupAssignment,
  type BotcSetupAssignment,
} from "./TroubleBrewingSetup.js";
import {
  createTroubleBrewingDemonInfoFacts,
  createTroubleBrewingPairInformationCandidates,
  isTroubleBrewingPairCandidate,
  type TroubleBrewingDemonInfoFacts,
  type TroubleBrewingInformationReliability,
  type TroubleBrewingPairInformationAbilityRoleId,
  type TroubleBrewingPairInformationResult,
} from "./TroubleBrewingInformation.js";
import {
  createDemonBluffRecommendationRequest,
  createPairInformationRecommendationRequest,
  recommendDemonBluffsBaselineV1,
  recommendPairInformationBaselineV1,
  validateDemonBluffRecommendation,
} from "./TroubleBrewingRecommendation.js";

export type { BotcSetupAssignment } from "./TroubleBrewingSetup.js";

export type BotcGameConfig = {
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
};

export type BotcCreateInput = {
  playerIds: readonly string[];
  config: BotcGameConfig;
  assignments: readonly BotcSetupAssignment[];
};

export type BotcGamePhase =
  | "role_reveal"
  | "first_night"
  | "day"
  | "other_night";

export type BotcDemonInfoSelectionSource = "moderator" | "baseline_v1";

export type BotcDemonInfoState = {
  demonPlayerId: string;
  minionPlayerIds: string[];
  bluffRoleIds: TroubleBrewingRoleId[];
  selectionSource: BotcDemonInfoSelectionSource;
};

export type BotcNightInformationSelectionSource = "baseline_v1";

export type BotcNightInformationState = {
  stepId: BotcNightStep["id"];
  nightNumber: number;
  recipientPlayerId: string;
  result: TroubleBrewingPairInformationResult;
  selectionSource: BotcNightInformationSelectionSource;
  acknowledged: boolean;
};

export type BotcGameState = {
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
  phase: BotcGamePhase;
  assignments: BotcCanonicalSetupAssignment[];
  confirmedRolePlayerIds: string[];
  dayNumber: number;
  nightNumber: number;
  deadPlayerIds: string[];
  diedTonightPlayerIds: string[];
  executedAndDiedTodayPlayerId?: string;
  roleTransitions: TroubleBrewingOtherNightRoleTransition[];
  demonInfo?: BotcDemonInfoState;
  informationHistory: BotcNightInformationState[];
  poisonedPlayerId?: string;
  butlerMasterPlayerId?: string;
  nightStepIndex?: number;
  otherNightProgress?: TroubleBrewingOtherNightProgress;
};

export type BotcCommand =
  | { type: "confirmRole" }
  | { type: "setDemonBluffs"; roleIds: TroubleBrewingRoleId[] }
  | { type: "beginFirstNight" }
  | { type: "beginOtherNight" }
  | { type: "submitNightChoice"; playerIds: string[] }
  | { type: "commitNightInformation" }
  | { type: "acknowledgeNightInformation" }
  | { type: "completeNightStep" };

export type BotcCommandOutcome =
  | {
      kind: "roleConfirmed";
      allConfirmed: boolean;
    }
  | {
      kind: "demonBluffsCommitted";
      source: BotcDemonInfoSelectionSource;
      roleIds: TroubleBrewingRoleId[];
    }
  | {
      kind: "firstNightStarted";
      firstStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "otherNightStarted";
      firstStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "nightChoiceCommitted";
      completedStepId: BotcNightStep["id"];
      selectedPlayerIds: string[];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "nightInformationCommitted";
      stepId: BotcNightStep["id"];
      recipientPlayerId: string;
      candidateId: string;
      selectionSource: BotcNightInformationSelectionSource;
    }
  | {
      kind: "nightInformationAcknowledged";
      completedStepId: BotcNightStep["id"];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    }
  | {
      kind: "nightStepCompleted";
      completedStepId: BotcNightStep["id"];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    };

export type BotcPlayerNightStepView = {
  id: BotcNightStep["id"];
  kind: BotcNightStep["kind"];
  roleId?: TroubleBrewingRoleId;
  choice?: TroubleBrewingNightChoiceSpec;
};

export type BotcMinionInfoView = {
  demonPlayerId: string;
  fellowMinionPlayerIds: string[];
};

export type BotcDemonInfoView = {
  minionPlayerIds: string[];
  bluffRoles: Array<{
    id: TroubleBrewingRoleId;
    name: string;
    nameZh: string;
  }>;
};

export type BotcPrivateInformationView =
  | {
      kind: "pair";
      abilityRoleId: TroubleBrewingPairInformationAbilityRoleId;
      learnedRole: {
        id: TroubleBrewingRoleId;
        name: string;
        nameZh: string;
      };
      shownPlayerIds: [string, string];
    }
  | {
      kind: "no_characters";
      abilityRoleId: "librarian";
      noCharacterCategory: "outsider";
    };

export type BotcModeratorInformationDecisionView = {
  stepId: BotcNightStep["id"];
  recipientPlayerId: string;
  roleId: TroubleBrewingRoleId;
  committed: boolean;
};

export type BotcPlayerView = {
  phase: BotcGamePhase;
  mode: "role_reveal" | "waiting" | "night_wake" | "day" | "spectator";
  roleId?: TroubleBrewingRoleId;
  roleName?: string;
  roleNameZh?: string;
  roleCategory?: BotcRoleCategory;
  roleConfirmed?: boolean;
  nightStep?: BotcPlayerNightStepView;
  minionInfo?: BotcMinionInfoView;
  demonInfo?: BotcDemonInfoView;
  privateInformation?: BotcPrivateInformationView;
};

export type BotcPublicView = {
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
  phase: BotcGamePhase;
  playerCount: number;
  confirmedRoles: number;
  dayNumber: number;
  nightNumber: number;
  deadPlayerIds: string[];
};

export type BotcModeratorView = BotcPublicView & {
  assignments: BotcCanonicalSetupAssignment[];
  nightStep?: BotcNightStep;
  nightEffects?: {
    poisonedPlayerId?: string;
    butlerMasterPlayerId?: string;
  };
  demonInfo?: BotcDemonInfoView;
  informationDecision?: BotcModeratorInformationDecisionView;
  currentInformation?: BotcNightInformationState;
};

function firstNightSequence(state: BotcGameState): BotcNightStep[] {
  return createTroubleBrewingFirstNightSequence(state.assignments);
}

function demonInfoFacts(state: BotcGameState): TroubleBrewingDemonInfoFacts {
  return createTroubleBrewingDemonInfoFacts(state.assignments);
}

function demonBluffRecommendationRequest(
  state: BotcGameState,
  facts: TroubleBrewingDemonInfoFacts,
) {
  const drunk = state.assignments.find(
    assignment => assignment.actualRoleId === "drunk",
  );
  return createDemonBluffRecommendationRequest(
    facts,
    drunk ? { shownDrunkRoleId: drunk.shownRoleId } : undefined,
  );
}

function commitDemonBluffs(
  state: BotcGameState,
  roleIds: TroubleBrewingRoleId[],
  selectionSource: BotcDemonInfoSelectionSource,
): BotcDemonInfoState {
  const facts = demonInfoFacts(state);
  const request = demonBluffRecommendationRequest(state, facts);
  const recommendation = validateDemonBluffRecommendation(request, { roleIds });

  const committed: BotcDemonInfoState = {
    demonPlayerId: facts.demonPlayerId,
    minionPlayerIds: [...facts.minionPlayerIds],
    bluffRoleIds: [...recommendation.roleIds],
    selectionSource,
  };
  state.demonInfo = committed;
  return committed;
}

function ensureAutomaticDemonBluffs(
  state: BotcGameState,
  dependencies: GameModuleDependencies,
): void {
  if (state.assignments.length < 7 || state.demonInfo) return;

  const facts = demonInfoFacts(state);
  const request = demonBluffRecommendationRequest(state, facts);
  const recommendation = recommendDemonBluffsBaselineV1(
    request,
    dependencies.random,
  );
  commitDemonBluffs(state, recommendation.roleIds, "baseline_v1");
}

function minionInfoView(
  state: BotcGameState,
  playerId: string,
): BotcMinionInfoView | undefined {
  const facts = demonInfoFacts(state);
  if (!facts.minionPlayerIds.includes(playerId)) return undefined;
  return {
    demonPlayerId: facts.demonPlayerId,
    fellowMinionPlayerIds: facts.minionPlayerIds.filter(
      minionPlayerId => minionPlayerId !== playerId,
    ),
  };
}

function demonInfoView(state: BotcGameState): BotcDemonInfoView | undefined {
  const info = state.demonInfo;
  if (!info) return undefined;

  return {
    minionPlayerIds: [...info.minionPlayerIds],
    bluffRoles: info.bluffRoleIds.map(roleId => {
      const role = troubleBrewingRole(roleId);
      return {
        id: role.id,
        name: role.name,
        nameZh: role.nameZh,
      };
    }),
  };
}

type BotcPairInformationStep = Extract<BotcNightStep, { kind: "role" }> & {
  roleId: TroubleBrewingPairInformationAbilityRoleId;
};

function pairInformationStep(
  step: BotcNightStep | undefined,
): BotcPairInformationStep | undefined {
  if (step?.kind !== "role") return undefined;
  if (
    step.roleId !== "washerwoman" &&
    step.roleId !== "librarian" &&
    step.roleId !== "investigator"
  ) {
    return undefined;
  }
  return step as BotcPairInformationStep;
}

function currentInformationState(
  state: BotcGameState,
  step: BotcNightStep | undefined = currentNightStep(state),
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
  state: BotcGameState,
  step: Extract<BotcNightStep, { kind: "role" }>,
  recipientPlayerId: string,
): TroubleBrewingInformationReliability {
  if (step.actorSource === "shown_drunk") return "drunk";
  if (state.poisonedPlayerId === recipientPlayerId) return "poisoned";
  return "reliable";
}

function commitCurrentPairInformation(
  state: BotcGameState,
): BotcNightInformationState {
  const step = pairInformationStep(currentNightStep(state));
  if (!step) {
    throw new Error("Active BotC night step does not support committed information yet");
  }
  const recipientPlayerId = step.actorPlayerIds[0];
  if (!recipientPlayerId || step.actorPlayerIds.length !== 1) {
    throw new Error("Pair information requires exactly one active recipient");
  }
  if (currentInformationState(state, step)) {
    throw new Error("Active BotC night information is already committed");
  }

  const reliability = informationReliability(state, step, recipientPlayerId);
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

  let result: TroubleBrewingPairInformationResult;
  if (isTroubleBrewingPairCandidate(selected)) {
    const selectedResolution = [...selected.legalResolutions].sort((left, right) =>
      `${left.matchingPlayerId}:${left.matchSource}`.localeCompare(
        `${right.matchingPlayerId}:${right.matchSource}`,
      ),
    )[0];
    if (!selectedResolution) {
      throw new Error("Pair information candidate has no legal resolution");
    }
    result = {
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
  } else {
    if (step.roleId !== "librarian") {
      throw new Error("Only Librarian can commit a no-characters information result");
    }
    const selectedResolution = selected.legalResolutions[0];
    if (!selectedResolution) {
      throw new Error("No-characters information candidate has no legal resolution");
    }
    result = {
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

  const committed: BotcNightInformationState = {
    stepId: step.id,
    nightNumber: state.nightNumber,
    recipientPlayerId,
    result,
    selectionSource: "baseline_v1",
    acknowledged: false,
  };
  state.informationHistory.push(committed);
  return committed;
}

function cloneNightInformationState(
  information: BotcNightInformationState,
): BotcNightInformationState {
  const result =
    information.result.kind === "pair"
      ? {
          ...information.result,
          shownPlayerIds: [...information.result.shownPlayerIds] as [string, string],
          selectedResolution: { ...information.result.selectedResolution },
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

function privateInformationView(
  information: BotcNightInformationState,
): BotcPrivateInformationView {
  if (information.result.kind === "no_characters") {
    return {
      kind: "no_characters",
      abilityRoleId: information.result.abilityRoleId,
      noCharacterCategory: information.result.noCharacterCategory,
    };
  }

  const learnedRole = troubleBrewingRole(information.result.learnedRoleId);
  return {
    kind: "pair",
    abilityRoleId: information.result.abilityRoleId,
    learnedRole: {
      id: learnedRole.id,
      name: learnedRole.name,
      nameZh: learnedRole.nameZh,
    },
    shownPlayerIds: [...information.result.shownPlayerIds] as [string, string],
  };
}

function moderatorInformationDecision(
  state: BotcGameState,
  step: BotcNightStep | undefined,
): BotcModeratorInformationDecisionView | undefined {
  const informationStep = pairInformationStep(step);
  const recipientPlayerId = informationStep?.actorPlayerIds[0];
  if (!informationStep || !recipientPlayerId) return undefined;
  return {
    stepId: informationStep.id,
    recipientPlayerId,
    roleId: informationStep.roleId,
    committed: Boolean(currentInformationState(state, informationStep)),
  };
}

function otherNightFacts(state: BotcGameState): TroubleBrewingOtherNightFacts {
  return {
    assignments: state.assignments,
    deadPlayerIds: state.deadPlayerIds,
    diedTonightPlayerIds: state.diedTonightPlayerIds,
    ...(state.executedAndDiedTodayPlayerId
      ? { executedAndDiedTodayPlayerId: state.executedAndDiedTodayPlayerId }
      : {}),
    roleTransitions: state.roleTransitions,
  };
}

function currentNightStep(state: BotcGameState): BotcNightStep | undefined {
  if (state.phase === "first_night") {
    if (state.nightStepIndex === undefined) return undefined;
    return firstNightSequence(state)[state.nightStepIndex];
  }

  if (state.phase === "other_night") {
    return state.otherNightProgress?.activeStep;
  }

  return undefined;
}

function playerNightStepView(
  step: BotcNightStep,
  playerId: string,
  participantPlayerIds: readonly string[],
): BotcPlayerNightStepView {
  if (step.kind === "system_info") {
    return {
      id: step.id,
      kind: step.kind,
    };
  }

  const choice = troubleBrewingNightChoiceSpec(
    step,
    playerId,
    participantPlayerIds,
  );
  return {
    id: step.id,
    kind: step.kind,
    roleId: step.roleId,
    ...(choice ? { choice } : {}),
  };
}

function commitResolvedRoleTransitions(state: BotcGameState): void {
  for (const transition of state.roleTransitions) {
    const newImpPlayerId =
      transition.kind === "scarlet_woman_to_imp"
        ? transition.playerId
        : transition.newImpPlayerId;
    const assignment = state.assignments.find(
      item => item.playerId === newImpPlayerId,
    );
    if (!assignment) {
      throw new Error("BotC role transition references a non-player");
    }
    assignment.actualRoleId = "imp";
    assignment.shownRoleId = "imp";
  }
}

function clearCompletedOtherNightFacts(state: BotcGameState): void {
  state.diedTonightPlayerIds = [];
  state.roleTransitions = [];
  delete state.executedAndDiedTodayPlayerId;
  delete state.otherNightProgress;
}

function advanceCurrentNightStep(
  state: BotcGameState,
): Extract<BotcCommandOutcome, { kind: "nightStepCompleted" }> {
  if (state.phase === "first_night") {
    const step = currentNightStep(state);
    if (!step || state.nightStepIndex === undefined) {
      throw new Error("There is no active BotC night step");
    }

    const sequence = firstNightSequence(state);
    const nextStep = sequence[state.nightStepIndex + 1];
    if (!nextStep) {
      state.phase = "day";
      state.dayNumber = 1;
      delete state.nightStepIndex;
      return {
        kind: "nightStepCompleted",
        completedStepId: step.id,
        nightComplete: true,
      };
    }

    state.nightStepIndex += 1;
    return {
      kind: "nightStepCompleted",
      completedStepId: step.id,
      nextStepId: nextStep.id,
      nightComplete: false,
    };
  }

  if (state.phase === "other_night" && state.otherNightProgress?.activeStep) {
    const advanced = advanceTroubleBrewingOtherNightProgress(
      otherNightFacts(state),
      state.otherNightProgress,
    );
    state.otherNightProgress = advanced.progress;

    if (!advanced.nextStep) {
      state.phase = "day";
      state.dayNumber += 1;
      commitResolvedRoleTransitions(state);
      clearCompletedOtherNightFacts(state);
      return {
        kind: "nightStepCompleted",
        completedStepId: advanced.completedStep.id,
        nightComplete: true,
      };
    }

    return {
      kind: "nightStepCompleted",
      completedStepId: advanced.completedStep.id,
      nextStepId: advanced.nextStep.id,
      nightComplete: false,
    };
  }

  throw new Error("There is no active BotC night step");
}

function publicView(state: BotcGameState): BotcPublicView {
  return {
    scriptId: state.scriptId,
    phase: state.phase,
    playerCount: state.assignments.length,
    confirmedRoles: state.confirmedRolePlayerIds.length,
    dayNumber: state.dayNumber,
    nightNumber: state.nightNumber,
    deadPlayerIds: [...state.deadPlayerIds],
  };
}

export class BotcGameModule implements GameModule<
  BotcGameState,
  BotcCommand,
  BotcPlayerView,
  BotcModeratorView,
  BotcPublicView,
  BotcCreateInput,
  BotcCommandOutcome
> {
  readonly type = "botc";

  createGame(input: BotcCreateInput, _dependencies: GameModuleDependencies): BotcGameState {
    if (input.config.scriptId !== TROUBLE_BREWING_SCRIPT_ID) {
      throw new Error("Only Trouble Brewing is supported in B0");
    }

    return {
      scriptId: TROUBLE_BREWING_SCRIPT_ID,
      phase: "role_reveal",
      assignments: normalizeTroubleBrewingSetup(input.playerIds, input.assignments),
      confirmedRolePlayerIds: [],
      dayNumber: 0,
      nightNumber: 0,
      deadPlayerIds: [],
      diedTonightPlayerIds: [],
      roleTransitions: [],
      informationHistory: [],
    };
  }

  handleCommand(
    state: BotcGameState,
    context: GameCommandContext,
    command: BotcCommand,
    dependencies: GameModuleDependencies,
  ): GameCommandResult<BotcGameState, BotcCommandOutcome> {
    switch (command.type) {
      case "confirmRole": {
        if (state.phase !== "role_reveal") {
          throw new Error("BotC role confirmation is closed");
        }
        if (!context.playerId) throw new Error("player command requires playerId");
        if (!state.assignments.some(assignment => assignment.playerId === context.playerId)) {
          throw new Error("Only a seated BotC player can confirm a role");
        }
        if (!state.confirmedRolePlayerIds.includes(context.playerId)) {
          state.confirmedRolePlayerIds.push(context.playerId);
        }
        return {
          state,
          outcome: {
            kind: "roleConfirmed",
            allConfirmed:
              state.confirmedRolePlayerIds.length === state.assignments.length,
          },
        };
      }

      case "setDemonBluffs": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can set Demon bluffs");
        }
        if (state.phase !== "role_reveal") {
          throw new Error("Demon bluffs can only be set before the first night");
        }

        const committed = commitDemonBluffs(
          state,
          command.roleIds,
          "moderator",
        );
        return {
          state,
          outcome: {
            kind: "demonBluffsCommitted",
            source: committed.selectionSource,
            roleIds: [...committed.bluffRoleIds],
          },
        };
      }

      case "beginFirstNight": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can begin the first night");
        }
        if (state.phase !== "role_reveal") {
          throw new Error("BotC first night can only begin after role reveal");
        }
        if (state.confirmedRolePlayerIds.length !== state.assignments.length) {
          throw new Error("All BotC players must confirm their shown role first");
        }

        ensureAutomaticDemonBluffs(state, dependencies);

        const sequence = firstNightSequence(state);
        const firstStep = sequence[0];
        state.nightNumber = 1;
        if (!firstStep) {
          state.phase = "day";
          state.dayNumber = 1;
          delete state.nightStepIndex;
          return {
            state,
            outcome: {
              kind: "firstNightStarted",
              nightComplete: true,
            },
          };
        }

        state.phase = "first_night";
        state.nightStepIndex = 0;
        return {
          state,
          outcome: {
            kind: "firstNightStarted",
            firstStepId: firstStep.id,
            nightComplete: false,
          },
        };
      }

      case "beginOtherNight": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can begin another night");
        }
        if (state.phase !== "day") {
          throw new Error("BotC other night can only begin from day");
        }

        // Night-start is dusk for these day-spanning effects. The previous
        // Poisoner target becomes healthy and the previous Butler master stops
        // constraining tomorrow's vote before the new nightly choices occur.
        delete state.poisonedPlayerId;
        delete state.butlerMasterPlayerId;
        state.diedTonightPlayerIds = [];
        const progress = startTroubleBrewingOtherNightProgress(otherNightFacts(state));
        state.nightNumber += 1;

        if (!progress.activeStep) {
          state.dayNumber += 1;
          clearCompletedOtherNightFacts(state);
          return {
            state,
            outcome: {
              kind: "otherNightStarted",
              nightComplete: true,
            },
          };
        }

        state.phase = "other_night";
        state.otherNightProgress = progress;
        return {
          state,
          outcome: {
            kind: "otherNightStarted",
            firstStepId: progress.activeStep.id,
            nightComplete: false,
          },
        };
      }

      case "submitNightChoice": {
        if (!context.playerId) {
          throw new Error("player command requires playerId");
        }

        const step = currentNightStep(state);
        if (!step || !step.actorPlayerIds.includes(context.playerId)) {
          throw new Error("Only the active BotC night actor can submit this choice");
        }

        const participantPlayerIds = state.assignments.map(
          assignment => assignment.playerId,
        );
        const resolution = resolveTroubleBrewingNightChoice(
          step,
          context.playerId,
          participantPlayerIds,
          command.playerIds,
        );

        if (resolution.appliesEffect) {
          if (resolution.kind === "poisoner_target") {
            state.poisonedPlayerId = resolution.targetPlayerId;
          } else {
            state.butlerMasterPlayerId = resolution.targetPlayerId;
          }
        }

        const advanced = advanceCurrentNightStep(state);
        return {
          state,
          outcome: {
            kind: "nightChoiceCommitted",
            completedStepId: advanced.completedStepId,
            selectedPlayerIds: [resolution.targetPlayerId],
            ...(advanced.nextStepId
              ? { nextStepId: advanced.nextStepId }
              : {}),
            nightComplete: advanced.nightComplete,
          },
        };
      }

      case "commitNightInformation": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can commit night information");
        }
        const committed = commitCurrentPairInformation(state);
        return {
          state,
          outcome: {
            kind: "nightInformationCommitted",
            stepId: committed.stepId,
            recipientPlayerId: committed.recipientPlayerId,
            candidateId: committed.result.selectedCandidateId,
            selectionSource: committed.selectionSource,
          },
        };
      }

      case "acknowledgeNightInformation": {
        if (!context.playerId) {
          throw new Error("player command requires playerId");
        }
        const step = currentNightStep(state);
        const informationStep = pairInformationStep(step);
        if (
          !informationStep ||
          !informationStep.actorPlayerIds.includes(context.playerId)
        ) {
          throw new Error(
            "Only the active BotC information recipient can acknowledge this information",
          );
        }
        const information = currentInformationState(state, informationStep);
        if (!information || information.acknowledged) {
          throw new Error("Active BotC night information is not ready for acknowledgement");
        }
        information.acknowledged = true;
        const advanced = advanceCurrentNightStep(state);
        return {
          state,
          outcome: {
            kind: "nightInformationAcknowledged",
            completedStepId: advanced.completedStepId,
            ...(advanced.nextStepId
              ? { nextStepId: advanced.nextStepId }
              : {}),
            nightComplete: advanced.nightComplete,
          },
        };
      }

      case "completeNightStep": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can complete a night step");
        }

        const step = currentNightStep(state);
        if (!step) {
          throw new Error("There is no active BotC night step");
        }
        if (pairInformationStep(step)) {
          const information = currentInformationState(state, step);
          throw new Error(
            information
              ? "Active BotC information step requires player acknowledgement"
              : "Active BotC information step requires an authoritative information commit",
          );
        }
        const actorPlayerId = step.actorPlayerIds[0];
        if (
          actorPlayerId &&
          troubleBrewingNightChoiceSpec(
            step,
            actorPlayerId,
            state.assignments.map(assignment => assignment.playerId),
          )
        ) {
          throw new Error("Active BotC night step requires a player choice");
        }

        return {
          state,
          outcome: advanceCurrentNightStep(state),
        };
      }
    }
  }

  getPlayerView(
    state: BotcGameState,
    playerId: string,
    _context: GameViewContext,
  ): BotcPlayerView {
    const assignment = state.assignments.find(item => item.playerId === playerId);
    if (!assignment) return { phase: state.phase, mode: "spectator" };

    const activeStep = currentNightStep(state);
    const visibleRoleId =
      activeStep?.actorPlayerIds.includes(playerId) &&
      activeStep.kind !== "system_info" &&
      (activeStep.kind === "role_change_info" ||
        activeStep.actorSource === "role_transition")
        ? activeStep.roleId
        : assignment.shownRoleId;
    const visibleRole = troubleBrewingRole(visibleRoleId);
    const confirmed = state.confirmedRolePlayerIds.includes(playerId);
    const base = {
      phase: state.phase,
      roleId: visibleRole.id,
      roleName: visibleRole.name,
      roleNameZh: visibleRole.nameZh,
      roleCategory: visibleRole.category,
      roleConfirmed: confirmed,
    };

    if (state.phase === "role_reveal") {
      return {
        ...base,
        mode: confirmed ? "waiting" : "role_reveal",
      };
    }

    if (state.phase === "first_night" || state.phase === "other_night") {
      const step = currentNightStep(state);
      if (step?.actorPlayerIds.includes(playerId)) {
        const activeMinionInfo =
          step.id === "minion_info"
            ? minionInfoView(state, playerId)
            : undefined;
        const activeDemonInfo =
          step.id === "demon_info" &&
          state.demonInfo?.demonPlayerId === playerId
            ? demonInfoView(state)
            : undefined;
        const activeInformation = currentInformationState(state, step);
        const privateInformation =
          activeInformation &&
          !activeInformation.acknowledged &&
          activeInformation.recipientPlayerId === playerId
            ? privateInformationView(activeInformation)
            : undefined;
        return {
          ...base,
          mode: "night_wake",
          nightStep: playerNightStepView(
            step,
            playerId,
            state.assignments.map(assignment => assignment.playerId),
          ),
          ...(activeMinionInfo ? { minionInfo: activeMinionInfo } : {}),
          ...(activeDemonInfo ? { demonInfo: activeDemonInfo } : {}),
          ...(privateInformation ? { privateInformation } : {}),
        };
      }
      return {
        ...base,
        mode: "waiting",
      };
    }

    return {
      ...base,
      mode: "day",
    };
  }

  getModeratorView(
    state: BotcGameState,
    _context: GameViewContext,
  ): BotcModeratorView {
    const step = currentNightStep(state);
    const privateDemonInfo = demonInfoView(state);
    const informationDecision = moderatorInformationDecision(state, step);
    const currentInformation = currentInformationState(state, step);
    const nightEffects =
      state.poisonedPlayerId || state.butlerMasterPlayerId
        ? {
            ...(state.poisonedPlayerId
              ? { poisonedPlayerId: state.poisonedPlayerId }
              : {}),
            ...(state.butlerMasterPlayerId
              ? { butlerMasterPlayerId: state.butlerMasterPlayerId }
              : {}),
          }
        : undefined;
    return {
      ...publicView(state),
      assignments: state.assignments.map(assignment => ({ ...assignment })),
      ...(nightEffects ? { nightEffects } : {}),
      ...(step
        ? {
            nightStep: {
              ...step,
              actorPlayerIds: [...step.actorPlayerIds],
            },
          }
        : {}),
      ...(privateDemonInfo ? { demonInfo: privateDemonInfo } : {}),
      ...(informationDecision ? { informationDecision } : {}),
      ...(currentInformation
        ? { currentInformation: cloneNightInformationState(currentInformation) }
        : {}),
    };
  }

  getPublicView(
    state: BotcGameState,
    _context: GameViewContext,
  ): BotcPublicView {
    return publicView(state);
  }
}

export const botcGameModule = new BotcGameModule();

