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

export type BotcGamePhase = "role_reveal";

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
};

export type BotcCommand = { type: "confirmRole" };

export type BotcCommandOutcome = {
  kind: "roleConfirmed";
  allConfirmed: boolean;
};

export type BotcPlayerView = {
  phase: BotcGamePhase;
  mode: "role_reveal" | "waiting" | "spectator";
  roleId?: TroubleBrewingRoleId;
  roleName?: string;
  roleNameZh?: string;
  roleCategory?: BotcRoleCategory;
  roleConfirmed?: boolean;
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
    return {
      phase: state.phase,
      mode: confirmed ? "waiting" : "role_reveal",
      roleId: shownRole.id,
      roleName: shownRole.name,
      roleNameZh: shownRole.nameZh,
      roleCategory: shownRole.category,
      roleConfirmed: confirmed,
    };
  }

  getModeratorView(
    state: BotcGameState,
    _context: GameViewContext,
  ): BotcModeratorView {
    return {
      ...publicView(state),
      assignments: state.assignments.map(assignment => ({ ...assignment })),
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
