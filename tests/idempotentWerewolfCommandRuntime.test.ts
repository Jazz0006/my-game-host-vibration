import { describe, expect, it } from "vitest";
import {
  createRoomSnapshot,
  restoreRoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import { configFromPlayerCount } from "../src/domain/game.js";
import {
  createWerewolfGame,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";
import {
  runPlayerCommand,
  runPlayerCommandIdempotent,
} from "../src/runtime/node/werewolfCommandFacade.js";

function room(): RuntimeRoom {
  const config = configFromPlayerCount(5);
  return {
    id: "123456",
    gameType: "werewolf",
    players: Array.from({ length: 5 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `玩家${index + 1}`,
      seat: index + 1,
      isHost: index === 0,
      resumeTokenHash: String(index + 1).repeat(64),
      socketId: `s${index + 1}`,
      connected: true,
    })),
    createdAt: 1,
    updatedAt: 1,
    gameConfig: config,
  };
}

function prepareLastRoleConfirmation(currentRoom: RuntimeRoom): string {
  const game = createWerewolfGame(currentRoom, currentRoom.gameConfig);
  const actionId = game.actionId;
  for (const playerId of ["p1", "p2", "p3", "p4"]) {
    expect(runPlayerCommand(currentRoom, playerId, { type: "confirmRole", actionId })).toEqual({
      kind: "broadcast",
    });
  }
  expect(currentRoom.game?.phase).toBe("role_reveal");
  return actionId;
}

describe("C3 idempotent werewolf runtime commands", () => {
  it("applies the same retryable mutation once even after the first delivery advances phase", async () => {
    const currentRoom = room();
    const actionId = prepareLastRoleConfirmation(currentRoom);

    const first = await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      "cmd-confirm-p5",
      { type: "confirmRole", actionId },
    );

    expect(first.replayed).toBe(false);
    expect(first.outcome).toEqual({ kind: "broadcast" });
    expect(currentRoom.game?.phase).toBe("night_start");
    expect(currentRoom.game?.confirmedRolePlayerIds).toHaveLength(5);

    const actionIdAfterFirst = currentRoom.game?.actionId;
    const retry = await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      "cmd-confirm-p5",
      { type: "confirmRole", actionId },
    );

    expect(retry).toEqual({ outcome: { kind: "broadcast" }, replayed: true });
    expect(currentRoom.game?.phase).toBe("night_start");
    expect(currentRoom.game?.actionId).toBe(actionIdAfterFirst);
    expect(currentRoom.commandReceipts).toEqual([
      { commandId: "player:p5:cmd-confirm-p5", result: { kind: "broadcast" } },
    ]);
  });

  it("restores receipts through the authoritative room snapshot so retries stay deduped", async () => {
    const currentRoom = room();
    const actionId = prepareLastRoleConfirmation(currentRoom);

    await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      "cmd-before-recovery",
      { type: "confirmRole", actionId },
    );

    const commandReceipts = currentRoom.commandReceipts;
    expect(commandReceipts).toBeDefined();

    const snapshot = createRoomSnapshot(currentRoom, {
      revision: 9,
      ...(commandReceipts === undefined ? {} : { commandReceipts }),
    });
    expect(JSON.stringify(snapshot)).not.toContain("socketId");
    expect(snapshot.commandReceipts).toHaveLength(1);

    const persisted = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const restored = restoreRoomSnapshot(persisted);
    const recoveredRoom: RuntimeRoom = {
      ...restored.room,
      players: restored.room.players.map(player => ({
        ...player,
        socketId: null,
        connected: false,
      })),
      ...(restored.commandReceipts === undefined
        ? {}
        : { commandReceipts: restored.commandReceipts }),
    };

    expect(recoveredRoom.game?.phase).toBe("night_start");
    expect(recoveredRoom.commandReceipts).toHaveLength(1);

    const retry = await runPlayerCommandIdempotent(
      recoveredRoom,
      "p5",
      "cmd-before-recovery",
      { type: "confirmRole", actionId },
    );

    expect(retry).toEqual({ outcome: { kind: "broadcast" }, replayed: true });
    expect(recoveredRoom.game?.phase).toBe("night_start");
    expect(recoveredRoom.commandReceipts).toHaveLength(1);
  });

  it("treats a different commandId as a new delivery rather than replaying the old receipt", async () => {
    const currentRoom = room();
    const actionId = prepareLastRoleConfirmation(currentRoom);

    const first = await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      "cmd-original",
      { type: "confirmRole", actionId },
    );
    expect(first.replayed).toBe(false);

    const actionIdAfterFirst = currentRoom.game?.actionId;
    const second = await runPlayerCommandIdempotent(
      currentRoom,
      "p5",
      "cmd-different",
      { type: "confirmRole", actionId },
    );

    expect(second).toEqual({ outcome: { kind: "broadcast" }, replayed: false });
    expect(currentRoom.game?.phase).toBe("night_start");
    expect(currentRoom.game?.actionId).toBe(actionIdAfterFirst);
    expect(currentRoom.commandReceipts).toEqual([
      { commandId: "player:p5:cmd-original", result: { kind: "broadcast" } },
      { commandId: "player:p5:cmd-different", result: { kind: "broadcast" } },
    ]);
  });
});
