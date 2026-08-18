import crypto from "node:crypto";
import type { CommandReceipt } from "../../core/command/IdempotentCommandLedger.js";
import type { GameViewContext } from "../../core/game/GameModule.js";
import { interactionForPlayer } from "../../core/interaction/PendingInteraction.js";
import { RoomCore } from "../../core/room/RoomCore.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import type { TestPrompt } from "../../domain/testPrompt.js";
import {
  allEligiblePlayersVoted,
  werewolfGameModule,
  type WerewolfCommand,
} from "../../games/werewolf/WerewolfGameModule.js";
import {
  getActiveWerewolfInteraction,
  type WerewolfInteraction,
} from "../../games/werewolf/WerewolfNightPlanner.js";

export type RuntimePlayer = RoomPlayer & {
  socketId: string | null;
  connected: boolean;
};

export type RuntimeRoom = RoomState<GameState, GameConfig, RuntimePlayer> & {
  activePrompt?: TestPrompt;
  /** Recent mutation/effect receipts used by retry dedupe and room recovery. */
  commandReceipts?: CommandReceipt<WerewolfCommandOutcome>[];
};

export type WerewolfCommandOutcome =
  | { kind: "none" }
  | { kind: "broadcast" }
  | { kind: "afterNightAction" }
  | { kind: "hunterResolved" }
  | { kind: "vote"; changed: boolean; allEligibleVoted: boolean }
  | { kind: "voteClosed"; result: string }
  | { kind: "hostRecoveryReminder"; actorPlayerIds: string[] };

const commandDependencies = {
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

export function activeInteraction(room: RuntimeRoom): WerewolfInteraction | undefined {
  return room.game ? getActiveWerewolfInteraction(room.game) : undefined;
}

export function playerGameView(room: RuntimeRoom, playerId: string): unknown {
  if (!room.game) return { phase: "lobby", mode: "lobby" };

  const view = werewolfGameModule.getPlayerView(room.game, playerId, gameViewContext(room));
  const playerInteraction = interactionForPlayer(activeInteraction(room), playerId);
  return playerInteraction
    ? { ...view, activeInteraction: playerInteraction }
    : view;
}

export function roomGameView(room: RuntimeRoom, isHost: boolean): Record<string, unknown> | undefined {
  if (!room.game) return undefined;
  const context = gameViewContext(room);
  return isHost
    ? werewolfGameModule.getHostView(room.game, context)
    : werewolfGameModule.getPublicView(room.game, context);
}

export function actingPlayerIds(room: RuntimeRoom): string[] {
  if (!room.game) return [];
  const interaction = activeInteraction(room);
  return interaction?.actorPlayerIds ?? werewolfGameModule.getActingPlayerIds(room.game);
}

export function createWerewolfGame(room: RuntimeRoom, config: GameConfig): GameState {
  room.gameType = werewolfGameModule.type;
  room.gameConfig = config;
  room.game = werewolfGameModule.createGame(
    { playerIds: room.players.map(player => player.id), config },
    commandDependencies,
  );
  room.commandReceipts = [];
  room.updatedAt = Date.now();
  return room.game;
}

export function executeWerewolfCommand(
  room: RuntimeRoom,
  command: WerewolfCommand,
  context: { playerId?: string; isHost?: boolean } = {},
): WerewolfCommandOutcome {
  if (!room.game) throw new Error("game has not started");

  const result = werewolfGameModule.handleCommand(
    room.game,
    {
      ...(context.playerId === undefined ? {} : { playerId: context.playerId }),
      isHost: context.isHost ?? false,
      now: Date.now(),
    },
    command,
    commandDependencies,
  );
  room.updatedAt = Date.now();

  switch (result.outcome.kind) {
    case "roleConfirmed":
    case "stateChanged":
      return { kind: "broadcast" };

    case "nightAdvanced":
      return result.outcome.advanced
        ? { kind: "afterNightAction" }
        : { kind: "none" };

    case "hunterResolved":
      return result.outcome.advanced
        ? { kind: "hunterResolved" }
        : { kind: "none" };

    case "voteSubmitted":
      return {
        kind: "vote",
        changed: result.outcome.changed,
        allEligibleVoted:
          result.outcome.changed && allEligiblePlayersVoted(room.game),
      };

    case "voteClosed":
      return { kind: "voteClosed", result: result.outcome.result };
  }
}
