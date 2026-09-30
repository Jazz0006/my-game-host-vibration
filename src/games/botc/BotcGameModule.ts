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
  type TroubleBrewingDemonInfoFacts,
} from "./TroubleBrewingInformation.js";
import {
  createDemonBluffRecommendationRequest,
  recommendDemonBluffsBaselineV1,
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

      case "completeNightStep": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can complete a night step");
        }

        const step = currentNightStep(state);
        if (!step) {
          throw new Error("There is no active BotC night step");
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

