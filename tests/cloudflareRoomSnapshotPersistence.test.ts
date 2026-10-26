import { describe, expect, it } from "vitest";
import {
  createRoomSnapshot,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import { BotcGameModule, type BotcGameState } from "../src/games/botc/BotcGameModule.js";
import { parseBotcClientCommandEnvelope } from "../src/protocol/client/BotcClientProtocol.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { CloudflareBotcCommandRuntime } from "../src/runtime/cloudflare/CloudflareBotcCommandRuntime.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";

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

function authoritativeSnapshot() {
  return createRoomSnapshot(
    {
      id: "1234",
      gameType: "werewolf",
      players: [
        {
          id: "p1",
          name: "Host",
          seat: 1,
          isHost: true,
          resumeTokenHash: "a".repeat(64),
          socketId: "socket-ephemeral",
          connected: true,
        },
      ],
      createdAt: 10,
      updatedAt: 20,
      gameModerator: { mode: "automatic" },
      gameConfig: { playerCount: 5, roleDeck: ["werewolf"] },
      game: { phase: "night_werewolf", actionId: "a-1" },
    },
    {
      revision: 7,
      ruleState: { witchAntidoteUsed: false },
      pendingInteraction: { kind: "choose_target", actorPlayerIds: ["p1"] },
      commandReceipts: [
        { commandId: "player:p1:c-1", result: { kind: "broadcast" } },
      ],
    },
  );
}

function botcLobbySnapshot(): RoomSnapshot<BotcGameState> {
  return createRoomSnapshot({
    id: "2468",
    gameType: "botc",
    players: Array.from({ length: 5 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
      seat: index + 1,
      isHost: index === 0,
      resumeTokenHash: "a".repeat(64),
    })),
    createdAt: 1,
    updatedAt: 1,
    gameModerator: { mode: "automatic" },
    gameConfig: { scriptId: "trouble-brewing" },
  }, { revision: 4 });
}

describe("D3 Durable Object snapshot persistence", () => {
  it("keeps a BotC Session identity and opening facts through start retry, storage, and reconstructed command runtime", async () => {
    const storage = new MemoryStorage();
    const repository = new CloudflareRoomSnapshotRepository<RoomSnapshot<BotcGameState>>(storage);
    await repository.save(botcLobbySnapshot());
    let generatedIds = 0;
    const dependencies = {
      isPlayerConnected: () => true,
      environment: {
        random: { randomInt: () => 0, randomId: () => `game-${++generatedIds}` },
        now: () => 2,
      },
    };
    const start = parseBotcClientCommandEnvelope(
      createClientCommandEnvelope("botc.startGame", {}, "start-1"),
    );
    const started = await new CloudflareBotcCommandRuntime(storage, dependencies).execute("p1", start);
    const original = started.snapshot.game!;
    expect(original.gameId).toBe("game-1");
    expect(original.initialSetup).toEqual({
      config: { scriptId: "trouble-brewing" },
      seatingPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
      assignments: original.assignments,
    });

    const reconstructed = new CloudflareBotcCommandRuntime(storage, dependencies);
    expect((await reconstructed.execute("p1", start)).replayed).toBe(true);
    await reconstructed.execute("p2", parseBotcClientCommandEnvelope(
      createClientCommandEnvelope("botc.confirmRole", {}, "confirm-2"),
    ));
    const loaded = await new CloudflareRoomSnapshotRepository<RoomSnapshot<BotcGameState>>(storage).load();
    const restored = restoreRoomSnapshot(loaded!);
    expect(restored.room.game).toMatchObject({
      schemaVersion: 1,
      gameId: original.gameId,
      initialSetup: original.initialSetup,
      confirmedRolePlayerIds: ["p2"],
    });
    expect(generatedIds).toBe(1);

    // A fresh game in the same room identity must obtain another game ID.
    await repository.save(botcLobbySnapshot());
    const next = await new CloudflareBotcCommandRuntime(storage, dependencies).execute("p1", start);
    expect(next.snapshot.game?.gameId).toBe("game-2");
  });

  it("rejects unsupported BotC archives without inventing opening facts or rewriting storage", async () => {
    const storage = new MemoryStorage();
    const lobby = botcLobbySnapshot();
    const game = new BotcGameModule().createGame({
      playerIds: lobby.membership.map(player => player.id),
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "virgin" },
        { playerId: "p2", actualRoleId: "slayer" },
        { playerId: "p3", actualRoleId: "soldier" },
        { playerId: "p4", actualRoleId: "scarlet_woman" },
        { playerId: "p5", actualRoleId: "imp" },
      ],
    }, { random: { randomInt: () => 0, randomId: () => "persisted-game" } });
    const { schemaVersion, gameId, initialSetup, ...legacy } = game;
    const repository = new CloudflareRoomSnapshotRepository(storage);
    for (const unsupported of [legacy, { ...game, schemaVersion: 99 }, { ...game, initialSetup: undefined }]) {
      const snapshot = { ...lobby, game: unsupported };
      // Seed the exact pre-upgrade bytes without passing the new write guard.
      await storage.put("room:snapshot:v1", snapshot);
      await expect(repository.load()).rejects.toThrow(/Unsupported BotC|Invalid BotC/);
      await expect(repository.save(snapshot)).rejects.toThrow(/Unsupported BotC|Invalid BotC/);
      expect(await storage.get("room:snapshot:v1")).toEqual(snapshot);
    }
  });

  it("persists only the authoritative RoomSnapshot shape", async () => {
    const storage = new MemoryStorage();
    const repository = new CloudflareRoomSnapshotRepository(storage);
    const snapshot = authoritativeSnapshot();

    await repository.save(snapshot);
    const loaded = await repository.load();

    expect(loaded).toEqual(snapshot);
    expect(JSON.stringify(loaded)).not.toContain("socket-ephemeral");
    expect(JSON.stringify(loaded)).not.toContain("connected");
  });

  it("restores revision, game, rule state, interaction, and receipts after object reconstruction", async () => {
    const storage = new MemoryStorage();
    const firstRepository = new CloudflareRoomSnapshotRepository(storage);
    await firstRepository.save(authoritativeSnapshot());

    const reconstructedRepository = new CloudflareRoomSnapshotRepository(storage);
    const loaded = await reconstructedRepository.load();
    expect(loaded).toBeDefined();

    const restored = restoreRoomSnapshot(loaded!);
    expect(restored.revision).toBe(7);
    expect(restored.room.game).toEqual({ phase: "night_werewolf", actionId: "a-1" });
    expect(restored.ruleState).toEqual({ witchAntidoteUsed: false });
    expect(restored.pendingInteraction).toEqual({
      kind: "choose_target",
      actorPlayerIds: ["p1"],
    });
    expect(restored.commandReceipts).toEqual([
      { commandId: "player:p1:c-1", result: { kind: "broadcast" } },
    ]);
  });

  it("serves persisted snapshots through a reconstructed Durable Object", async () => {
    const storage = new MemoryStorage();
    const firstObject = new GameRoomDurableObject({
      id: { toString: () => "object-123" },
      storage,
    });
    const snapshot = authoritativeSnapshot();

    const save = await firstObject.fetch(new Request("https://room.internal/snapshot", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    }));
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual({ ok: true, revision: 7 });

    const reconstructedObject = new GameRoomDurableObject({
      id: { toString: () => "object-123" },
      storage,
    });
    const read = await reconstructedObject.fetch(
      new Request("https://room.internal/snapshot"),
    );

    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(snapshot);
  });
});
