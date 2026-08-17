import type {
  GameCommandContext,
  GameCommandResult,
  GameModule,
  GameModuleDependencies,
  GamePlayerRef,
  GameViewContext,
} from "../../core/game/GameModule.js";
import {
  allAliveVoted,
  beginNightStart,
  closeDayVote,
  confirmRole,
  confirmSeerResult,
  startDayVote,
  startGame,
  startNight,
  submitGuardTarget,
  submitHunterExecution,
  submitSeerTarget,
  submitVote,
  submitWitchAction,
  submitWolfTarget,
  type GameConfig,
  type GamePhase,
  type GameState,
  type Role,
} from "../../domain/game.js";

export type WerewolfCreateInput = {
  playerIds: readonly string[];
  config: GameConfig;
};

export type WerewolfCommand =
  | { type: "confirmRole"; actionId?: string }
  | { type: "startNight" }
  | { type: "submitWolfTarget"; targetPlayerId?: string | null; actionId?: string }
  | { type: "submitGuardTarget"; targetPlayerId?: string | null; actionId?: string }
  | {
      type: "submitWitchAction";
      useAntidote?: boolean;
      poisonTargetId?: string | null;
      actionId?: string;
    }
  | { type: "submitSeerTarget"; targetPlayerId?: string; actionId?: string }
  | { type: "confirmSeerResult"; actionId?: string }
  | { type: "submitHunterExecution"; targetPlayerId?: string | null; actionId?: string }
  | { type: "startDayVote" }
  | { type: "submitVote"; targetId: string; actionId: string }
  | { type: "closeDayVote" }
  | { type: "beginNightStart" };

export type WerewolfRuleOutcome =
  | { kind: "roleConfirmed"; allConfirmed: boolean }
  | { kind: "nightAdvanced"; advanced: boolean }
  | { kind: "hunterResolved"; advanced: boolean }
  | { kind: "voteSubmitted"; changed: boolean }
  | { kind: "voteClosed"; result: string }
  | { kind: "stateChanged" };

export type WerewolfCommandResult = GameCommandResult<GameState> & {
  outcome: WerewolfRuleOutcome;
};

export type WerewolfPlayerMode =
  | "spectator"
  | "role_reveal"
  | "waiting"
  | "night_start"
  | "wolf_action"
  | "guard_action"
  | "witch_action"
  | "seer_action"
  | "seer_result"
  | "night_complete"
  | "day_vote"
  | "day_pk"
  | "day_result"
  | "hunter_execution"
  | "day_announce"
  | "game_over";

export type WerewolfPlayerView = {
  phase: GamePhase;
  mode: WerewolfPlayerMode;
  role?: Role;
  roleName?: string;
  roleDescription?: string;
  actionId?: string;
  deadPlayerIds?: string[];
  roleConfirmed?: boolean;
  targets?: GamePlayerRef[];
  attackedPlayer?: GamePlayerRef | undefined;
  poisonTargets?: GamePlayerRef[];
  antidoteAvailable?: boolean;
  poisonAvailable?: boolean;
  checkedPlayer?: GamePlayerRef | undefined;
  checkedAlignment?: "werewolf" | "good" | undefined;
  deaths?: GamePlayerRef[];
  myVote?: string | undefined;
  eliminatedPlayer?: GamePlayerRef | undefined;
  noKill?: boolean;
  winner?: "wolf" | "village" | undefined;
};

export type WerewolfPublicView = {
  phase: GamePhase;
  confirmedRoles: number;
  completedNightSteps: number;
  dayNumber: number;
  nightNumber: number;
  aliveCount: number;
  votesRequired: number;
  votesCast: number;
  pkCandidateIds: string[];
  eliminatedTodayId: string | undefined;
  noKillToday: boolean;
  winner: "wolf" | "village" | undefined;
  deadPlayerIds: string[];
};

export type WerewolfHostView = WerewolfPublicView & {
  voteTally: Record<string, number> | undefined;
};

const ROLE_INFO: Record<Role, { name: string; description: string }> = {
  werewolf: { name: "狼人", description: "夜间可以击杀任意一名存活玩家（包括狼人）或选择空刀。" },
  seer: { name: "预言家", description: "每晚可以查验一名其他玩家的阵营。" },
  witch: { name: "女巫", description: "拥有一瓶解药和一瓶毒药，同一晚只能使用一瓶。" },
  guard: { name: "守卫", description: "每晚可以保护一名玩家（包括自己）或空守，但不能连续两晚保护同一人。" },
  hunter: { name: "猎人", description: "被狼刀或放逐出局时可以开枪带走一人，也可以不开枪；被毒死不能开枪。" },
  villager: { name: "平民", description: "没有夜间技能，请观察发言并找出狼人。" },
};

function requirePlayerId(context: GameCommandContext): string {
  if (!context.playerId) throw new Error("player command requires playerId");
  return context.playerId;
}

function playerRefs(context: GameViewContext): GamePlayerRef[] {
  return context.players.map(player => ({ ...player }));
}

function voteTally(game: GameState): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(game.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  return tally;
}

