import type {
  GameCommandContext,
  GameCommandResult,
  GameModule,
  GameModuleDependencies,
  GameViewContext,
} from "../../core/game/GameModule.js";
import {
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

export type WerewolfPlayerView = Record<string, unknown>;
export type WerewolfHostView = Record<string, unknown>;
export type WerewolfPublicView = Record<string, unknown>;

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

function playerRefs(context: GameViewContext) {
  return context.players.map(player => ({ ...player }));
}

function voteTally(game: GameState): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(game.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  return tally;
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

  createGame(input: WerewolfCreateInput, _dependencies: GameModuleDependencies): GameState {
    return startGame(input.playerIds, input.config);
  }

  handleCommand(
    state: GameState,
    context: GameCommandContext,
    command: WerewolfCommand,
    _dependencies: GameModuleDependencies,
  ): GameCommandResult<GameState> {
    switch (command.type) {
      case "confirmRole":
        confirmRole(state, requirePlayerId(context), command.actionId);
        break;
      case "startNight":
        startNight(state);
        break;
      case "submitWolfTarget":
        submitWolfTarget(
          state,
          requirePlayerId(context),
          command.targetPlayerId,
          command.actionId,
        );
        break;
      case "submitGuardTarget":
        submitGuardTarget(
          state,
          requirePlayerId(context),
          command.targetPlayerId,
          command.actionId,
        );
        break;
      case "submitWitchAction": {
        const action: { useAntidote?: boolean; poisonTargetId?: string | null } = {};
        if (command.useAntidote !== undefined) action.useAntidote = command.useAntidote;
        if (command.poisonTargetId !== undefined) action.poisonTargetId = command.poisonTargetId;
        submitWitchAction(
          state,
          requirePlayerId(context),
          action,
          command.actionId,
        );
        break;
      }
      case "submitSeerTarget":
        submitSeerTarget(
          state,
          requirePlayerId(context),
          command.targetPlayerId,
          command.actionId,
        );
        break;
      case "confirmSeerResult":
        confirmSeerResult(state, requirePlayerId(context), command.actionId);
        break;
      case "submitHunterExecution":
        submitHunterExecution(
          state,
          requirePlayerId(context),
          command.targetPlayerId,
          command.actionId,
        );
        break;
      case "startDayVote":
        startDayVote(state);
        break;
      case "submitVote":
        submitVote(state, requirePlayerId(context), command.targetId, command.actionId);
        break;
      case "closeDayVote":
        closeDayVote(state);
        break;
      case "beginNightStart":
        beginNightStart(state);
        break;
    }

    return { state };
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

  getHostView(game: GameState, context: GameViewContext): WerewolfHostView {
    const aliveCount = Object.keys(game.roles).filter(id => !game.deadPlayerIds.includes(id)).length;
    const votesRequired = Object.keys(game.roles).filter(
      playerId =>
        !game.deadPlayerIds.includes(playerId) &&
        (game.phase !== "day_pk" || !game.pkCandidateIds.includes(playerId)),
    ).length;

    return {
      phase: game.phase,
      confirmedRoles: game.confirmedRolePlayerIds.length,
      dayNumber: game.dayNumber,
      nightNumber: game.nightNumber,
      aliveCount,
      votesRequired,
      votesCast: Object.keys(game.votes).length,
      voteTally: ["day_vote", "day_pk", "day_result"].includes(game.phase)
        ? voteTally(game)
        : undefined,
      pkCandidateIds: game.pkCandidateIds,
      eliminatedTodayId: game.eliminatedTodayId,
      noKillToday: game.noKillToday ?? false,
      winner: game.winner,
      deadPlayerIds: game.deadPlayerIds,
      players: playerRefs(context),
    };
  }

  getPublicView(game: GameState, context: GameViewContext): WerewolfPublicView {
    return {
      phase: game.phase,
      dayNumber: game.dayNumber,
      nightNumber: game.nightNumber,
      deadPlayerIds: game.deadPlayerIds,
      winner: game.winner,
      players: playerRefs(context),
    };
  }
}

export const werewolfGameModule = new WerewolfGameModule();
