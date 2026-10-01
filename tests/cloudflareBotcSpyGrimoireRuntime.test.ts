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
  random: { randomInt: () => 0, randomId: () => "unused" },
};
const moderator: GameCommandContext = { isModerator: true, now: 1 };
const player = (playerId: string): GameCommandContext => ({
  playerId,
  isModerator: false,
  now: 1,
});

function activePoisonerBeforeSpy(): BotcGameState {
  const module = new BotcGameModule();
  const ids = Array.from({ length: 10 }, (_, index) => `p${index + 1}`);
  const game = module.createGame(
    {
      playerIds: ids,
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "poisoner" },
        { playerId: "p2", actualRoleId: "spy" },
        { playerId: "p3", actualRoleId: "imp" },
        { playerId: "p4", actualRoleId: "washerwoman" },
        { playerId: "p5", actualRoleId: "librarian" },
        { playerId: "p6", actualRoleId: "investigator" },
        { playerId: "p7", actualRoleId: "chef" },
        { playerId: "p8", actualRoleId: "empath" },
        { playerId: "p9", actualRoleId: "fortune_teller" },
        { playerId: "p10", actualRoleId: "monk" },
      ],
    },
    dependencies,
  );
  for (const id of ids) {
    module.handleCommand(game, player(id), { type: "confirmRole" }, dependencies);
  }
  module.handleCommand(game, moderator, { type: "beginFirstNight" }, dependencies);
  module.handleCommand(game, moderator, { type: "completeNightStep" }, dependencies);
  module.handleCommand(game, moderator, { type: "completeNightStep" }, dependencies);
  return game;
}

describe("PV-3B4 Cloudflare Spy Grimoire runtime", () => {
  it("auto-commits Spy Grimoire after Poisoner choice and keeps it private/idempotent", async () => {
    const storage = new MemoryStorage();
    const game = activePoisonerBeforeSpy();
    const ids = Array.from({ length: 10 }, (_, index) => `p${index + 1}`);
    const players = ids.map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      seat: index + 1,
      isHost: id === "p1",
      ready: true,
      resumeTokenHash: String(index + 1).repeat(64),
    }));
    await new CloudflareRoomSnapshotRepository(storage).save(
      createRoomSnapshot<BotcGameState, BotcGameConfig, (typeof players)[number]>({
        id: "9753",
        gameType: "botc",
        players,
        createdAt: 1,
        updatedAt: 1,
        gameModerator: { mode: "automatic" as const },
        gameConfig: { scriptId: "trouble-brewing" as const },
        game,
      }, { revision: 12 }),
    );

    const runtime = new CloudflareBotcCommandRuntime(storage, {
      isPlayerConnected: () => true,
      environment: { random: dependencies.random, now: () => 2 },
    });
    const command = parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.submitNightChoice",
        { playerIds: ["p2"] },
        "poison-spy-1",
      ),
    );

    const execution = await runtime.execute("p1", command);
    expect(execution).toMatchObject({
      replayed: false,
      revision: 13,
      outcome: {
        kind: "nightChoiceCommitted",
        completedStepId: "role:poisoner",
        nextStepId: "role:spy",
      },
      snapshot: {
        game: {
          poisonedPlayerId: "p2",
          informationHistory: [
            {
              stepId: "role:spy",
              recipientPlayerId: "p2",
              acknowledged: false,
              result: {
                kind: "spy_grimoire",
                reliability: "poisoned",
                semanticTruth: "true",
              },
            },
          ],
        },
      },
    });

    const spyEnvelope = createGamePlayerStateEnvelope(execution.snapshot, "p2");
    expect(spyEnvelope).toMatchObject({
      payload: {
        mode: "night_wake",
        nightStep: { id: "role:spy" },
        privateInformation: {
          kind: "spy_grimoire",
          abilityRoleId: "spy",
        },
      },
    });
    expect(JSON.stringify(spyEnvelope)).not.toContain('"reliability"');
    expect(JSON.stringify(spyEnvelope)).not.toContain('"semanticTruth"');

    const hostRoom = createGameRoomStateEnvelope(execution.snapshot, "p1", () => true);
    expect(JSON.stringify(hostRoom)).not.toContain("spy_grimoire");

    const replay = await runtime.execute("p1", command);
    expect(replay).toMatchObject({
      replayed: true,
      revision: 13,
      outcome: execution.outcome,
    });
  });
});