function completedNightSteps(game: GameState): number {
  return (["night_guard", "night_werewolf", "night_witch", "night_seer", "night_complete"] as const)
    .indexOf(game.phase as "night_guard" | "night_werewolf" | "night_witch" | "night_seer" | "night_complete");
}

function commonRoomGameView(game: GameState): WerewolfPublicView {
  const aliveCount = Object.keys(game.roles).filter(id => !game.deadPlayerIds.includes(id)).length;
  const votesRequired = Object.keys(game.roles).filter(
    playerId =>
      !game.deadPlayerIds.includes(playerId) &&
      (game.phase !== "day_pk" || !game.pkCandidateIds.includes(playerId)),
  ).length;

  return {
    phase: game.phase,
    confirmedRoles: game.confirmedRolePlayerIds.length,
    completedNightSteps: completedNightSteps(game),
    dayNumber: game.dayNumber,
    nightNumber: game.nightNumber,
    aliveCount,
    votesRequired,
    votesCast: Object.keys(game.votes).length,
    pkCandidateIds: game.pkCandidateIds,
    eliminatedTodayId: game.eliminatedTodayId,
    noKillToday: game.noKillToday ?? false,
    winner: game.winner,
    deadPlayerIds: game.deadPlayerIds,
  };
}

export function allEligiblePlayersVoted(game: GameState): boolean {
  return allAliveVoted(game);
}

export class WerewolfGameModule implements GameModule<
  GameState,
  WerewolfCommand,
  WerewolfPlayerView,
  WerewolfHostView,
  WerewolfPublicView,
  WerewolfCreateInput
