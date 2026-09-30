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
  normalizeTroubleBrewingSetup,
  type BotcCanonicalSetupAssignment,
  type BotcSetupAssignment,
} from "./TroubleBrewingSetup.js";

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
  nightStepIndex?: number;
  otherNightProgress?: TroubleBrewingOtherNightProgress;
};

export type BotcCommand =
  | { type: "confirmRole" }
  | { type: "beginFirstNight" }
  | { type: "beginOtherNight" }
  | { type: "completeNightStep" };

export type BotcCommandOutcome =
  | {
      kind: "roleConfirmed";
      allConfirmed: boolean;
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
      kind: "nightStepCompleted";
      completedStepId: BotcNightStep["id"];
      nextStepId?: BotcNightStep["id"];
      nightComplete: boolean;
    };

export type BotcPlayerNightStepView = {
  id: BotcNightStep["id"];
  kind: BotcNightStep["kind"];
  roleId?: TroubleBrewingRoleId;
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
};

function firstNightSequence(state: BotcGameState): BotcNightStep[] {
  return createTroubleBrewingFirstNightSequence(state.assignments);
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

function playerNightStepView(step: BotcNightStep): BotcPlayerNightStepView {
  return step.kind === "system_info"
    ? {
        id: step.id,
        kind: step.kind,
      }
    : {
        id: step.id,
        kind: step.kind,
        roleId: step.roleId,
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
    _dependencies: GameModuleDependencies,
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

      case "completeNightStep": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can complete a night step");
        }

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
              state,
              outcome: {
                kind: "nightStepCompleted",
                completedStepId: step.id,
                nightComplete: true,
              },
            };
          }

          state.nightStepIndex += 1;
          return {
            state,
            outcome: {
              kind: "nightStepCompleted",
              completedStepId: step.id,
              nextStepId: nextStep.id,
              nightComplete: false,
            },
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
              state,
              outcome: {
                kind: "nightStepCompleted",
                completedStepId: advanced.completedStep.id,
                nightComplete: true,
              },
            };
          }

          return {
            state,
            outcome: {
              kind: "nightStepCompleted",
              completedStepId: advanced.completedStep.id,
              nextStepId: advanced.nextStep.id,
              nightComplete: false,
            },
          };
        }

        throw new Error("There is no active BotC night step");
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
        return {
          ...base,
          mode: "night_wake",
          nightStep: playerNightStepView(step),
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
    return {
      ...publicView(state),
      assignments: state.assignments.map(assignment => ({ ...assignment })),
      ...(step
        ? {
            nightStep: {
              ...step,
              actorPlayerIds: [...step.actorPlayerIds],
            },
          }
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

