import crypto from "node:crypto";
import type { CommandReceipt } from "../../core/command/IdempotentCommandLedger.js";
import { RoomCore } from "../../core/room/RoomCore.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import type { TestPrompt } from "../../domain/testPrompt.js";
import {
  werewolfGameModule,
  type WerewolfCommand,
} from "../../games/werewolf/WerewolfGameModule.js";
import type { WerewolfInteraction } from "../../games/werewolf/WerewolfNightPlanner.js";
import {
  executeWerewolfRoomCommand,
  type WerewolfCommandEnvironment,
  type WerewolfCommandOutcome,
} from "../shared/werewolfRoomCommand.js";
import {
  activeWerewolfInteraction,
  werewolfActingPlayerIds,
  werewolfGameViewContext,
  werewolfPlayerGameView,
} from "../shared/werewolfRoomView.js";

export type { WerewolfCommandOutcome } from "../shared/werewolfRoomCommand.js";

export type RuntimePlayer = RoomPlayer & {
  socketId: string | null;
  connected: boolean;
};

export type HostRecoveryCommandOutcome = {
  kind: "hostRecoveryReminder";
  actorPlayerIds: string[];
};

export type RuntimeCommandOutcome = WerewolfCommandOutcome | HostRecoveryCommandOutcome;

export type RuntimeRoom = RoomState<GameState, GameConfig, RuntimePlayer> & {
  activePrompt?: TestPrompt;
  /** Recent mutation/effect receipts used by retry dedupe and room recovery. */
  commandReceipts?: CommandReceipt<RuntimeCommandOutcome>[];
};

export type HostRecoveryStatus = {
  hasPendingInteraction: boolean;
  waitingCount: number;
  onlineWaitingCount: number;
  offlineWaitingCount: number;
};

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

const nodeCommandEnvironment: WerewolfCommandEnvironment = {
  random: commandDependencies.random,
  now: Date.now,
};

export function roomCore(room: RuntimeRoom): RoomCore<GameState, GameConfig, RuntimePlayer> {
  return new RoomCore(room);
}

export function gameViewContext(room: RuntimeRoom) {
  return werewolfGameViewContext(room);
}

export function activeInteraction(room: RuntimeRoom): WerewolfInteraction | undefined {
  return activeWerewolfInteraction(room);
}

export function playerGameView(room: RuntimeRoom, playerId: string): unknown {
  return werewolfPlayerGameView(room, playerId);
}

export function actingPlayerIds(room: RuntimeRoom): string[] {
  return werewolfActingPlayerIds(room);
}

export function hostRecoveryStatus(room: RuntimeRoom): HostRecoveryStatus {
  if (!room.game) {
    return {
      hasPendingInteraction: false,
      waitingCount: 0,
      onlineWaitingCount: 0,
      offlineWaitingCount: 0,
    };
  }

  const interaction = activeInteraction(room);
  const actorIds = interaction?.actorPlayerIds ?? werewolfGameModule.getActingPlayerIds(room.game);
  const actorIdSet = new Set(actorIds);
  const onlineWaitingCount = room.players.filter(
    player => actorIdSet.has(player.id) && player.connected && Boolean(player.socketId),
  ).length;

  return {
    hasPendingInteraction: Boolean(interaction),
    waitingCount: actorIds.length,
    onlineWaitingCount,
    offlineWaitingCount: actorIds.length - onlineWaitingCount,
  };
}

export function roomGameView(room: RuntimeRoom, isHost: boolean): Record<string, unknown> | undefined {
  if (!room.game) return undefined;
  const context = gameViewContext(room);
  if (!isHost) return werewolfGameModule.getPublicView(room.game, context);
  return {
    ...werewolfGameModule.getHostView(room.game, context),
    recovery: hostRecoveryStatus(room),
  };
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
  environment: WerewolfCommandEnvironment = nodeCommandEnvironment,
): WerewolfCommandOutcome {
  return executeWerewolfRoomCommand(room, command, context, environment);
}