> {
  readonly type = "werewolf";

  createGame(input: WerewolfCreateInput, dependencies: GameModuleDependencies): GameState {
    return startGame(input.playerIds, input.config, dependencies.random);
  }

  handleCommand(
    state: GameState,
    context: GameCommandContext,
    command: WerewolfCommand,
    dependencies: GameModuleDependencies,
  ): WerewolfCommandResult {
    const random = dependencies.random;
    switch (command.type) {
      case "confirmRole":
        return {
          state,
          outcome: {
            kind: "roleConfirmed",
            allConfirmed: confirmRole(state, requirePlayerId(context), command.actionId, random),
          },
        };
      case "startNight":
        startNight(state, random);
        return { state, outcome: { kind: "nightAdvanced", advanced: true } };
      case "submitWolfTarget":
        return {
          state,
          outcome: {
            kind: "nightAdvanced",
            advanced: submitWolfTarget(
              state,
              requirePlayerId(context),
              command.targetPlayerId,
              command.actionId,
              random,
            ),
          },
        };
      case "submitGuardTarget":
        return {
          state,
          outcome: {
            kind: "nightAdvanced",
            advanced: submitGuardTarget(
              state,
              requirePlayerId(context),
              command.targetPlayerId,
              command.actionId,
              random,
            ),
          },
        };
      case "submitWitchAction": {
        const action: { useAntidote?: boolean; poisonTargetId?: string | null } = {};
        if (command.useAntidote !== undefined) action.useAntidote = command.useAntidote;
        if (command.poisonTargetId !== undefined) action.poisonTargetId = command.poisonTargetId;
        return {
          state,
          outcome: {
            kind: "nightAdvanced",
            advanced: submitWitchAction(
              state,
              requirePlayerId(context),
              action,
              command.actionId,
              random,
            ),
          },
        };
      }
      case "submitSeerTarget":
        submitSeerTarget(state, requirePlayerId(context), command.targetPlayerId, command.actionId);
        return { state, outcome: { kind: "stateChanged" } };
      case "confirmSeerResult":
        return {
          state,
          outcome: {
            kind: "nightAdvanced",
            advanced: confirmSeerResult(state, requirePlayerId(context), command.actionId, random),
          },
        };
      case "submitHunterExecution":
        return {
          state,
          outcome: {
            kind: "hunterResolved",
            advanced: submitHunterExecution(
              state,
              requirePlayerId(context),
              command.targetPlayerId,
              command.actionId,
              random,
            ),
          },
        };
      case "startDayVote":
        startDayVote(state, random);
        return { state, outcome: { kind: "stateChanged" } };
      case "submitVote":
        return {
          state,
          outcome: {
            kind: "voteSubmitted",
            changed: submitVote(
              state,
              requirePlayerId(context),
              command.targetId,
              command.actionId,
            ),
          },
        };
      case "closeDayVote":
        return {
          state,
          outcome: { kind: "voteClosed", result: closeDayVote(state, random) },
        };
      case "beginNightStart":
        beginNightStart(state, random);
        return { state, outcome: { kind: "stateChanged" } };
    }
  }

  getActingPlayerIds(game: GameState): string[] {
    if (game.phase === "day_vote") {
      return Object.keys(game.roles).filter(id => !game.deadPlayerIds.includes(id));
    }
    if (game.phase === "day_pk") {
      return Object.keys(game.roles).filter(
        id => !game.deadPlayerIds.includes(id) && !game.pkCandidateIds.includes(id),
      );
    }
    if (game.phase === "day_hunter") {
      return Object.entries(game.roles)
        .filter(([, role]) => role === "hunter")
        .map(([id]) => id);
    }
    const role =
      game.phase === "night_werewolf" ? "werewolf"
      : game.phase === "night_guard" ? "guard"
      : game.phase === "night_witch" ? "witch"
      : game.phase === "night_seer" ? "seer"
      : undefined;
    return role
      ? Object.entries(game.roles)
          .filter(
            ([playerId, assignedRole]) =>
              assignedRole === role && !game.deadPlayerIds.includes(playerId),
          )
          .map(([playerId]) => playerId)
      : [];
  }

  getPlayerView(
    game: GameState,
    playerId: string,
    context: GameViewContext,
  ): WerewolfPlayerView {
    const role = game.roles[playerId];
    if (!role) return { phase: game.phase, mode: "spectator" };

    const targets = playerRefs(context);
    const alive = (target: { id: string }) => !game.deadPlayerIds.includes(target.id);
    const isDead = game.deadPlayerIds.includes(playerId);
    const base = {
      phase: game.phase,
      role,
      roleName: ROLE_INFO[role].name,
      roleDescription: ROLE_INFO[role].description,
      actionId: game.actionId,
      deadPlayerIds: game.deadPlayerIds,
    };

    if (game.phase === "role_reveal") {
      const roleConfirmed = game.confirmedRolePlayerIds.includes(playerId);
      return { ...base, mode: roleConfirmed ? "waiting" : "role_reveal", roleConfirmed };
    }
    if (game.phase === "night_start") return { ...base, mode: "night_start" };

    if (game.phase === "night_werewolf" && role === "werewolf" && !isDead) {
      return { ...base, mode: "wolf_action", targets: targets.filter(alive) };
    }
    if (game.phase === "night_guard" && role === "guard" && !isDead) {
      return {
        ...base,
        mode: "guard_action",
        targets: targets.filter(target => alive(target) && target.id !== game.guardLastProtectedId),
      };
    }
    if (game.phase === "night_witch" && role === "witch" && !isDead) {
      return {
        ...base,
        mode: "witch_action",
        attackedPlayer: targets.find(target => target.id === game.wolfTargetId),
        poisonTargets: targets.filter(target => alive(target) && target.id !== playerId),
        antidoteAvailable: !game.witchAntidoteSpent && Boolean(game.wolfTargetId),
        poisonAvailable: !game.witchPoisonSpent,
      };
    }
    if (game.phase === "night_seer" && role === "seer" && !isDead) {
      const checkedPlayer = targets.find(target => target.id === game.seerTargetId);
      return {
        ...base,
        mode: game.seerTargetId ? "seer_result" : "seer_action",
        targets: targets.filter(target => alive(target) && target.id !== playerId),
        checkedPlayer,
        checkedAlignment: game.seerTargetId
          ? game.roles[game.seerTargetId] === "werewolf" ? "werewolf" : "good"
          : undefined,
      };
    }

    const deaths = targets.filter(target => game.deaths.includes(target.id));
    if (game.phase === "night_complete") {
      return { ...base, mode: "night_complete", deaths };
    }
    if (game.phase === "day_vote") {
      if (isDead) return { ...base, mode: "spectator", deaths };
      return {
        ...base,
        mode: "day_vote",
        deaths,
        targets: targets.filter(target => alive(target) && target.id !== playerId),
        myVote: game.votes[playerId],
      };
    }
    if (game.phase === "day_pk") {
      if (isDead) return { ...base, mode: "spectator", deaths };
      if (game.pkCandidateIds.includes(playerId)) return { ...base, mode: "waiting", deaths };
      return {
        ...base,
        mode: "day_pk",
        deaths,
        targets: targets.filter(target =>
          alive(target) && target.id !== playerId && game.pkCandidateIds.includes(target.id)
        ),
        myVote: game.votes[playerId],
      };
    }
    if (game.phase === "day_result") {
      return {
        ...base,
        mode: "day_result",
        deaths,
        eliminatedPlayer: game.eliminatedTodayId
          ? targets.find(target => target.id === game.eliminatedTodayId)
          : undefined,
        noKill: game.noKillToday ?? false,
      };
    }
    if (game.phase === "day_hunter") {
      if (role === "hunter") {
        return {
          ...base,
          mode: "hunter_execution",
          targets: targets.filter(target => !game.deadPlayerIds.includes(target.id)),
        };
      }
      if (game.hunterTrigger === "night") return { ...base, mode: "day_announce", deaths };
      return { ...base, mode: "waiting" };
    }
    if (game.phase === "game_over") {
      return { ...base, mode: "game_over", winner: game.winner };
    }
    return { ...base, mode: "waiting" };
  }

  getHostView(game: GameState, _context: GameViewContext): WerewolfHostView {
    return {
      ...commonRoomGameView(game),
      voteTally: ["day_vote", "day_pk", "day_result"].includes(game.phase)
        ? voteTally(game)
        : undefined,
    };
  }

  getPublicView(game: GameState, _context: GameViewContext): WerewolfPublicView {
    return commonRoomGameView(game);
  }
}

export const werewolfGameModule = new WerewolfGameModule();
