import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
} from "../src/core/game/GameModule.js";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import {
  BotcGameModule,
  type BotcGameConfig,
  type BotcGameState,
} from "../src/games/botc/BotcGameModule.js";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { parseBotcClientCommandEnvelope } from "../src/protocol/client/BotcClientProtocol.js";
import { CloudflareBotcCommandRuntime } from "../src/runtime/cloudflare/CloudflareBotcCommandRuntime.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "../src/runtime/cloudflare/CloudflareRoomSnapshotRepository.js";
import {
  createGamePlayerStateEnvelope,
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

function roomPlayers(includeStoryteller = false) {
  const ids = includeStoryteller
    ? ["p1", "p2", "p3", "p4", "p5", "p6", "st"]
    : ["p1", "p2", "p3", "p4", "p5", "p6"];
  return ids.map((id, index) => ({
    id,
    name: id === "st" ? "Storyteller" : `Player ${index + 1}`,
    seat: index + 1,
    isHost: id === "p1",
    ready: true,
    resumeTokenHash: String(index + 1).repeat(64),
  }));
}

async function seedRoom(
  storage: MemoryStorage,
  mode:
    | { mode: "automatic" }
    | { mode: "human"; playerId: string },
): Promise<void> {
  const game = activePoisonerGame();
  const players = roomPlayers(mode.mode === "human");
  const room = {
    id: "2468",
    gameType: "botc",
    players,
    createdAt: 1,
    updatedAt: 1,
    gameModerator: mode,
    gameConfig: { scriptId: "trouble-brewing" as const },
    game,
  };
  const snapshot = createRoomSnapshot<
    BotcGameState,
    BotcGameConfig,
    (typeof players)[number]
  >(room, { revision: 9 });
  await new CloudflareRoomSnapshotRepository(storage).save(snapshot);
}

function runtime(storage: MemoryStorage): CloudflareBotcCommandRuntime {
  return new CloudflareBotcCommandRuntime(storage, {
    isPlayerConnected: () => true,
    environment: {
      random: dependencies.random,
      now: () => 2,
    },
  });
}

function command(
  type:
    | "botc.submitNightChoice"
    | "botc.commitNightInformation"
    | "botc.acknowledgeNightInformation",
  payload: Record<string, unknown>,
  commandId: string,
) {
  return parseBotcClientCommandEnvelope(
    createClientCommandEnvelope(type, payload, commandId),
  );
}

describe("PV-3B2A Cloudflare Washerwoman information runtime", () => {
  it("auto-commits information in the same authoritative mutation, keeps it private, and replays acknowledgement idempotently", async () => {
    const storage = new MemoryStorage();
    await seedRoom(storage, { mode: "automatic" });
    const commands = runtime(storage);

    const poison = await commands.execute(
      "p1",
      command(
        "botc.submitNightChoice",
        { playerIds: ["p4"] },
        "poison-washerwoman",
      ),
    );

    expect(poison).toMatchObject({
      replayed: false,
      revision: 10,
      outcome: {
        kind: "nightChoiceCommitted",
        completedStepId: "role:poisoner",
        nextStepId: "role:washerwoman",
      },
      snapshot: {
        game: {
          poisonedPlayerId: "p4",
          informationHistory: [
            {
              stepId: "role:washerwoman",
              recipientPlayerId: "p4",
              acknowledged: false,
              selectionSource: "baseline_v1",
              result: {
                reliability: "poisoned",
                semanticTruth: "true",
              },
            },
          ],
        },
      },
    });

    const recipientEnvelope = createGamePlayerStateEnvelope(
      poison.snapshot,
      "p4",
    );
    expect(recipientEnvelope).toMatchObject({
      payload: {
        mode: "night_wake",
        nightStep: { id: "role:washerwoman" },
        privateInformation: {
          kind: "pair",
          abilityRoleId: "washerwoman",
          learnedRole: { id: expect.any(String) },
          shownPlayerIds: [expect.any(String), expect.any(String)],
        },
      },
    });
    expect(JSON.stringify(recipientEnvelope)).not.toContain('"reliability"');
    expect(JSON.stringify(recipientEnvelope)).not.toContain('"semanticTruth"');
    expect(JSON.stringify(recipientEnvelope)).not.toContain('"poisoned"');

    const otherPlayerEnvelope = createGamePlayerStateEnvelope(
      poison.snapshot,
      "p5",
    );
    expect(JSON.stringify(otherPlayerEnvelope)).not.toContain(
      "privateInformation",
    );

    const publicEnvelope = createGameRoomStateEnvelope(
      poison.snapshot,
      "p2",
      () => true,
    );
    expect(JSON.stringify(publicEnvelope)).not.toContain("informationHistory");
    expect(JSON.stringify(publicEnvelope)).not.toContain("privateInformation");
    expect(JSON.stringify(publicEnvelope)).not.toContain("poisonedPlayerId");

    const ackCommand = command(
      "botc.acknowledgeNightInformation",
      {},
      "washerwoman-ack-1",
    );
    const acknowledged = await commands.execute("p4", ackCommand);
    expect(acknowledged).toMatchObject({
      replayed: false,
      revision: 11,
      outcome: {
        kind: "nightInformationAcknowledged",
        completedStepId: "role:washerwoman",
        nextStepId: "role:chef",
        nightComplete: false,
      },
      snapshot: {
        game: {
          informationHistory: [
            {
              acknowledged: true,
            },
          ],
        },
      },
    });

    const replay = await commands.execute("p4", ackCommand);
    expect(replay).toMatchObject({
      replayed: true,
      revision: 11,
      outcome: acknowledged.outcome,
    });
    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(11);
    expect(
      (persisted?.game as BotcGameState | undefined)?.informationHistory,
    ).toHaveLength(1);
  });

  it("preserves Human Storyteller authority: owner cannot commit and explicit Storyteller commit does not advance the night cursor", async () => {
    const storage = new MemoryStorage();
    await seedRoom(storage, { mode: "human", playerId: "st" });
    const commands = runtime(storage);

    const poison = await commands.execute(
      "p1",
      command(
        "botc.submitNightChoice",
        { playerIds: ["p4"] },
        "human-poison-washerwoman",
      ),
    );

    expect(
      (poison.snapshot.game as BotcGameState).informationHistory,
    ).toEqual([]);

    const storytellerProjection = createGameRoomStateEnvelope(
      poison.snapshot,
      "st",
      () => true,
    );
    expect(storytellerProjection).toMatchObject({
      payload: {
        viewer: { isGameModerator: true },
        game: {
          nightStep: { id: "role:washerwoman" },
          informationDecision: {
            stepId: "role:washerwoman",
            recipientPlayerId: "p4",
            roleId: "washerwoman",
            committed: false,
          },
        },
      },
    });

    const commitCommand = command(
      "botc.commitNightInformation",
      {},
      "human-washerwoman-commit",
    );
    await expect(commands.execute("p1", commitCommand)).rejects.toThrow(
      "game command requires moderator authority",
    );

    const committed = await commands.execute("st", commitCommand);
    expect(committed).toMatchObject({
      replayed: false,
      revision: 11,
      outcome: {
        kind: "nightInformationCommitted",
        stepId: "role:washerwoman",
        recipientPlayerId: "p4",
      },
      snapshot: {
        game: {
          phase: "first_night",
          informationHistory: [
            {
              acknowledged: false,
            },
          ],
        },
      },
    });
    expect(
      (committed.snapshot.game as BotcGameState).nightStepIndex,
    ).toBe((poison.snapshot.game as BotcGameState).nightStepIndex);
  });
});
