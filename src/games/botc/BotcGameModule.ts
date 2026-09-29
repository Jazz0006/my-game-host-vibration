import type {
  GameCommandContext,
  GameCommandResult,
  GameModule,
  GameModuleDependencies,
  GameViewContext,
} from "../../core/game/GameModule.js";
import {
  TROUBLE_BREWING_SCRIPT_ID,
  isTroubleBrewingRoleId,
  troubleBrewingExpectedCounts,
  troubleBrewingRole,
  type BotcRoleCategory,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import {
  createTroubleBrewingFirstNightSequence,
  type BotcNightStep,
} from "./TroubleBrewingNightSequence.js";

export type BotcGameConfig = {
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
};

export type BotcSetupAssignment = {
  playerId: string;
  actualRoleId: TroubleBrewingRoleId;
  shownRoleId?: TroubleBrewingRoleId;
};

export type BotcCreateInput = {
  playerIds: readonly string[];
  config: BotcGameConfig;
  assignments: readonly BotcSetupAssignment[];
};

export type BotcGamePhase = "role_reveal" | "first_night" | "day";

export type BotcGameState = {
  scriptId: typeof TROUBLE_BREWING_SCRIPT_ID;
  phase: BotcGamePhase;
  assignments: Array<{
    playerId: string;
    actualRoleId: TroubleBrewingRoleId;
    shownRoleId: TroubleBrewingRoleId;
  }>;
  confirmedRolePlayerIds: string[];
  dayNumber: number;
  nightNumber: number;
  deadPlayerIds: string[];
  nightStepIndex?: number;
};

export type BotcCommand =
  | { type: "confirmRole" }
  | { type: "beginFirstNight" }
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
  assignments: Array<{
    playerId: string;
    actualRoleId: TroubleBrewingRoleId;
    shownRoleId: TroubleBrewingRoleId;
  }>;
  nightStep?: BotcNightStep;
};

function unique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function normalizeAssignments(
  input: BotcCreateInput,
): BotcGameState["assignments"] {
  if (input.config.scriptId !== TROUBLE_BREWING_SCRIPT_ID) {
    throw new Error("Only Trouble Brewing is supported in B0");
  }
  if (input.assignments.length !== input.playerIds.length) {
    throw new Error("BotC setup must assign exactly one role to every player");
  }

  unique(input.playerIds, "BotC player IDs must be unique");
  unique(
    input.assignments.map(assignment => assignment.playerId),
    "BotC setup contains duplicate player assignments",
  );

  const playerIds = new Set(input.playerIds);
  const normalized = input.assignments.map(assignment => {
    if (!playerIds.has(assignment.playerId)) {
      throw new Error("BotC setup assignment references a non-player");
    }
    if (!isTroubleBrewingRoleId(assignment.actualRoleId)) {
      throw new Error("BotC setup contains an unknown actual role");
    }

    if (assignment.actualRoleId === "drunk") {
      if (!assignment.shownRoleId) {
        throw new Error("Drunk setup requires a shown Townsfolk role");
      }
      const shown = troubleBrewingRole(assignment.shownRoleId);
      if (shown.category !== "townsfolk") {
        throw new Error("Drunk shown role must be a Townsfolk");
      }
      return {
        playerId: assignment.playerId,
        actualRoleId: assignment.actualRoleId,
        shownRoleId: assignment.shownRoleId,
      };
    }

    if (
      assignment.shownRoleId !== undefined &&
      assignment.shownRoleId !== assignment.actualRoleId
    ) {
      throw new Error("Only the Drunk may be shown a different setup role");
    }
    return {
      playerId: assignment.playerId,
      actualRoleId: assignment.actualRoleId,
      shownRoleId: assignment.actualRoleId,
    };
  });

  unique(
    normalized.map(assignment => assignment.actualRoleId),
    "Trouble Brewing setup cannot contain duplicate actual characters",
  );

  const actualRoles = normalized.map(assignment => assignment.actualRoleId);
  const drunk = normalized.find(assignment => assignment.actualRoleId === "drunk");
  if (drunk && actualRoles.includes(drunk.shownRoleId)) {
    throw new Error("Drunk shown Townsfolk character must not be actually in play");
  }

  const expected = troubleBrewingExpectedCounts(input.playerIds.length, actualRoles);
  const actual: Record<BotcRoleCategory, number> = {
    townsfolk: 0,
    outsider: 0,
    minion: 0,
    demon: 0,
  };
  for (const roleId of actualRoles) {
    actual[troubleBrewingRole(roleId).category] += 1;
  }
  for (const category of Object.keys(actual) as BotcRoleCategory[]) {
    if (actual[category] !== expected[category]) {
      throw new Error(
        `Illegal Trouble Brewing setup: expected ${expected[category]} ${category}, got ${actual[category]}`,
      );
    }
  }

  return normalized;
}

function firstNightSequence(state: BotcGameState): BotcNightStep[] {
  return createTroubleBrewingFirstNightSequence(state.assignments);
}

function currentNightStep(state: BotcGameState): BotcNightStep | undefined {
  if (state.phase !== "first_night" || state.nightStepIndex === undefined) {
    return undefined;
  }
  return firstNightSequence(state)[state.nightStepIndex];
}

function playerNightStepView(
  step: BotcNightStep,
): BotcPlayerNightStepView {
  return step.kind === "role"
    ? {
        id: step.id,
        kind: step.kind,
        roleId: step.roleId,
      }
    : {
        id: step.id,
        kind: step.kind,
      };
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
    return {
      scriptId: TROUBLE_BREWING_SCRIPT_ID,
      phase: "role_reveal",
      assignments: normalizeAssignments(input),
      confirmedRolePlayerIds: [],
      dayNumber: 0,
      nightNumber: 0,
      deadPlayerIds: [],
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

      case "completeNightStep": {
        if (!context.isModerator) {
          throw new Error("Only the BotC moderator can complete a night step");
        }
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
    }
  }

  getPlayerView(
    state: BotcGameState,
    playerId: string,
    _context: GameViewContext,
  ): BotcPlayerView {
    const assignment = state.assignments.find(item => item.playerId === playerId);
    if (!assignment) return { phase: state.phase, mode: "spectator" };

    const shownRole = troubleBrewingRole(assignment.shownRoleId);
    const confirmed = state.confirmedRolePlayerIds.includes(playerId);
    const base = {
      phase: state.phase,
      roleId: shownRole.id,
      roleName: shownRole.name,
      roleNameZh: shownRole.nameZh,
      roleCategory: shownRole.category,
      roleConfirmed: confirmed,
    };

    if (state.phase === "role_reveal") {
      return {
        ...base,
        mode: confirmed ? "waiting" : "role_reveal",
      };
    }

    if (state.phase === "first_night") {
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
