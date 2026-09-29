import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { GameConfig, GameState } from "../../domain/game.js";
import { GameRuleError } from "../../games/werewolf/WerewolfDomainFacade.js";
import type { RoomRecoveryCommand } from "../../protocol/client/ClientRecoveryProtocol.js";
import { werewolfActingPlayerIds } from "./werewolfRoomView.js";

export type RoomRecoveryCommandOutcome =
  | {
      kind: "hostRecoveryReminder";
      actorPlayerIds: string[];
      actionId: string;
      phase: string;
    }
  | { kind: "abortedToLobby" };

export type RoomRecoveryDependencies = {
  isPlayerConnected(playerId: string): boolean;
  now(): number;
};

export function assertRoomRecoveryAuthority<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
  actorPlayerId: string,
  command: RoomRecoveryCommand,
): TPlayer {
  const actor = room.players.find(player => player.id === actorPlayerId);
  if (!actor) throw new GameRuleError("你当前不在房间中");
  if (!actor.isHost) {
    throw new GameRuleError(
      command.type === "recovery.resendCurrentAction"
        ? "只有房主可以重新提醒当前行动"
        : "只有房主可以中断当前游戏",
    );
  }
  return actor;
}

/**
 * Transport-neutral semantic owner for current-room recovery commands.
 *
 * Runtime adapters own commandId dedupe, persistence, state/effect delivery,
 * timeout cleanup and any dev/test-only state. This function owns only the
 * authoritative room/game mutation and the stable set of currently deliverable
 * action actors.
 */
export function executeRoomRecoveryCommand<TPlayer extends RoomPlayer>(
  room: RoomState<GameState, GameConfig, TPlayer>,
  actorPlayerId: string,
  command: RoomRecoveryCommand,
  dependencies: RoomRecoveryDependencies,
): RoomRecoveryCommandOutcome {
  assertRoomRecoveryAuthority(room, actorPlayerId, command);

  if (command.type === "recovery.resendCurrentAction") {
    if (!room.game) throw new GameRuleError("游戏尚未开始");

    const actorPlayerIds = werewolfActingPlayerIds(room).filter(playerId =>
      dependencies.isPlayerConnected(playerId)
    );
    if (actorPlayerIds.length === 0) {
      throw new GameRuleError("当前没有在线的行动玩家需要提醒");
    }

    return {
      kind: "hostRecoveryReminder",
      actorPlayerIds,
      actionId: room.game.actionId,
      phase: room.game.phase,
    };
  }

  if (!room.game) throw new GameRuleError("游戏尚未开始");
  delete room.game;
  room.updatedAt = dependencies.now();
  return { kind: "abortedToLobby" };
}
