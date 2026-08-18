import { describe, expect, it } from "vitest";
import { configFromPlayerCount } from "../src/domain/game.js";
import {
  actingPlayerIds,
  createWerewolfGame,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";
import {
  runHostCommand,
  runHostRecoveryCommandIdempotent,
  runPlayerCommand,
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

function prepareActiveInteraction(currentRoom: RuntimeRoom): string[] {
  const game = createWerewolfGame(currentRoom, currentRoom.gameConfig);
  const roleRevealActionId = game.actionId;

  for (const player of currentRoom.players) {
    runPlayerCommand(currentRoom, player.id, {
      type: "confirmRole",
      actionId: roleRevealActionId,
    });
  }

  expect(currentRoom.game?.phase).toBe("night_start");
  runHostCommand(currentRoom, { type: "startNight" });

  const actors = actingPlayerIds(currentRoom);
  expect(actors.length).toBeGreaterThan(0);
  return actors;
}

describe("C4.1 host recovery runtime", () => {
  it("dedupes a retried host reminder without mutating authoritative game state", async () => {
    const currentRoom = room();
    const actors = prepareActiveInteraction(currentRoom);
    const gameBefore = JSON.stringify(currentRoom.game);
    let deliveries = 0;

    const first = await runHostRecoveryCommandIdempotent(
      currentRoom,
      "cmd-resend-current-action",
      () => {
        deliveries += 1;
        return { kind: "hostRecoveryReminder", actorPlayerIds: actors };
      },
    );

    expect(first).toEqual({
      outcome: { kind: "hostRecoveryReminder", actorPlayerIds: actors },
      replayed: false,
    });
    expect(deliveries).toBe(1);
    expect(JSON.stringify(currentRoom.game)).toBe(gameBefore);

    const retry = await runHostRecoveryCommandIdempotent(
      currentRoom,
      "cmd-resend-current-action",
      () => {
        deliveries += 1;
        return { kind: "hostRecoveryReminder", actorPlayerIds: actors };
      },
    );

    expect(retry).toEqual({
      outcome: { kind: "hostRecoveryReminder", actorPlayerIds: actors },
      replayed: true,
    });
    expect(deliveries).toBe(1);
    expect(JSON.stringify(currentRoom.game)).toBe(gameBefore);
    expect(currentRoom.commandReceipts).toEqual([
      {
        commandId: "host:cmd-resend-current-action",
        result: { kind: "hostRecoveryReminder", actorPlayerIds: actors },
      },
    ]);
  });

  it("treats a new commandId as a deliberate second reminder", async () => {
    const currentRoom = room();
    const actors = prepareActiveInteraction(currentRoom);
    let deliveries = 0;

    for (const commandId of ["cmd-remind-1", "cmd-remind-2"]) {
      const result = await runHostRecoveryCommandIdempotent(
        currentRoom,
        commandId,
        () => {
          deliveries += 1;
          return { kind: "hostRecoveryReminder", actorPlayerIds: actors };
        },
      );
      expect(result.replayed).toBe(false);
    }

    expect(deliveries).toBe(2);
    expect(currentRoom.commandReceipts).toHaveLength(2);
  });
});
