import { describe, expect, it } from "vitest";
import type { GameCommandContext, GameModuleDependencies } from "../src/core/game/GameModule.js";
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

const moderator: GameCommandContext = { isModerator: true, now: 1 };
const player = (playerId: string): GameCommandContext => ({
  playerId,
  isModerator: false,
  now: 1,
});

function activeFortuneTellerGame(): BotcGameState {
  const module = new BotcGameModule();
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const game = module.createGame(
    {
      playerIds,
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "fortune_teller" },
        { playerId: "p2", actualRoleId: "chef" },
        { playerId: "p3", actualRoleId: "empath" },
        { playerId: "p4", actualRoleId: "poisoner" },
        { playerId: "p5", actualRoleId: "imp" },
      ],
    },
    dependencies,
  );
  for (const playerId of playerIds) {
    module.handleCommand(game, player(playerId), { type: "confirmRole" }, dependencies);
  }
  module.handleCommand(
    game,
    moderator,
    { type: "setRedHerring", playerId: "p3" },
    dependencies,
  );
  module.handleCommand(game, moderator, { type: "beginFirstNight" }, dependencies);
  module.handleCommand(
    game,
    player("p4"),
    { type: "submitNightChoice", playerIds: ["p2"] },
    dependencies,
  );
  for (const recipient of ["p2", "p3"]) {
    module.handleCommand(
      game,
      moderator,
      { type: "commitNightInformation" },
      dependencies,
    );
    module.handleCommand(
      game,
      player(recipient),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
  }
  return game;
}

