import { describe, expect, it } from "vitest";
import {
  createRoomSnapshot,
  type RoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import {
  configFromPlayerCount,
  type GameConfig,
  type GameState,
} from "../src/games/werewolf/WerewolfDomainFacade.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import type { InteractionTimeoutClientCommandEnvelope } from "../src/protocol/client/ClientInteractionTimeoutProtocol.js";
import type { RoomRecoveryClientCommandEnvelope } from "../src/protocol/client/ClientRecoveryProtocol.js";
import type { WerewolfLifecycleClientCommandEnvelope } from "../src/protocol/client/werewolf/WerewolfLifecycleClientProtocol.js";
import { CloudflareInteractionTimeoutRuntime } from "../src/runtime/cloudflare/CloudflareInteractionTimeoutRuntime.js";
import { CloudflareRoomRecoveryRuntime } from "../src/runtime/cloudflare/CloudflareRoomRecoveryRuntime.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import { CloudflareWerewolfLifecycleRuntime } from "../src/runtime/cloudflare/CloudflareWerewolfLifecycleRuntime.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  alarmAt: number | null = null;

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

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async setAlarm(value: number): Promise<void> {
    this.alarmAt = value;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

function humanModeratorLobby(): RoomSnapshot<GameState, GameConfig> {
  const config = configFromPlayerCount(5);
  return createRoomSnapshot(
    {
      id: "2468",
      gameType: "werewolf",
      players: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id, index) => ({
        id,
        name: id === "p1" ? "Owner" : id === "p2" ? "Moderator" : `Player ${index + 1}`,
        seat: index + 1,
        isHost: id === "p1",
        resumeTokenHash: String(index + 1).repeat(64),
      })),
      createdAt: 1,
      updatedAt: 2,
      gameModerator: { mode: "human", playerId: "p2" },
      gameConfig: config,
    },
    { revision: 3 },
  );
}

function lifecycleCommand(): WerewolfLifecycleClientCommandEnvelope {
  return createClientCommandEnvelope(
    "werewolf.startGame",
    {},
    "human-moderator-start",
  );
}

describe("MG0C Room Owner / Game Moderator authority split", () => {
  it("lets the human moderator start gameplay, excludes them from roles, and denies owner game control", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(humanModeratorLobby());

    let nextId = 0;
    const runtime = new CloudflareWerewolfLifecycleRuntime(storage, {
      isPlayerConnected: () => true,
      environment: {
        random: {
          randomInt(maxExclusive) {
            return maxExclusive - 1;
          },
          randomId() {
            nextId += 1;
            return `action-${nextId}`;
          },
        },
        now: () => 10,
      },
    });

    await expect(runtime.execute("p1", lifecycleCommand())).rejects.toThrow(
      "game command requires moderator authority",
    );

    const execution = await runtime.execute("p2", lifecycleCommand());
    expect(execution.replayed).toBe(false);
    expect(execution.snapshot.game).toBeDefined();
    expect(Object.keys(execution.snapshot.game!.roles)).toHaveLength(5);
    expect(execution.snapshot.game!.roles).not.toHaveProperty("p2");
    expect(execution.snapshot.game!.roles).toHaveProperty("p1");
  });

  it("keeps timeout configuration with the moderator while recovery remains owner-only", async () => {
    const storage = new MemoryStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(humanModeratorLobby());

    const timeout = new CloudflareInteractionTimeoutRuntime(storage, () => 1_000);
    const setTimeoutCommand = createClientCommandEnvelope(
      "interactionTimeout.setConfig",
      { timeoutSeconds: 20 },
      "moderator-timeout",
    ) as InteractionTimeoutClientCommandEnvelope;

    await expect(timeout.executeCommand("p1", setTimeoutCommand)).rejects.toThrow(
      "只有主持人可以修改超时设置",
    );
    await expect(timeout.executeCommand("p2", setTimeoutCommand)).resolves.toMatchObject({
      result: { ok: true, kind: "config", timeoutSeconds: 20 },
      replayed: false,
    });

    let nextId = 0;
    const lifecycle = new CloudflareWerewolfLifecycleRuntime(storage, {
      isPlayerConnected: () => true,
      environment: {
        random: {
          randomInt(maxExclusive) {
            return maxExclusive - 1;
          },
          randomId() {
            nextId += 1;
            return `action-${nextId}`;
          },
        },
        now: () => 2_000,
      },
    });
    await lifecycle.execute("p2", lifecycleCommand());

    const recovery = new CloudflareRoomRecoveryRuntime(storage, {
      isPlayerConnected: () => true,
      now: () => 3_000,
    });
    const abort = createClientCommandEnvelope(
      "recovery.abortToLobby",
      {},
      "owner-recovery",
    ) as RoomRecoveryClientCommandEnvelope;

    await expect(recovery.execute("p2", abort)).rejects.toThrow(
      "只有房主可以中断当前游戏",
    );
    await expect(recovery.execute("p1", abort)).resolves.toMatchObject({
      replayed: false,
      outcome: { kind: "abortedToLobby" },
    });
  });
});
