import {
  allAliveVoted,
  beginNightStart,
  closeDayVote,
  configFromPlayerCount,
  configFromRoleDeck,
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
import type {
  GameEngine,
  GamePlayer,
  GameTransition,
  GameViewContext,
} from "../shared/engine.js";
import { GAME_METADATA } from "../shared/metadata.js";

export const WEREWOLF_ROLE_INFO: Record<Role, { name: string; description: string }> = {
  werewolf: { name: "狼人", description: "夜间可以击杀任意一名存活玩家（包括狼人）或选择空刀。" },
  seer: { name: "预言家", description: "每晚可以查验一名其他玩家的阵营。" },
  witch: { name: "女巫", description: "拥有一瓶解药和一瓶毒药，同一晚只能使用一瓶。" },
  guard: { name: "守卫", description: "每晚可以保护一名玩家（包括自己）或空守，但不能连续两晚保护同一人。" },
  hunter: { name: "猎人", description: "被狼刀或放逐出局时可以开枪带走一人，也可以不开枪；被毒死不能开枪。" },
  villager: { name: "平民", description: "没有夜间技能，请观察发言并找出狼人。" },
};

export type WerewolfCommand =
  | { type: "confirm_role"; playerId: string; actionId?: string | undefined }
  | { type: "start_night" }
  | {
      type: "submit_wolf_target";
      playerId: string;
      targetPlayerId?: string | null | undefined;
      actionId?: string | undefined;
    }
  | {
      type: "submit_guard_target";
      playerId: string;
      targetPlayerId?: string | null | undefined;
      actionId?: string | undefined;
    }
  | {
      type: "submit_witch_action";
      playerId: string;
      action: { useAntidote?: boolean; poisonTargetId?: string | null };
      actionId?: string | undefined;
    }
  | {
      type: "submit_seer_target";
      playerId: string;
      targetPlayerId?: string | undefined;
      actionId?: string | undefined;
    }
  | { type: "confirm_seer_result"; playerId: string; actionId?: string | undefined }
  | {
      type: "submit_hunter_execution";
      playerId: string;
      targetPlayerId?: string | null | undefined;
      actionId?: string | undefined;
    }
  | { type: "start_day_vote" }
  | { type: "submit_vote"; playerId: string; targetId: string; actionId: string }
  | { type: "close_day_vote" }
  | { type: "begin_night_start" };

function transition(state: GameState, changed: boolean): GameTransition<GameState> {
  return { state, events: [], changed };
}

function publicPlayer(player: GamePlayer): GamePlayer {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    isHost: player.isHost,
  };
}

function voteTally(state: GameState): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(state.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  return tally;
}

