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
import { botcInformationHistory } from "../src/games/botc/BotcNightInformationRuntime.js";

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

let generatedIdentity = 0;
const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => `information-${++generatedIdentity}`,
  },
};

function playerContext(playerId: string): GameCommandContext {
  return { playerId, isModerator: false, now: 1 };
}

type PairInformationRoleId = "washerwoman" | "librarian" | "investigator";

function activePoisonerGame(
  informationRoleId: PairInformationRoleId = "washerwoman",
): BotcGameState {
  const module = new BotcGameModule();
  const playerIds =
    informationRoleId === "washerwoman"
      ? ["p1", "p2", "p3", "p4", "p5", "p6"]
      : ["p1", "p2", "p3", "p4", "p5"];
  const assignments =
    informationRoleId === "washerwoman"
      ? [
          { playerId: "p1", actualRoleId: "poisoner" as const },
          { playerId: "p2", actualRoleId: "imp" as const },
          { playerId: "p3", actualRoleId: "butler" as const },
          { playerId: "p4", actualRoleId: "washerwoman" as const },
          { playerId: "p5", actualRoleId: "chef" as const },
          { playerId: "p6", actualRoleId: "empath" as const },
        ]
      : [
          { playerId: "p1", actualRoleId: "poisoner" as const },
          { playerId: "p2", actualRoleId: "imp" as const },
          { playerId: "p3", actualRoleId: "chef" as const },
          { playerId: "p4", actualRoleId: informationRoleId },
          { playerId: "p5", actualRoleId: "empath" as const },
        ];
  const game = module.createGame(
    {
      playerIds,
      config: { scriptId: "trouble-brewing" },
      assignments,
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

function roomPlayers(
  includeStoryteller = false,
  playerCount = 6,
) {
  const playerIds = Array.from(
    { length: playerCount },
    (_, index) => `p${index + 1}`,
  );
  const ids = includeStoryteller ? [...playerIds, "st"] : playerIds;
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
  informationRoleId: PairInformationRoleId = "washerwoman",
): Promise<void> {
  const game = activePoisonerGame(informationRoleId);
  const playerCount = informationRoleId === "washerwoman" ? 6 : 5;
  const players = roomPlayers(mode.mode === "human", playerCount);
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

describe("PV-3B2 pair-information Cloudflare runtime", () => {
  it("commits ordered facts and immutable observations atomically, fences stale input, and preserves progress on retry", async () => {
    class FailingStorage extends MemoryStorage {
      fail = false;
      override async put<T>(key: string, value: T): Promise<void> {
        if (this.fail) throw new Error("injected write failure");
        await super.put(key, value);
      }
    }
    const storage = new FailingStorage();
    await seedRoom(storage, { mode: "automatic" });
    const repository = new CloudflareRoomSnapshotRepository(storage);
    const before = await repository.load();
    const oldActionId = (before!.game as BotcGameState).interactionId;
    const poison = command("botc.submitNightChoice", { playerIds: ["p4"], actionId: oldActionId }, "s2-poison");
    storage.fail = true;
    await expect(runtime(storage).execute("p1", poison)).rejects.toThrow("injected write failure");
    expect(await repository.load()).toEqual(before);
    storage.fail = false;
    const committed = await runtime(storage).execute("p1", poison);
    const state = committed.snapshot.game as BotcGameState;
    const observation = structuredClone(state.history.observations[0]!);
    const sequence = [...state.history.actions, ...state.history.observations, ...state.history.notices]
      .map(item => item.sequence!).sort((left, right) => left - right);
    expect(sequence).toEqual(Array.from({ length: sequence.length }, (_, index) => index + 1));
    expect(state.history.actions.slice(-2).map(item => item.kind === "command" && item.command.type))
      .toEqual(["submitNightChoice", "commitNightInformation"]);
    expect(state.history.actions.at(-2)).toMatchObject({ effects: { poisonedPlayerId: "p4" } });
    expect((await runtime(storage).execute("p1", poison)).replayed).toBe(true);
    await expect(runtime(storage).execute("p1", command("botc.submitNightChoice",
      { playerIds: ["p5"], actionId: oldActionId }, "s2-stale"))).rejects.toThrow("Stale BotC interaction");
    const ack = await runtime(storage).execute("p4", command("botc.acknowledgeNightInformation",
      { actionId: state.interactionId }, "s2-ack"));
    const acknowledged = ack.snapshot.game as BotcGameState;
    expect(acknowledged.history.observations[0]).toEqual(observation);
    expect(acknowledged.history.acknowledgedObservationIds).toContain(observation.recordId);
  });

  it("upgrades S1 information with an explicit unknown-order boundary without rewriting storage on read", async () => {
    const storage = new MemoryStorage();
    await seedRoom(storage, { mode: "automatic" });
    const committed = await runtime(storage).execute("p1", command("botc.submitNightChoice", { playerIds: ["p4"] }, "s2-migrate"));
    const state = committed.snapshot.game as BotcGameState;
    const { history, interactionId, ...facts } = state;
    const legacy = { ...committed.snapshot, game: { ...facts, schemaVersion: 1,
      informationHistory: botcInformationHistory(state) } };
    await storage.put("room:snapshot:v1", legacy);
    const loaded = await new CloudflareRoomSnapshotRepository(storage).load();
    const upgraded = loaded!.game as BotcGameState;
    expect(upgraded.gameId).toBe(state.gameId);
    expect(upgraded.initialSetup).toEqual(state.initialSetup);
    expect(upgraded.history).toMatchObject({ coverage: "from_upgrade", nextSequence: 1, actions: [] });
    expect(upgraded.history.observations[0]).toMatchObject({ sequence: null, result: history.observations[0]!.result });
    expect(upgraded).not.toHaveProperty("informationHistory");
    expect(await storage.get("room:snapshot:v1")).toEqual(legacy);
    const acknowledged = await runtime(storage).execute("p4", command("botc.acknowledgeNightInformation",
      { actionId: upgraded.interactionId }, "s2-migrated-ack"));
    expect((acknowledged.snapshot.game as BotcGameState).history.actions[0]).toMatchObject({ sequence: 1 });
  });

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
          history: { observations: [
            {
              stepId: "role:washerwoman",
              recipientPlayerId: "p4",
              selectionSource: "baseline_v1",
              result: {
                reliability: "poisoned",
                semanticTruth: "true",
              },
            },
          ] },
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
    expect(JSON.stringify(publicEnvelope)).not.toContain("history");
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
          history: { acknowledgedObservationIds: [expect.any(String)], observations: [
            {
              stepId: "role:washerwoman",
              recipientPlayerId: "p4",
            },
            {
              stepId: "role:chef",
              recipientPlayerId: "p5",
              selectionSource: "baseline_v1",
              result: {
                kind: "number",
                abilityRoleId: "chef",
                value: 1,
                reliability: "reliable",
                semanticTruth: "true",
                selectedCandidateId: "chef:number:1",
              },
            },
          ] },
        },
      },
    });

    const chefEnvelope = createGamePlayerStateEnvelope(
      acknowledged.snapshot,
      "p5",
    );
    expect(chefEnvelope).toMatchObject({
      payload: {
        mode: "night_wake",
        nightStep: { id: "role:chef" },
        privateInformation: {
          kind: "number",
          abilityRoleId: "chef",
          value: 1,
        },
      },
    });
    expect(JSON.stringify(chefEnvelope)).not.toContain('"reliability"');
    expect(JSON.stringify(chefEnvelope)).not.toContain('"selectedResolution"');
    expect(
      JSON.stringify(createGamePlayerStateEnvelope(acknowledged.snapshot, "p6")),
    ).not.toContain("privateInformation");

    const replay = await commands.execute("p4", ackCommand);
    expect(replay).toMatchObject({
      replayed: true,
      revision: 11,
      outcome: acknowledged.outcome,
    });
    const persisted = await new CloudflareRoomSnapshotRepository(storage).load();
    expect(persisted?.revision).toBe(11);
    expect(
      (persisted?.game as BotcGameState | undefined)?.history.observations,
    ).toHaveLength(2);
  });

  it("auto-commits typed Librarian zero information and keeps authoritative truth metadata out of PlayerView", async () => {
    const storage = new MemoryStorage();
    await seedRoom(storage, { mode: "automatic" }, "librarian");
    const commands = runtime(storage);

    const poison = await commands.execute(
      "p1",
      command(
        "botc.submitNightChoice",
        { playerIds: ["p3"] },
        "poison-before-librarian",
      ),
    );

    expect(poison).toMatchObject({
      replayed: false,
      revision: 10,
      outcome: {
        kind: "nightChoiceCommitted",
        completedStepId: "role:poisoner",
        nextStepId: "role:librarian",
      },
      snapshot: {
        game: {
          history: { observations: [
            {
              stepId: "role:librarian",
              recipientPlayerId: "p4",
              selectionSource: "baseline_v1",
              result: {
                kind: "no_characters",
                abilityRoleId: "librarian",
                noCharacterCategory: "outsider",
                reliability: "reliable",
                semanticTruth: "true",
                selectedCandidateId: "librarian:no-outsiders",
              },
            },
          ] },
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
        nightStep: { id: "role:librarian" },
        privateInformation: {
          kind: "no_characters",
          abilityRoleId: "librarian",
          noCharacterCategory: "outsider",
        },
      },
    });
    expect(JSON.stringify(recipientEnvelope)).not.toContain('"semanticTruth"');
    expect(JSON.stringify(recipientEnvelope)).not.toContain('"selectedResolution"');
    expect(
      JSON.stringify(createGamePlayerStateEnvelope(poison.snapshot, "p5")),
    ).not.toContain("privateInformation");
    expect(
      JSON.stringify(
        createGameRoomStateEnvelope(poison.snapshot, "p2", () => true),
      ),
    ).not.toContain("history");
  });

  it("preserves Human Storyteller authority for Investigator without advancing before acknowledgement", async () => {
    const storage = new MemoryStorage();
    await seedRoom(
      storage,
      { mode: "human", playerId: "st" },
      "investigator",
    );
    const commands = runtime(storage);

    const poison = await commands.execute(
      "p1",
      command(
        "botc.submitNightChoice",
        { playerIds: ["p3"] },
        "human-poison-before-investigator",
      ),
    );

    expect(
      (poison.snapshot.game as BotcGameState).history.observations,
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
          nightStep: { id: "role:investigator" },
          informationDecision: {
            stepId: "role:investigator",
            recipientPlayerId: "p4",
            roleId: "investigator",
            committed: false,
          },
        },
      },
    });

    const commitCommand = command(
      "botc.commitNightInformation",
      {},
      "human-investigator-commit",
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
        stepId: "role:investigator",
        recipientPlayerId: "p4",
      },
      snapshot: {
        game: {
          phase: "first_night",
          history: { observations: [
            {
              result: {
                kind: "pair",
                abilityRoleId: "investigator",
                learnedRoleId: "poisoner",
                semanticTruth: "true",
                selectedResolution: {
                  matchingPlayerId: "p1",
                  matchSource: "actual",
                },
              },
            },
          ] },
        },
      },
    });
    expect(
      (committed.snapshot.game as BotcGameState).nightStepIndex,
    ).toBe((poison.snapshot.game as BotcGameState).nightStepIndex);
  });
});
