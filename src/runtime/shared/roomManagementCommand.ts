import { RoomCore } from "../../core/room/RoomCore.js";
import type { RoomPlayer, RoomState } from "../../core/room/types.js";
import type { RoomManagementCommand } from "../../protocol/client/ClientRoomManagementProtocol.js";

export type RoomManagementCommandOutcome =
  | { kind: "updatedName"; name: string }
  | { kind: "movedPlayer"; playerId: string }
  | { kind: "removedPlayer"; playerId: string }
  | { kind: "transferredHost"; playerId: string }
  | {
      kind: "leftAndTransferred";
      leavingPlayerId: string;
      newHostPlayerId: string;
    }
  | { kind: "closedRoom"; roomId: string }
  | {
      kind: "leftRoom";
      leavingPlayerId: string;
      roomEmpty: boolean;
    };

export type RoomManagementDependencies = {
  isPlayerConnected(playerId: string): boolean;
};

export class RoomManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomManagementError";
  }
}

function requireActor<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
  actorPlayerId: string,
): TPlayer {
  const actor = room.players.find(player => player.id === actorPlayerId);
  if (!actor) throw new RoomManagementError("你当前不在房间中");
  return actor;
}

function requireHost(player: RoomPlayer, message: string): void {
  if (!player.isHost) throw new RoomManagementError(message);
}

function requireOtherPlayer<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
  actorPlayerId: string,
  targetPlayerId: string,
  message: string,
): TPlayer {
  const target = room.players.find(player => player.id === targetPlayerId);
  if (!target || target.id === actorPlayerId) {
    throw new RoomManagementError(message);
  }
  return target;
}

/**
 * Platform-neutral room-management semantic owner.
 *
 * Transport/runtime layers own authentication, commandId dedupe, persistence,
 * revision advancement and lifecycle delivery. This function owns only the
 * mutation rules for one already-authenticated stable player identity.
 */
export function executeRoomManagementMutation<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
  actorPlayerId: string,
  command: RoomManagementCommand,
  dependencies: RoomManagementDependencies,
): RoomManagementCommandOutcome {
  const actor = requireActor(room, actorPlayerId);
  const core = new RoomCore(room);

  switch (command.type) {
    case "room.updateName": {
      const normalized = command.name.trim();
      if (!normalized) throw new RoomManagementError("名字不能为空");
      if (normalized.length > 20) {
        throw new RoomManagementError("名字最多20个字符");
      }
      if (core.hasPlayerName(normalized, actor.id)) {
        throw new RoomManagementError("这个名字已被房间里的其他玩家使用");
      }
      const renamed = core.renamePlayer(actor.id, normalized);
      return { kind: "updatedName", name: renamed.name };
    }

    case "room.movePlayerSeat": {
      requireHost(actor, "只有房主可以调整座位");
      if (room.game !== undefined) {
        throw new RoomManagementError("游戏开始后不能调整座位");
      }
      if (!room.players.some(player => player.id === command.targetPlayerId)) {
        throw new RoomManagementError("玩家不存在");
      }
      if (
        !Number.isInteger(command.insertIndex) ||
        command.insertIndex < 0 ||
        command.insertIndex > room.players.length
      ) {
        throw new RoomManagementError("目标座位无效");
      }
      core.movePlayerSeat(command.targetPlayerId, command.insertIndex);
      return { kind: "movedPlayer", playerId: command.targetPlayerId };
    }

    case "room.removePlayer": {
      requireHost(actor, "只有房主可以移除玩家");
      if (room.game !== undefined) {
        throw new RoomManagementError("游戏开始后不能移除玩家");
      }
      const target = requireOtherPlayer(
        room,
        actor.id,
        command.targetPlayerId,
        "请选择一名其他玩家",
      );
      if (target.isHost) {
        throw new RoomManagementError("请选择一名其他玩家");
      }
      core.removePlayer(target.id);
      return { kind: "removedPlayer", playerId: target.id };
    }

    case "room.transferHost": {
      requireHost(actor, "只有房主可以转让房主");
      const target = requireOtherPlayer(
        room,
        actor.id,
        command.targetPlayerId,
        "请选择一名其他玩家",
      );
      if (!dependencies.isPlayerConnected(target.id)) {
        throw new RoomManagementError("只能将房主转让给在线玩家");
      }
      core.transferHost(target.id);
      return { kind: "transferredHost", playerId: target.id };
    }

    case "room.leaveAndTransfer": {
      requireHost(actor, "只有房主可以转让后退出");
      if (room.game !== undefined) {
        throw new RoomManagementError(
          "游戏开始后不能单独退出；如需中断游戏，请关闭房间",
        );
      }
      const target = requireOtherPlayer(
        room,
        actor.id,
        command.targetPlayerId,
        "请选择一名其他玩家",
      );
      if (!dependencies.isPlayerConnected(target.id)) {
        throw new RoomManagementError("只能将房主转让给在线玩家");
      }
      core.transferHost(target.id);
      core.removePlayer(actor.id);
      return {
        kind: "leftAndTransferred",
        leavingPlayerId: actor.id,
        newHostPlayerId: target.id,
      };
    }

    case "room.close":
      requireHost(actor, "只有房主可以关闭房间");
      return { kind: "closedRoom", roomId: room.id };

    case "room.leave": {
      if (room.game !== undefined) {
        throw new RoomManagementError("游戏开始后不能退出房间");
      }
      if (actor.isHost && room.players.length > 1) {
        throw new RoomManagementError("请先指定新的房主，再退出房间");
      }
      core.removePlayer(actor.id);
      return {
        kind: "leftRoom",
        leavingPlayerId: actor.id,
        roomEmpty: room.players.length === 0,
      };
    }
  }
}