describe("PV-3B3 Cloudflare Fortune Teller runtime", () => {
  it("auto-commits Fortune Teller information in the same authoritative mutation and replays idempotently", async () => {
    const storage = new MemoryStorage();
    const game = activeFortuneTellerGame();
    const players = ["p1", "p2", "p3", "p4", "p5"].map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      seat: index + 1,
      isHost: id === "p1",
      ready: true,
      resumeTokenHash: String(index + 1).repeat(64),
    }));
    const room = {
      id: "3579",
      gameType: "botc",
      players,
      createdAt: 1,
      updatedAt: 1,
      gameModerator: { mode: "automatic" as const },
      gameConfig: { scriptId: "trouble-brewing" as const },
      game,
    };
    const snapshot = createRoomSnapshot<
      BotcGameState,
      BotcGameConfig,
      (typeof players)[number]
    >(room, { revision: 20 });
    await new CloudflareRoomSnapshotRepository(storage).save(snapshot);

    const runtime = new CloudflareBotcCommandRuntime(storage, {
      isPlayerConnected: () => true,
      environment: {
        random: dependencies.random,
        now: () => 2,
      },
    });
    const manualRedHerring = parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.setRedHerring",
        { playerId: "p2" },
        "automatic-red-herring-forbidden",
      ),
    );
    await expect(runtime.execute("p1", manualRedHerring)).rejects.toThrow(
      "Manual Red Herring setup requires Human Storyteller mode",
    );

    const command = parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.submitNightChoice",
        { playerIds: ["p2", "p3"] },
        "fortune-choice-1",
      ),
    );

    const execution = await runtime.execute("p1", command);
    expect(execution).toMatchObject({
      replayed: false,
      revision: 21,
      outcome: {
        kind: "nightChoiceRecorded",
        stepId: "role:fortune_teller",
        selectedPlayerIds: ["p2", "p3"],
      },
      snapshot: {
        game: {
          fortuneTellerChoice: {
            nightNumber: 1,
            playerIds: ["p2", "p3"],
          },
          informationHistory: [
            {},
            {},
            {
              stepId: "role:fortune_teller",
              recipientPlayerId: "p1",
              acknowledged: false,
              selectionSource: "baseline_v1",
              result: {
                kind: "boolean",
                abilityRoleId: "fortune_teller",
                value: true,
                reliability: "reliable",
                semanticTruth: "true",
                selectedCandidateId: "fortune_teller:boolean:yes",
              },
            },
          ],
        },
      },
    });

    const playerEnvelope = createGamePlayerStateEnvelope(execution.snapshot, "p1");
    expect(playerEnvelope).toMatchObject({
      payload: {
        mode: "night_wake",
        nightStep: { id: "role:fortune_teller" },
        privateInformation: {
          kind: "boolean",
          abilityRoleId: "fortune_teller",
          value: true,
        },
      },
    });
    expect(JSON.stringify(playerEnvelope)).not.toContain("redHerring");
    expect(JSON.stringify(playerEnvelope)).not.toContain("selectedResolution");
    expect(JSON.stringify(playerEnvelope)).not.toContain("reliability");

    const automaticHostRoomEnvelope = createGameRoomStateEnvelope(
      execution.snapshot,
      "p1",
      () => true,
    );
    expect(JSON.stringify(automaticHostRoomEnvelope)).not.toContain("redHerring");

    const replay = await runtime.execute("p1", command);
    expect(replay).toMatchObject({
      replayed: true,
      revision: 21,
      outcome: execution.outcome,
    });

    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(
      (persisted?.game as BotcGameState | undefined)?.informationHistory,
    ).toHaveLength(3);
  });

  it("allows only the Human Storyteller to commit Red Herring and keeps it private from players", async () => {
    const storage = new MemoryStorage();
    const module = new BotcGameModule();
    const participantIds = ["p1", "p2", "p3", "p4", "p5"];
    const game = module.createGame(
      {
        playerIds: participantIds,
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "fortune_teller" },
          { playerId: "p2", actualRoleId: "chef" },
          { playerId: "p3", actualRoleId: "empath" },
          { playerId: "p4", actualRoleId: "poisoner" },
          { playerId: "p5", actualRoleId: "imp" },
        ],
      },
      dependencies,
    );
    const players = [...participantIds, "st"].map((id, index) => ({
      id,
      name: id === "st" ? "Storyteller" : `Player ${index + 1}`,
      seat: index + 1,
      isHost: id === "p1",
      ready: true,
      resumeTokenHash: String(index + 1).repeat(64),
    }));
    const room = {
      id: "4680",
      gameType: "botc",
      players,
      createdAt: 1,
      updatedAt: 1,
      gameModerator: { mode: "human" as const, playerId: "st" },
      gameConfig: { scriptId: "trouble-brewing" as const },
      game,
    };
    await new CloudflareRoomSnapshotRepository(storage).save(
      createRoomSnapshot<
        BotcGameState,
        BotcGameConfig,
        (typeof players)[number]
      >(room, { revision: 30 }),
    );

    const runtime = new CloudflareBotcCommandRuntime(storage, {
      isPlayerConnected: () => true,
      environment: {
        random: dependencies.random,
        now: () => 2,
      },
    });
    const command = parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.setRedHerring",
        { playerId: "p3" },
        "red-herring-human-1",
      ),
    );

    await expect(runtime.execute("p1", command)).rejects.toThrow(
      "game command requires moderator authority",
    );

    const execution = await runtime.execute("st", command);
    expect(execution).toMatchObject({
      replayed: false,
      revision: 31,
      outcome: {
        kind: "redHerringCommitted",
        playerId: "p3",
        source: "moderator",
      },
      snapshot: {
        game: {
          redHerring: {
            playerId: "p3",
            selectionSource: "moderator",
          },
        },
      },
    });

    const playerEnvelope = createGamePlayerStateEnvelope(execution.snapshot, "p1");
    expect(JSON.stringify(playerEnvelope)).not.toContain("redHerring");

    const storytellerEnvelope = createGamePlayerStateEnvelope(execution.snapshot, "st");
    expect(storytellerEnvelope).toMatchObject({
      payload: {
        mode: "spectator",
      },
    });
    const storytellerRoomEnvelope = createGameRoomStateEnvelope(
      execution.snapshot,
      "st",
      () => true,
    );
    expect(JSON.stringify(storytellerRoomEnvelope)).toContain("redHerring");
  });
});