export function projectWerewolfPlayerView(
  game: GameState,
  playerId: string,
  context: GameViewContext,
) {
  const role = game.roles[playerId]!;
  const base = {
    phase: game.phase,
    role,
    roleName: WEREWOLF_ROLE_INFO[role].name,
    roleDescription: WEREWOLF_ROLE_INFO[role].description,
    actionId: game.actionId,
    deadPlayerIds: game.deadPlayerIds,
  };

  if (game.phase === "role_reveal") {
    const roleConfirmed = game.confirmedRolePlayerIds.includes(playerId);
    return { ...base, mode: roleConfirmed ? "waiting" : "role_reveal", roleConfirmed };
  }

  const targetViews = context.players.map(publicPlayer);
  const alive = (target: GamePlayer) => !game.deadPlayerIds.includes(target.id);
  const isDead = game.deadPlayerIds.includes(playerId);

  if (game.phase === "night_werewolf" && role === "werewolf" && !isDead) {
    return { ...base, mode: "wolf_action", targets: targetViews.filter(alive) };
  }
  if (game.phase === "night_guard" && role === "guard" && !isDead) {
    return {
      ...base,
      mode: "guard_action",
      targets: targetViews.filter(target =>
        alive(target) && target.id !== game.guardLastProtectedId
      ),
    };
  }
  if (game.phase === "night_witch" && role === "witch" && !isDead) {
    return {
      ...base,
      mode: "witch_action",
      attackedPlayer: targetViews.find(target => target.id === game.wolfTargetId),
      poisonTargets: targetViews.filter(target => alive(target) && target.id !== playerId),
      antidoteAvailable: !game.witchAntidoteSpent && Boolean(game.wolfTargetId),
      poisonAvailable: !game.witchPoisonSpent,
    };
  }
  if (game.phase === "night_seer" && role === "seer" && !isDead) {
    const checkedPlayer = targetViews.find(target => target.id === game.seerTargetId);
    return {
      ...base,
      mode: game.seerTargetId ? "seer_result" : "seer_action",
      targets: targetViews.filter(target => alive(target) && target.id !== playerId),
      checkedPlayer,
      checkedAlignment: game.seerTargetId
        ? game.roles[game.seerTargetId] === "werewolf" ? "werewolf" : "good"
        : undefined,
    };
  }
  if (game.phase === "night_start") return { ...base, mode: "night_start" };
  if (game.phase === "night_complete") {
    return {
      ...base,
      mode: "night_complete",
      deaths: targetViews.filter(target => game.deaths.includes(target.id)),
    };
  }

  const deathViews = targetViews.filter(target => game.deaths.includes(target.id));
  if (game.phase === "day_vote") {
    if (isDead) return { ...base, mode: "spectator", deaths: deathViews };
    return {
      ...base,
      mode: "day_vote",
      deaths: deathViews,
      targets: targetViews.filter(target => alive(target) && target.id !== playerId),
      myVote: game.votes[playerId],
    };
  }
  if (game.phase === "day_pk") {
    if (isDead) return { ...base, mode: "spectator", deaths: deathViews };
    if (game.pkCandidateIds.includes(playerId)) {
      return { ...base, mode: "waiting", deaths: deathViews };
    }
    return {
      ...base,
      mode: "day_pk",
      deaths: deathViews,
      targets: targetViews.filter(target =>
        alive(target) && target.id !== playerId && game.pkCandidateIds.includes(target.id)
      ),
      myVote: game.votes[playerId],
    };
  }
  if (game.phase === "day_result") {
    return {
      ...base,
      mode: "day_result",
      deaths: deathViews,
      eliminatedPlayer: game.eliminatedTodayId
        ? targetViews.find(target => target.id === game.eliminatedTodayId)
        : undefined,
      noKill: game.noKillToday ?? false,
    };
  }
  if (game.phase === "day_hunter") {
    if (role === "hunter") {
      return {
        ...base,
        mode: "hunter_execution",
        targets: targetViews.filter(target => !game.deadPlayerIds.includes(target.id)),
      };
    }
    if (game.hunterTrigger === "night") {
      return { ...base, mode: "day_announce", deaths: deathViews };
    }
    return { ...base, mode: "waiting" };
  }
  if (game.phase === "game_over") {
    return { ...base, mode: "game_over", winner: game.winner };
  }
  return { ...base, mode: "waiting" };
}

export function projectWerewolfPublicView(game: GameState, context: GameViewContext) {
  const alivePlayerIds = Object.keys(game.roles).filter(id => !game.deadPlayerIds.includes(id));
  const votesRequired = alivePlayerIds.filter(
    playerId => game.phase !== "day_pk" || !game.pkCandidateIds.includes(playerId),
  ).length;
  return {
    phase: game.phase,
    confirmedRoles: game.confirmedRolePlayerIds.length,
    completedNightSteps:
      (["night_guard", "night_werewolf", "night_witch", "night_seer", "night_complete"] as const)
        .indexOf(game.phase as "night_werewolf" | "night_guard" | "night_witch" | "night_seer" | "night_complete"),
    dayNumber: game.dayNumber,
    nightNumber: game.nightNumber,
    aliveCount: alivePlayerIds.length,
    votesRequired,
    votesCast: Object.keys(game.votes).length,
    voteTally:
      context.viewerIsHost && ["day_vote", "day_pk", "day_result"].includes(game.phase)
        ? voteTally(game)
        : undefined,
    pkCandidateIds: game.pkCandidateIds,
    eliminatedTodayId: game.eliminatedTodayId,
    noKillToday: game.noKillToday ?? false,
    winner: game.winner,
    deadPlayerIds: game.deadPlayerIds,
  };
}

