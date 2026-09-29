import { describe, expect, it } from "vitest";
import {
  createRoomSnapshot,
  type RoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import {
  configFromRoleDeck,
  type GameConfig,
  type GameState,
} from "../src/domain/game.js";
import type { WerewolfInteraction } from "../src/games/werewolf/WerewolfNightPlanner.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { CloudflareInteractionTimeoutRepository } from "../src/runtime/cloudflare/CloudflareInteractionTimeoutRepository.js";
import { CloudflareInteractionTimeoutRuntime } from "../src/runtime/cloudflare/CloudflareInteractionTimeoutRuntime.js";
import { CloudflareRoomSnapshotRepository } from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";

type TimeoutSnapshot = RoomSnapshot<
  GameState,
  GameConfig,
  unknown,
  WerewolfInteraction,
  unknown
>;

class AlarmStorage {
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

  async setAlarm(scheduledTimeMs: number): Promise<void> {
    this.alarmAt = scheduledTimeMs;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

function lobbySnapshot(): TimeoutSnapshot {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
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
      createdAt: 1,
      updatedAt: 2,
      gameConfig: configFromRoleDeck(
        5,
        ["werewolf", "seer", "witch", "villager", "villager"],
      ),
    },
    { revision: 3 },
  ) as TimeoutSnapshot;
}

function wolfActionSnapshot(): TimeoutSnapshot {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const config = configFromRoleDeck(
    5,
    ["werewolf", "seer", "witch", "villager", "villager"],
  );
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
      createdAt: 1,
      updatedAt: 2,
      gameConfig: config,
      game: {
        config,
        phase: "night_werewolf" as const,
        nightNumber: 1,
        dayNumber: 0,
        roles: {
          p1: "werewolf" as const,
          p2: "seer" as const,
          p3: "witch" as const,
          p4: "villager" as const,
          p5: "villager" as const,
        },
        confirmedRolePlayerIds: [...playerIds],
        actionId: "wolf-action",
        witchUsedAntidote: false,
        witchAntidoteSpent: false,
        witchPoisonSpent: false,
        seerResultConfirmed: false,
        deaths: [],
        votes: {},
        pkCandidateIds: [],
        deadPlayerIds: [],
      },
    },
    { revision: 20 },
  ) as TimeoutSnapshot;
}

describe("W3D2 Cloudflare interaction timeout runtime", () => {
  it("persists host configuration with retry-safe command receipts", async () => {
    const storage = new AlarmStorage();
    await new CloudflareRoomSnapshotRepository(storage).save(lobbySnapshot());
    const runtime = new CloudflareInteractionTimeoutRuntime(storage, () => 1_000);

    const setCommand = createClientCommandEnvelope(
      "interactionTimeout.setConfig",
      { timeoutSeconds: 15 },
      "timeout-config-1",
    );

    expect(await runtime.executeCommand("p1", setCommand)).toEqual({
      result: {
        ok: true,
        kind: "config",
        timeoutSeconds: 15,
      },
      replayed: false,
    });
    expect(await runtime.executeCommand("p1", setCommand)).toEqual({
      result: {
        ok: true,
        kind: "config",
        timeoutSeconds: 15,
      },
      replayed: true,
    });

    await expect(runtime.executeCommand("p2", setCommand)).rejects.toThrow(
      "只有房主可以修改超时设置",
    );

    const getCommand = createClientCommandEnvelope(
      "interactionTimeout.getConfig",
      {},
      "timeout-get-1",
    );
    expect(await runtime.executeCommand("p1", getCommand)).toEqual({
      result: {
        ok: true,
        kind: "config",
        timeoutSeconds: 15,
      },
      replayed: false,
    });
  });

  it("persists an active timeout and dedupes the one-time extension", async () => {
    let now = 1_000;
    const storage = new AlarmStorage();
    const snapshot = wolfActionSnapshot();
    await new CloudflareRoomSnapshotRepository(storage).save(snapshot);
    const runtime = new CloudflareInteractionTimeoutRuntime(storage, () => now);

    const transition = await runtime.reconcile(snapshot);
    expect(transition.created).toBe(true);
    expect(transition.active).toMatchObject({
      actionId: "wolf-action",
      actorPlayerIds: ["p1"],
      deadlineAt: 31_000,
      warningAt: 23_000,
      extensionCount: 0,
    });
    expect(storage.alarmAt).toBe(23_000);

    now = 2_000;
    const extendCommand = createClientCommandEnvelope(
      "interactionTimeout.extend",
      { actionId: "wolf-action" },
      "extend-1",
    );
    const first = await runtime.executeCommand("p1", extendCommand);
    expect(first).toMatchObject({
      result: {
        ok: true,
        kind: "extended",
        deadlineAt: 61_000,
        canExtend: false,
      },
      replayed: false,
      active: {
        extensionCount: 1,
        warningAt: 53_000,
      },
    });
    expect(storage.alarmAt).toBe(53_000);

    expect(await runtime.executeCommand("p1", extendCommand)).toMatchObject({
      result: {
        ok: true,
        kind: "extended",
        deadlineAt: 61_000,
        canExtend: false,
      },
      replayed: true,
    });

    const nonActor = createClientCommandEnvelope(
      "interactionTimeout.extend",
      { actionId: "wolf-action" },
      "extend-p2",
    );
    expect(await runtime.executeCommand("p2", nonActor)).toEqual({
      result: { ok: false, message: "当前不是你的行动阶段" },
      replayed: false,
    });
  });

  it("uses one persisted alarm for warning then performs retry-safe timeout recovery", async () => {
    let now = 1_000;
    const storage = new AlarmStorage();
    const snapshot = wolfActionSnapshot();
    await new CloudflareRoomSnapshotRepository(storage).save(snapshot);
    const runtime = new CloudflareInteractionTimeoutRuntime(storage, () => now);

    const transition = await runtime.reconcile(snapshot);
    expect(transition.active?.warningAt).toBe(23_000);
    expect(transition.active?.deadlineAt).toBe(31_000);

    now = 23_000;
    const warning = await runtime.handleAlarm();
    expect(warning).toMatchObject({
      kind: "warning",
      state: {
        actionId: "wolf-action",
        warningSent: true,
      },
    });
    expect(storage.alarmAt).toBe(31_000);

    expect(await runtime.handleAlarm()).toEqual({ kind: "none" });
    expect(storage.alarmAt).toBe(31_000);

    now = 31_000;
    const expired = await runtime.handleAlarm();
    expect(expired).toMatchObject({
      kind: "recovered",
      previous: { actionId: "wolf-action" },
      snapshot: { revision: 21 },
    });
    if (expired.kind !== "recovered") return;
    expect(expired.snapshot.game?.actionId).not.toBe("wolf-action");

    const persisted = await new CloudflareRoomSnapshotRepository<TimeoutSnapshot>(
      storage,
    ).load();
    expect(persisted?.revision).toBe(21);
    expect(persisted?.game?.actionId).not.toBe("wolf-action");

    const timeout = await new CloudflareInteractionTimeoutRepository(storage).load();
    expect(timeout.active?.actionId).toBe(persisted?.game?.actionId);
    expect(storage.alarmAt).toBeGreaterThan(now);

    const revision = persisted?.revision;
    expect(await runtime.handleAlarm()).toEqual({ kind: "none" });
    expect((
      await new CloudflareRoomSnapshotRepository<TimeoutSnapshot>(storage).load()
    )?.revision).toBe(revision);
  });
});
