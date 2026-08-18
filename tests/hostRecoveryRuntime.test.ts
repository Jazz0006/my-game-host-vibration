import { describe, expect, it } from "vitest";
import { configFromPlayerCount } from "../src/domain/game.js";
import { onlineActingPlayers } from "../src/runtime/node/hostRecovery.js";
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
  it("projects only online current actors for reminder delivery", () => {
    const currentRoom = room();
    const actors = prepareActiveInteraction(currentRoom);
    const offlineActor = currentRoom.players.find(player => actors.includes(player.id));
    expect(offlineActor).toBeDefined();

    offlineActor!.connected = false;
    offlineActor!.socketId = null;

    const onlineActors = onlineActingPlayers(currentRoom);
    expect(onlineActors.map(player => player.id)).not.toContain(offlineActor!.id);
    expect(onlineActors.every(player => actors.includes(player.id))).toBe(true);
    expect(onlineActors.every(player => player.connected && player.socketId)).toBe(true);
  });

  it("dedupes a retried host reminder without mutating authoritative game state", async () => {
    const currentRoom = room();
    prepareActiveInteraction(currentRoom);
    const gameBefore = JSON.stringify(currentRoom.game);
    let deliveries = 0;

    const deliver = () => {
      deliveries += 1;
      return {
        kind: "hostRecoveryReminder" as const,
        actorPlayerIds: onlineActingPlayers(currentRoom).map(player => player.id),
      };
    };

    const first = await runHostRecoveryCommandIdempotent(
      currentRoom,
      "cmd-resend-current-action",
      deliver,
    );

    expect(first.replayed).toBe(false);
    expect(first.outcome.kind).toBe("hostRecoveryReminder");
    expect(deliveries).toBe(1);
    expect(JSON.stringify(currentRoom.game)).toBe(gameBefore);

    const retry = await runHostRecoveryCommandIdempotent(
      currentRoom,
      "cmd-resend-current-action",
      deliver,
    );

    expect(retry).toEqual({ outcome: first.outcome, replayed: true });
    expect(deliveries).toBe(1);
    expect(JSON.stringify(currentRoom.game)).toBe(gameBefore);
    expect(currentRoom.commandReceipts).toEqual([
      {
        commandId: "host:cmd-resend-current-action",
        result: first.outcome,
      },
    ]);
  });

  it("treats a new commandId as a deliberate second reminder", async () => {
    const currentRoom = room();
    prepareActiveInteraction(currentRoom);
    let deliveries = 0;

    for (const commandId of ["cmd-remind-1", "cmd-remind-2"]) {
      const result = await runHostRecoveryCommandIdempotent(
        currentRoom,
        commandId,
        () => {
          deliveries += 1;
          return {
            kind: "hostRecoveryReminder",
            actorPlayerIds: onlineActingPlayers(currentRoom).map(player => player.id),
          };
        },
      );
      expect(result.replayed).toBe(false);
    }

    expect(deliveries).toBe(2);
    expect(currentRoom.commandReceipts).toHaveLength(2);
  });
});
