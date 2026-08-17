import crypto from "node:crypto";
import { RoomCore } from "../../core/room/RoomCore.js";
import type { GameViewContext } from "../../core/game/GameModule.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import { allAliveVoted, type GameConfig, type GameState } from "../../domain/game.js";
import type { TestPrompt } from "../../domain/testPrompt.js";
import {
  werewolfGameModule,
  type WerewolfCommand,
} from "../../games/werewolf/WerewolfGameModule.js";

export type RuntimePlayer = RoomPlayer & {
  socketId: string | null;
  connected: boolean;
};

export type RuntimeRoom = RoomState<GameState, GameConfig, RuntimePlayer> & {
  activePrompt?: TestPrompt;
};

export type WerewolfCommandOutcome =
  | { kind: "none" }
  | { kind: "broadcast" }
  | { kind: "afterNightAction" }
  | { kind: "hunterResolved" }
  | { kind: "vote"; changed: boolean; allEligibleVoted: boolean }
  | { kind: "voteClosed"; result: string };

const moduleDependencies = {
  random: {
    randomInt(maxExclusive: number) {
      return crypto.randomInt(maxExclusive);
    },
    randomId() {
      return crypto.randomUUID();
    },
  },
};

export function roomCore(room: RuntimeRoom): RoomCore<GameState, GameConfig, RuntimePlayer> {
  return new RoomCore(room);
}

export function gameViewContext(room: RuntimeRoom): GameViewContext {
  return {
    players: room.players.map(({ id, name, seat }) => ({ id, name, seat })),
  };
}

export function playerGameView(room: RuntimeRoom, playerId: string): unknown {
  if (!room.game) return { phase: "lobby", mode: "lobby" };
  return werewolfGameModule.getPlayerView(room.game, playerId, gameViewContext(room));
}

export function hostGameView(room: RuntimeRoom): unknown {
  if (!room.game) return undefined;
  return werewolfGameModule.getHostView(room.game, gameViewContext(room));
}

export function createWerewolfGame(room: RuntimeRoom, config: GameConfig): GameState {
  room.gameType = werewolfGameModule.type;
  room.gameConfig = config;
  room.game = werewolfGameModule.createGame(
    { playerIds: room.players.map(player => player.id), config },
    moduleDependencies,
  );
  room.updatedAt = Date.now();
  return room.game;
}

export function executeWerewolfCommand(
  room: RuntimeRoom,
  command: WerewolfCommand,
  options: { playerId?: string; isHost?: boolean } = {},
): WerewolfCommandOutcome {
  const game = room.game;
  if (!game) throw new Error("game is not started");

  const beforeActionId = game.actionId;
  const beforeVote = options.playerId ? game.votes[options.playerId] : undefined;

  werewolfGameModule.handleCommand(
    game,
    {
      playerId: options.playerId,
      isHost: options.isHost ?? false,
      now: Date.now(),
    },
    command,
    moduleDependencies,
  );
  room.updatedAt = Date.now();

  switch (command.type) {
    case "confirmRole":
    case "submitSeerTarget":
    case "startDayVote":
    case "beginNightStart":
      return { kind: "broadcast" };

    case "startNight":
      return { kind: "afterNightAction" };

    case "submitWolfTarget":
    case "submitGuardTarget":
    case "submitWitchAction":
    case "confirmSeerResult":
      return game.actionId !== beforeActionId
        ? { kind: "afterNightAction" }
        : { kind: "none" };

    case "submitHunterExecution":
      return game.actionId !== beforeActionId
        ? { kind: "hunterResolved" }
        : { kind: "none" };

    case "submitVote": {
      const changed = options.playerId !== undefined && game.votes[options.playerId] !== beforeVote;
      return {
        kind: "vote",
        changed,
        allEligibleVoted: changed && allAliveVoted(game),
      };
    }

    case "closeDayVote": {
      const result = game.phase === "day_pk"
        ? "pk"
        : game.noKillToday
          ? "no_kill"
          : game.eliminatedTodayId ?? "no_kill";
      return { kind: "voteClosed", result };
    }
  }
}
