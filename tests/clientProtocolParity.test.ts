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
import type { RuntimeCommandOutcome, RuntimeRoom } from "../src/runtime/node/roomBridge.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfCommandRuntime } from "../src/runtime/cloudflare/CloudflareWerewolfCommandRuntime.js";
import {
  createCloudflarePlayerStateEnvelope,
  executeCloudflareClientProtocolCommand,
} from "../src/runtime/cloudflare/CloudflareClientProtocolAdapter.js";
import {
  createNodePlayerStateEnvelope,
  executeNodeClientProtocolCommand,
} from "../src/runtime/node/NodeClientProtocolAdapter.js";
import type { WerewolfCommandEnvironment } from "../src/runtime/shared/werewolfRoomCommand.js";
import { getActiveWerewolfInteraction } from "../src/games/werewolf/WerewolfNightPlanner.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import type { WerewolfClientCommandEnvelope } from "../src/protocol/client/werewolf/WerewolfClientProtocol.js";

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
    { revision: 7 },
  );
}

function nodeRoomFromSnapshot(snapshot: ReturnType<typeof startingSnapshot>): RuntimeRoom {
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
    ...(room.commandReceipts === undefined ? {} : { commandReceipts: room.commandReceipts }),
  });
}

describe("E1 Node / Cloudflare client protocol parity", () => {
  it("executes the same protocol command through both adapters with the same authoritative result", async () => {
    const snapshot = startingSnapshot();
    const envelope: WerewolfClientCommandEnvelope = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: snapshot.game!.actionId },
      "protocol-confirm-final",
    );

    const nodeRoom = nodeRoomFromSnapshot(snapshot);
    const nodeExecution = await executeNodeClientProtocolCommand(
      nodeRoom,
      "p5",
      envelope,
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
    const cloudflareExecution = await executeCloudflareClientProtocolCommand(
      cloudflareRuntime,
      "p5",
      envelope,
    );

    expect(nodeExecution).toEqual({ outcome: { kind: "broadcast" }, replayed: false });
    expect(cloudflareExecution.outcome).toEqual(nodeExecution.outcome);
    expect(cloudflareExecution.replayed).toBe(nodeExecution.replayed);
    expect(cloudflareExecution.snapshot).toEqual(nodeSnapshot);
    expect(cloudflareExecution.snapshot.game?.phase).toBe("night_start");
    expect(cloudflareExecution.snapshot.commandReceipts?.at(-1)?.commandId).toBe(
      "player:p5:protocol-confirm-final",
    );
  });

  it("projects the same private player state envelope from Node and a Cloudflare snapshot", () => {
    const snapshot = startingSnapshot();
    const nodeRoom = nodeRoomFromSnapshot(snapshot);

    const nodeState = createNodePlayerStateEnvelope(nodeRoom, "p5");
    const cloudflareState = createCloudflarePlayerStateEnvelope(snapshot, "p5");

    expect(cloudflareState).toEqual(nodeState);
    expect(nodeState).toMatchObject({
      protocolVersion: 1,
      kind: "state",
      scope: "player",
      roomId: "1234",
      playerId: "p5",
    });
  });

  it("enforces host authority before dispatching a host protocol command on both adapters", async () => {
    const snapshot = startingSnapshot();
    const envelope: WerewolfClientCommandEnvelope = createClientCommandEnvelope(
      "werewolf.startNight",
      {},
      "host-only",
    );

    const nodeRoom = nodeRoomFromSnapshot(snapshot);
    expect(() =>
      executeNodeClientProtocolCommand(nodeRoom, "p2", envelope, deterministicEnvironment(1)),
    ).toThrow("host command requires host authority");

    const storage = new MemoryStorage();
    const repository = new CloudflareRoomSnapshotRepository(storage);
    await repository.save(structuredClone(snapshot));
    const cloudflareRuntime = new CloudflareWerewolfCommandRuntime(
      storage,
      deterministicEnvironment(1),
    );

    await expect(
      executeCloudflareClientProtocolCommand(cloudflareRuntime, "p2", envelope),
    ).rejects.toThrow("host command requires host authority");
  });
});
