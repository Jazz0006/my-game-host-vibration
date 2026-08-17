import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../src/domain/game.js";
import {
  createWerewolfGame,
  executeWerewolfCommand,
  gameViewContext,
  playerGameView,
  roomCore,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";

function runtimeRoom(): RuntimeRoom {
  return {
    id: "123456",
    gameType: "werewolf",
    players: [
      {
        id: "p1",
        name: "房主",
        seat: 1,
        isHost: true,
        resumeTokenHash: "hash-p1",
        socketId: "socket-1",
        connected: true,
      },
      {
        id: "p2",
        name: "玩家二号",
        seat: 2,
        isHost: false,
        resumeTokenHash: "hash-p2",
        socketId: "socket-2",
        connected: true,
      },
      {
        id: "p3",
        name: "玩家三号",
        seat: 3,
        isHost: false,
        resumeTokenHash: "hash-p3",
        socketId: "socket-3",
        connected: true,
      },
      {
        id: "p4",
        name: "玩家四号",
        seat: 4,
        isHost: false,
        resumeTokenHash: "hash-p4",
        socketId: "socket-4",
        connected: true,
      },
      {
        id: "p5",
        name: "玩家五号",
        seat: 5,
        isHost: false,
        resumeTokenHash: "hash-p5",
        socketId: "socket-5",
        connected: true,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    gameConfig: DEFAULT_GAME_CONFIG,
  };
}

describe("Node room bridge", () => {
  it("keeps connection fields in the runtime layer while exposing only game view refs", () => {
    const room = runtimeRoom();

    expect(gameViewContext(room)).toEqual({
      players: [
        { id: "p1", name: "房主", seat: 1 },
        { id: "p2", name: "玩家二号", seat: 2 },
        { id: "p3", name: "玩家三号", seat: 3 },
        { id: "p4", name: "玩家四号", seat: 4 },
        { id: "p5", name: "玩家五号", seat: 5 },
      ],
    });
  });

  it("routes room mutations through RoomCore without losing runtime connection data", () => {
    const room = runtimeRoom();
    const core = roomCore(room);

    core.renamePlayer("p2", "  小明  ");
    core.movePlayerSeat("p2", 0);

    const player = room.players.find(item => item.id === "p2");
    expect(player?.name).toBe("小明");
    expect(player?.seat).toBe(1);
    expect(player?.socketId).toBe("socket-2");
    expect(player?.connected).toBe(true);
  });

  it("creates the game through WerewolfGameModule and serves its private view", () => {
    const room = runtimeRoom();

    const game = createWerewolfGame(room, DEFAULT_GAME_CONFIG);
    const view = playerGameView(room, "p1") as Record<string, unknown>;

    expect(room.game).toBe(game);
    expect(room.gameType).toBe("werewolf");
    expect(game.config).toBe(DEFAULT_GAME_CONFIG);
    expect(view.phase).toBe("role_reveal");
    expect(view.mode).toBe("role_reveal");
  });

  it("maps explicit game outcomes to Node orchestration outcomes", () => {
    const room = runtimeRoom();
    const game = createWerewolfGame(room, DEFAULT_GAME_CONFIG);

    const outcome = executeWerewolfCommand(
      room,
      { type: "confirmRole", actionId: game.actionId },
      { playerId: "p1" },
    );

    expect(outcome).toEqual({ kind: "broadcast" });
    expect(game.confirmedRolePlayerIds).toContain("p1");
  });
});
