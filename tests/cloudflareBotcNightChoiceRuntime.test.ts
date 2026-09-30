import { describe, expect, it } from "vitest";
import type { GameCommandContext, GameModuleDependencies } from "../src/core/game/GameModule.js";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import {
  BotcGameModule,
  type BotcGameConfig,
  type BotcGameState,
} from "../src/games/botc/BotcGameModule.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import {
  parseBotcClientCommandEnvelope,
} from "../src/protocol/client/BotcClientProtocol.js";
import { CloudflareBotcCommandRuntime } from "../src/runtime/cloudflare/CloudflareBotcCommandRuntime.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import {
  createGameRoomStateEnvelope,
} from "../src/runtime/shared/gameClientStateProjection.js";

class MemoryStorage implements DurableObjectStorageLike {
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

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

function playerContext(playerId: string): GameCommandContext {
  return { playerId, isModerator: false, now: 1 };
}

function activePoisonerGame(): BotcGameState {
  const module = new BotcGameModule();
  const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const game = module.createGame(
    {
      playerIds,
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "poisoner" },
        { playerId: "p2", actualRoleId: "imp" },
        { playerId: "p3", actualRoleId: "butler" },
        { playerId: "p4", actualRoleId: "washerwoman" },
        { playerId: "p5", actualRoleId: "chef" },
        { playerId: "p6", actualRoleId: "empath" },
      ],
    },
    dependencies,
  );

  for (const playerId of playerIds) {
    module.handleCommand(
      game,
      playerContext(playerId),
      { type: "confirmRole" },
      dependencies,
    );
  }
  module.handleCommand(
    game,
    { isModerator: true, now: 1 },
    { type: "beginFirstNight" },
    dependencies,
  );
  return game;
}

describe("PV-3B1 Cloudflare BotC night-choice runtime", () => {
  it("persists and replays the active player's Poisoner choice without leaking it publicly", async () => {
    const storage = new MemoryStorage();
    const game = activePoisonerGame();
    const room = {
      id: "2468",
      gameType: "botc",
      players: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id, index) => ({
        id,
        name: `Player ${index + 1}`,
        seat: index + 1,
        isHost: id === "p1",
        ready: true,
        resumeTokenHash: String(index + 1).repeat(64),
      })),
      createdAt: 1,
      updatedAt: 1,
      gameModerator: { mode: "automatic" as const },
      gameConfig: { scriptId: "trouble-brewing" as const },
      game,
    };
    const snapshot = createRoomSnapshot<
      BotcGameState,
      BotcGameConfig,
      (typeof room.players)[number]
    >(room, { revision: 9 });
    await new CloudflareRoomSnapshotRepository(storage).save(snapshot);

    const runtime = new CloudflareBotcCommandRuntime(storage, {
      isPlayerConnected: () => true,
      environment: {
        random: dependencies.random,
        now: () => 2,
      },
    });
    const command = parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.submitNightChoice",
        { playerIds: ["p4"] },
        "poison-choice-1",
      ),
    );

    await expect(runtime.execute("p2", command)).rejects.toThrow(
      "Only the active BotC night actor",
    );

    const execution = await runtime.execute("p1", command);
    expect(execution).toMatchObject({
      replayed: false,
      revision: 10,
      outcome: {
        kind: "nightChoiceCommitted",
        completedStepId: "role:poisoner",
        selectedPlayerIds: ["p4"],
        nextStepId: "role:washerwoman",
        nightComplete: false,
      },
      snapshot: {
        game: {
          poisonedPlayerId: "p4",
        },
      },
    });

    const replay = await runtime.execute("p1", command);
    expect(replay).toMatchObject({
      replayed: true,
      revision: 10,
      outcome: execution.outcome,
    });

    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(10);
    expect((persisted?.game as BotcGameState | undefined)?.poisonedPlayerId).toBe("p4");

    const publicEnvelope = createGameRoomStateEnvelope(
      execution.snapshot,
      "p2",
      () => true,
    );
    expect(JSON.stringify(publicEnvelope)).not.toContain("poisonedPlayerId");
    expect(JSON.stringify(publicEnvelope)).not.toContain("butlerMasterPlayerId");
  });
});
