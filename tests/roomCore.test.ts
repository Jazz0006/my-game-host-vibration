import { describe, expect, it } from "vitest";
import { RoomCore } from "../src/core/room/RoomCore.js";
import type { RoomPlayer, RoomState } from "../src/core/room/types.js";

function player(
  id: string,
  name: string,
  seat: number,
  isHost = false,
): RoomPlayer {
  return {
    id,
    name,
    seat,
    isHost,
    resumeTokenHash: `hash-${id}`,
  };
}

function room(players: RoomPlayer[]): RoomState<undefined, { gameType: string }> {
  return {
    id: "123456",
    players,
    createdAt: 1,
    config: { gameType: "werewolf" },
  };
}

describe("RoomCore", () => {
  it("adds players at the end with continuous seats", () => {
    const core = new RoomCore(room([player("p1", "房主", 1, true)]));

    const added = core.addPlayer({
      id: "p2",
      name: "玩家二号",
      isHost: false,
      resumeTokenHash: "hash-p2",
    });

    expect(added.seat).toBe(2);
    expect(core.state.players.map(item => item.seat)).toEqual([1, 2]);
  });

  it("removes a player and closes the seat gap", () => {
    const core = new RoomCore(room([
      player("p1", "房主", 1, true),
      player("p2", "玩家二号", 2),
      player("p3", "玩家三号", 3),
    ]));

    expect(core.removePlayer("p2")?.id).toBe("p2");
    expect(core.state.players.map(item => ({ id: item.id, seat: item.seat }))).toEqual([
      { id: "p1", seat: 1 },
      { id: "p3", seat: 2 },
    ]);
  });

  it("moves players while preserving continuous seat numbers", () => {
    const core = new RoomCore(room([
      player("p1", "房主", 1, true),
      player("p2", "玩家二号", 2),
      player("p3", "玩家三号", 3),
    ]));

    core.movePlayerSeat("p3", 0);

    expect(core.state.players.map(item => ({ id: item.id, seat: item.seat }))).toEqual([
      { id: "p3", seat: 1 },
      { id: "p1", seat: 2 },
      { id: "p2", seat: 3 },
    ]);
  });

  it("transfers host ownership to exactly one member", () => {
    const core = new RoomCore(room([
      player("p1", "房主", 1, true),
      player("p2", "玩家二号", 2),
    ]));

    core.transferHost("p2");

    expect(core.state.players.map(item => ({ id: item.id, isHost: item.isHost }))).toEqual([
      { id: "p1", isHost: false },
      { id: "p2", isHost: true },
    ]);
  });

  it("enforces case-insensitive unique names and trims renames", () => {
    const core = new RoomCore(room([
      player("p1", "Alice", 1, true),
      player("p2", "Bob", 2),
    ]));

    expect(() => core.renamePlayer("p2", " alice ")).toThrow("player name already exists in room");
    expect(core.renamePlayer("p2", "  小明  ").name).toBe("小明");
    expect(core.hasPlayerName("小明")).toBe(true);
  });

  it("exposes public room members without resume credentials", () => {
    const core = new RoomCore(room([player("p1", "房主", 1, true)]));

    expect(core.publicPlayers()).toEqual([
      { id: "p1", name: "房主", seat: 1, isHost: true },
    ]);
    expect(core.publicPlayers()[0]).not.toHaveProperty("resumeTokenHash");
  });
});
