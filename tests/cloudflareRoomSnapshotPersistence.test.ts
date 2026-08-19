import { describe, expect, it } from "vitest";
import {
  createRoomSnapshot,
  restoreRoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
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

describe("D3 Durable Object snapshot persistence", () => {
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