export function werewolfActingPlayerIds(game: GameState): string[] {
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
        .filter(([id, assignedRole]) =>
          assignedRole === role && !game.deadPlayerIds.includes(id)
        )
        .map(([id]) => id)
    : [];
}

const metadata = GAME_METADATA.find(game => game.kind === "werewolf")!;

export const werewolfEngine: GameEngine<
  GameState,
  GameConfig,
  WerewolfCommand,
  ReturnType<typeof projectWerewolfPlayerView>,
  ReturnType<typeof projectWerewolfPublicView>
> = {
  metadata,

  createConfig(playerCount, input) {
    if (
      input &&
      typeof input === "object" &&
      "roleDeck" in input &&
      Array.isArray(input.roleDeck)
    ) {
      return configFromRoleDeck(playerCount, input.roleDeck as Role[]);
    }
    return configFromPlayerCount(playerCount);
  },

  createInitialState({ playerIds, config }) {
    return startGame([...playerIds], config);
  },

  handleCommand(state, command) {
    switch (command.type) {
      case "confirm_role": {
        const wasConfirmed = state.confirmedRolePlayerIds.includes(command.playerId);
        confirmRole(state, command.playerId, command.actionId);
        return transition(state, !wasConfirmed);
      }
      case "start_night":
        startNight(state);
        return transition(state, true);
      case "submit_wolf_target":
        return transition(
          state,
          submitWolfTarget(state, command.playerId, command.targetPlayerId, command.actionId),
        );
      case "submit_guard_target":
        return transition(
          state,
          submitGuardTarget(state, command.playerId, command.targetPlayerId, command.actionId),
        );
      case "submit_witch_action":
        return transition(
          state,
          submitWitchAction(state, command.playerId, command.action, command.actionId),
        );
      case "submit_seer_target": {
        const previousTargetId = state.seerTargetId;
        submitSeerTarget(state, command.playerId, command.targetPlayerId, command.actionId);
        return transition(state, state.seerTargetId !== previousTargetId);
      }
      case "confirm_seer_result":
        return transition(state, confirmSeerResult(state, command.playerId, command.actionId));
      case "submit_hunter_execution":
        return transition(
          state,
          submitHunterExecution(
            state,
            command.playerId,
            command.targetPlayerId,
            command.actionId,
          ),
        );
      case "start_day_vote":
        startDayVote(state);
        return transition(state, true);
      case "submit_vote":
        return transition(
          state,
          submitVote(state, command.playerId, command.targetId, command.actionId),
        );
      case "close_day_vote":
        closeDayVote(state);
        return transition(state, true);
      case "begin_night_start":
        beginNightStart(state);
        return transition(state, true);
    }
  },

  projectPlayerView: projectWerewolfPlayerView,
  projectPublicView: projectWerewolfPublicView,
  projectLobbyView(playerCount, config) {
    const defaultRoleDeck = playerCount >= metadata.minPlayers
      ? configFromPlayerCount(playerCount).roleDeck
      : config.roleDeck;
    return {
      defaultRoleDeck,
      roleCatalog: Object.entries(WEREWOLF_ROLE_INFO).map(([id, info]) => ({
        id,
        name: info.name,
      })),
    };
  },
  actingPlayerIds: werewolfActingPlayerIds,
};

export { allAliveVoted };
