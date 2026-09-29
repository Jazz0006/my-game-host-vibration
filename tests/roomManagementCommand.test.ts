import { describe, expect, it } from "vitest";
import type { RoomPlayer, RoomState } from "../src/core/room/types.js";
import {
  executeRoomManagementMutation,
  RoomManagementError,
} from "../src/runtime/shared/roomManagementCommand.js";

type TestPlayer = RoomPlayer & { connected: boolean };

function createRoom(): RoomState<unknown, { playerCount: number }, TestPlayer> {
  return {
    id: "1234",
    gameType: "werewolf",
    players: [
      {
        id: "p1",
        name: "Host",
        seat: 1,
        isHost: true,
        resumeTokenHash: "1".repeat(64),
        connected: true,
      },
      {
        id: "p2",
        name: "Player 2",
        seat: 2,
        isHost: false,
        resumeTokenHash: "2".repeat(64),
        connected: true,
      },
      {
        id: "p3",
        name: "Player 3",
        seat: 3,
        isHost: false,
        resumeTokenHash: "3".repeat(64),
        connected: true,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
    gameModerator: { mode: "automatic" },
    gameConfig: { playerCount: 3 },
  };
}

function execute(
  room: ReturnType<typeof createRoom>,
  actorPlayerId: string,
  command: Parameters<typeof executeRoomManagementMutation>[2],
) {
  return executeRoomManagementMutation(
    room,
    actorPlayerId,
    command,
    {
      isPlayerConnected(playerId) {
        return Boolean(
          room.players.find(player => player.id === playerId)?.connected,
        );
      },
    },
  );
}

describe("W3C shared room-management semantics", () => {
  it("owns rename and seat movement with continuous seats", () => {
    const room = createRoom();

    expect(execute(room, "p2", {
      type: "room.updateName",
      name: "  Alice  ",
    })).toEqual({ kind: "updatedName", name: "Alice" });

    expect(execute(room, "p1", {
      type: "room.movePlayerSeat",
      targetPlayerId: "p3",
      insertIndex: 0,
    })).toEqual({ kind: "movedPlayer", playerId: "p3" });

    expect(room.players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
    }))).toEqual([
      { id: "p3", name: "Player 3", seat: 1 },
      { id: "p1", name: "Host", seat: 2 },
      { id: "p2", name: "Alice", seat: 3 },
    ]);
  });

  it("owns remove, host transfer, leave-and-transfer, and ordinary leave", () => {
    const removalRoom = createRoom();
    expect(execute(removalRoom, "p1", {
      type: "room.removePlayer",
      targetPlayerId: "p2",
    })).toEqual({ kind: "removedPlayer", playerId: "p2" });
    expect(removalRoom.players.map(player => [player.id, player.seat])).toEqual([
      ["p1", 1],
      ["p3", 2],
    ]);

    const transferRoom = createRoom();
    expect(execute(transferRoom, "p1", {
      type: "room.transferHost",
      targetPlayerId: "p2",
    })).toEqual({ kind: "transferredHost", playerId: "p2" });
    expect(transferRoom.players.find(player => player.id === "p2")?.isHost).toBe(true);

    expect(execute(transferRoom, "p2", {
      type: "room.leaveAndTransfer",
      targetPlayerId: "p3",
    })).toEqual({
      kind: "leftAndTransferred",
      leavingPlayerId: "p2",
      newHostPlayerId: "p3",
    });
    expect(transferRoom.players.map(player => ({
      id: player.id,
      seat: player.seat,
      isHost: player.isHost,
    }))).toEqual([
      { id: "p1", seat: 1, isHost: false },
      { id: "p3", seat: 2, isHost: true },
    ]);

    expect(execute(transferRoom, "p1", { type: "room.leave" })).toEqual({
      kind: "leftRoom",
      leavingPlayerId: "p1",
      roomEmpty: false,
    });
    expect(transferRoom.players.map(player => player.id)).toEqual(["p3"]);
  });

  it("keeps moderator assignment owner-controlled, lobby-only, and self-healing on removal", () => {
    const room = createRoom();

    expect(execute(room, "p1", {
      type: "room.setGameModerator",
      assignment: { mode: "human", playerId: "p2" },
    })).toEqual({
      kind: "updatedGameModerator",
      assignment: { mode: "human", playerId: "p2" },
    });
    expect(room.gameModerator).toEqual({ mode: "human", playerId: "p2" });

    expect(() => execute(room, "p2", {
      type: "room.setGameModerator",
      assignment: { mode: "automatic" },
    })).toThrow("只有房主可以指定主持人");

    expect(execute(room, "p1", {
      type: "room.removePlayer",
      targetPlayerId: "p2",
    })).toEqual({ kind: "removedPlayer", playerId: "p2" });
    expect(room.gameModerator).toEqual({ mode: "automatic" });

    const activeRoom = createRoom();
    activeRoom.game = { phase: "night" };
    expect(() => execute(activeRoom, "p1", {
      type: "room.setGameModerator",
      assignment: { mode: "human", playerId: "p2" },
    })).toThrow("游戏开始后不能更换主持人");
  });

  it("owns close-room authorization without deleting storage itself", () => {
    const room = createRoom();

    expect(execute(room, "p1", { type: "room.close" })).toEqual({
      kind: "closedRoom",
      roomId: "1234",
    });
    expect(room.players).toHaveLength(3);

    expect(() => execute(room, "p2", { type: "room.close" })).toThrow(
      new RoomManagementError("只有房主可以关闭房间"),
    );
  });

  it("enforces host, connectivity, and active-game guard rails", () => {
    const room = createRoom();

    expect(() => execute(room, "p2", {
      type: "room.movePlayerSeat",
      targetPlayerId: "p3",
      insertIndex: 0,
    })).toThrow("只有房主可以调整座位");

    room.players.find(player => player.id === "p2")!.connected = false;
    expect(() => execute(room, "p1", {
      type: "room.transferHost",
      targetPlayerId: "p2",
    })).toThrow("只能将房主转让给在线玩家");

    room.game = { phase: "night" };
    expect(() => execute(room, "p1", {
      type: "room.removePlayer",
      targetPlayerId: "p2",
    })).toThrow("游戏开始后不能移除玩家");
    expect(() => execute(room, "p3", { type: "room.leave" })).toThrow(
      "游戏开始后不能退出房间",
    );
  });
});
