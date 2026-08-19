import { describe, expect, it } from "vitest";
import type { CommandReceipt } from "../src/core/command/IdempotentCommandLedger.js";
import {
  createRoomSnapshot,
  nextRoomRevision,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import {
  configFromRoleDeck,
  confirmRole,
  startGame,
  type GameConfig,
  type GameState,
} from "../src/domain/game.js";
import type { WerewolfCommand } from "../src/games/werewolf/WerewolfGameModule.js";
import { getActiveWerewolfInteraction } from "../src/games/werewolf/WerewolfNightPlanner.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfCommandRuntime } from "../src/runtime/cloudflare/CloudflareWerewolfCommandRuntime.js";
import {
  type RuntimeCommandOutcome,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";
import { runPlayerCommandIdempotent } from "../src/runtime/node/werewolfCommandFacade.js";
import type { WerewolfCommandEnvironment } from "../src/runtime/shared/werewolfRoomCommand.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

function deterministicEnvironment(startId: number, now = 2_000): WerewolfCommandEnvironment {
  let id = startId;
  return {
    random: {
      randomInt(maxExclusive) {
        return maxExclusive - 1;
      },
      randomId() {
        id += 1;
        return `action-${id}`;
      },
    },
    now: () => now,
  };
}

function startingSnapshot(): RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  unknown,
  CommandReceipt<RuntimeCommandOutcome>
> {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const config = configFromRoleDeck(
    5,
    ["werewolf", "seer", "witch", "villager", "villager"],
  );
  const setupRandom = deterministicEnvironment(0, 20).random;
  const game = startGame(playerIds, config, setupRandom);

  for (const playerId of playerIds.slice(0, -1)) {
    expect(confirmRole(game, playerId, game.actionId, setupRandom)).toBe(false);
  }

  return createRoomSnapshot(
    {
      id: "1234",
      gameType: "werewolf",
      players: playerIds.map((id, index) => ({
        id,
        name: `Player ${index + 1}`,
        seat: index + 1,
        isHost: index === 0,
        resumeTokenHash: String(index + 1).repeat(64),
      })),
      createdAt: 10,
      updatedAt: 20,
      gameConfig: config,
      game,
    },
    {
      revision: 7,
      commandReceipts: [
        {
          commandId: "host:old-recovery",
          result: { kind: "hostRecoveryReminder", actorPlayerIds: ["p2"] },
        },
      ],
    },
  );
}

function nodeRoomFromSnapshot(
  snapshot: ReturnType<typeof startingSnapshot>,
): RuntimeRoom {
  const restored = restoreRoomSnapshot(structuredClone(snapshot));
  return {
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
}

function projectNodeSnapshot(
  room: RuntimeRoom,
  revision: number,
): RoomSnapshot<GameState, GameConfig, unknown, unknown, CommandReceipt<RuntimeCommandOutcome>> {
  const pendingInteraction = room.game
    ? getActiveWerewolfInteraction(room.game)
    : undefined;
  return createRoomSnapshot(room, {
    revision,
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
    ...(room.commandReceipts === undefined
      ? {}
      : { commandReceipts: room.commandReceipts }),
  });
}

describe("D5 Node / Cloudflare parity", () => {
  it("produces the same authoritative result from the same snapshot and command", async () => {
    const snapshot = startingSnapshot();
    const command: WerewolfCommand = {
      type: "confirmRole",
      actionId: snapshot.game!.actionId,
    };

    const nodeRoom = nodeRoomFromSnapshot(snapshot);
    const nodeExecution = await runPlayerCommandIdempotent(
      nodeRoom,
      "p5",
      "confirm-final-role",
      command,
      deterministicEnvironment(1),
    );
    const nodeSnapshot = projectNodeSnapshot(
      nodeRoom,
      nextRoomRevision(snapshot.revision),
    );

    const storage = new MemoryStorage();
    const repository = new CloudflareRoomSnapshotRepository(storage);
    await repository.save(structuredClone(snapshot));
    const cloudflareRuntime = new CloudflareWerewolfCommandRuntime(
      storage,
      deterministicEnvironment(1),
    );
    const cloudflareExecution = await cloudflareRuntime.executePlayer(
      "p5",
      "confirm-final-role",
      command,
    );

    expect(nodeExecution).toEqual({ outcome: { kind: "broadcast" }, replayed: false });
    expect(cloudflareExecution.outcome).toEqual(nodeExecution.outcome);
    expect(cloudflareExecution.replayed).toBe(false);
    expect(cloudflareExecution.revision).toBe(nodeSnapshot.revision);
    expect(cloudflareExecution.snapshot).toEqual(nodeSnapshot);
    expect(cloudflareExecution.snapshot.game?.phase).toBe("night_start");
    expect(cloudflareExecution.snapshot.game?.actionId).toBe("action-2");
    expect(cloudflareExecution.snapshot.commandReceipts?.[0]?.commandId).toBe(
      "host:old-recovery",
    );
  });

  it("restores command receipts after Cloudflare reconstruction and replays without revision drift", async () => {
    const snapshot = startingSnapshot();
    const command: WerewolfCommand = {
      type: "confirmRole",
      actionId: snapshot.game!.actionId,
    };

    const nodeRoom = nodeRoomFromSnapshot(snapshot);
    const firstNode = await runPlayerCommandIdempotent(
      nodeRoom,
      "p5",
      "same-command",
      command,
      deterministicEnvironment(1),
    );
    const replayedNode = await runPlayerCommandIdempotent(
      nodeRoom,
      "p5",
      "same-command",
      command,
      deterministicEnvironment(99),
    );

    const storage = new MemoryStorage();
    const repository = new CloudflareRoomSnapshotRepository(storage);
    await repository.save(structuredClone(snapshot));

    const firstCloudflareRuntime = new CloudflareWerewolfCommandRuntime(
      storage,
      deterministicEnvironment(1),
    );
    const firstCloudflare = await firstCloudflareRuntime.executePlayer(
      "p5",
      "same-command",
      command,
    );
    const persistedAfterFirst = await repository.load();

    // New runtime instance simulates a Durable Object reconstruction after
    // hibernation/eviction. The receipt must be recovered from D3 storage.
    const reconstructedRuntime = new CloudflareWerewolfCommandRuntime(
      storage,
      deterministicEnvironment(99),
    );
    const replayedCloudflare = await reconstructedRuntime.executePlayer(
      "p5",
      "same-command",
      command,
    );
    const persistedAfterReplay = await repository.load();

    expect(firstNode.replayed).toBe(false);
    expect(replayedNode).toEqual({ outcome: firstNode.outcome, replayed: true });
    expect(firstCloudflare.replayed).toBe(false);
    expect(replayedCloudflare).toEqual({
      outcome: firstCloudflare.outcome,
      replayed: true,
      revision: firstCloudflare.revision,
      snapshot: firstCloudflare.snapshot,
    });
    expect(persistedAfterReplay).toEqual(persistedAfterFirst);
    expect(replayedCloudflare.revision).toBe(snapshot.revision + 1);
  });
});
