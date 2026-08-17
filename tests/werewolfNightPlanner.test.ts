import { describe, expect, it } from "vitest";
import type { GameModuleDependencies } from "../src/core/game/GameModule.js";
import { configFromRoleDeck, type GameState } from "../src/domain/game.js";
import { WerewolfGameModule } from "../src/games/werewolf/WerewolfGameModule.js";
import { getActiveWerewolfInteraction } from "../src/games/werewolf/WerewolfNightPlanner.js";

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    config: configFromRoleDeck(5, ["werewolf", "guard", "witch", "seer", "hunter"]),
    phase: "night_werewolf",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "werewolf",
      p2: "guard",
      p3: "witch",
      p4: "seer",
      p5: "hunter",
    },
    confirmedRolePlayerIds: [],
    actionId: "interaction-1",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
    ...overrides,
  };
}

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: maxExclusive => Math.max(0, maxExclusive - 1),
    randomId: (() => {
      let id = 1;
      return () => `action-${id++}`;
    })(),
  },
};

describe("WerewolfNightPlanner", () => {
  it("maps each actionable Werewolf phase to a platform-neutral interaction", () => {
    expect(getActiveWerewolfInteraction(state())).toMatchObject({
      id: "interaction-1",
      kind: "wolf_kill",
      actorPlayerIds: ["p1"],
      mode: "group",
      wakePolicy: { vibrate: true, audioCue: "wolf_wake" },
      completionPolicy: { type: "any_actor_submission" },
      status: "active",
    });

    expect(getActiveWerewolfInteraction(state({ phase: "night_guard" }))).toMatchObject({
      kind: "guard_protect",
      actorPlayerIds: ["p2"],
      mode: "single",
      completionPolicy: { type: "single_submission" },
    });

    expect(getActiveWerewolfInteraction(state({ phase: "night_witch" }))).toMatchObject({
      kind: "witch_action",
      actorPlayerIds: ["p3"],
    });

    expect(getActiveWerewolfInteraction(state({ phase: "night_seer" }))).toMatchObject({
      kind: "seer_check",
      actorPlayerIds: ["p4"],
      completionPolicy: { type: "explicit_confirmation" },
    });

    expect(getActiveWerewolfInteraction(state({
      phase: "day_hunter",
      deadPlayerIds: ["p5"],
    }))).toMatchObject({
      kind: "hunter_shot",
      actorPlayerIds: ["p5"],
    });
  });

  it("uses the rules actionId as a stable interactionId until the action completes", () => {
    const game = state({ phase: "night_seer", actionId: "seer-action" });
    const beforeSelection = getActiveWerewolfInteraction(game);

    const module = new WerewolfGameModule();
    module.handleCommand(
      game,
      { playerId: "p4", isHost: false, now: 1 },
      { type: "submitSeerTarget", targetPlayerId: "p1", actionId: game.actionId },
      dependencies,
    );

    const afterSelection = getActiveWerewolfInteraction(game);
    expect(beforeSelection?.id).toBe("seer-action");
    expect(afterSelection?.id).toBe("seer-action");
    expect(afterSelection?.kind).toBe("seer_check");
  });

  it("does not invent interactions for absent optional roles", () => {
    const module = new WerewolfGameModule();
    const config = configFromRoleDeck(5, [
      "werewolf",
      "villager",
      "villager",
      "villager",
      "villager",
    ]);
    const game = module.createGame(
      { playerIds: ["p1", "p2", "p3", "p4", "p5"], config },
      dependencies,
    );

    for (const playerId of Object.keys(game.roles)) {
      module.handleCommand(
        game,
        { playerId, isHost: false, now: 1 },
        { type: "confirmRole", actionId: game.actionId },
        dependencies,
      );
    }

    module.handleCommand(game, { isHost: true, now: 1 }, { type: "startNight" }, dependencies);
    expect(game.phase).toBe("night_werewolf");
    expect(getActiveWerewolfInteraction(game)?.kind).toBe("wolf_kill");

    const wolfId = Object.entries(game.roles).find(([, role]) => role === "werewolf")?.[0];
    expect(wolfId).toBeDefined();
    module.handleCommand(
      game,
      { playerId: wolfId, isHost: false, now: 1 },
      { type: "submitWolfTarget", targetPlayerId: null, actionId: game.actionId },
      dependencies,
    );

    expect(game.phase).toBe("night_complete");
    expect(getActiveWerewolfInteraction(game)).toBeUndefined();
  });

  it("does not create an interaction for a dead night-role actor", () => {
    expect(getActiveWerewolfInteraction(state({
      phase: "night_witch",
      deadPlayerIds: ["p3"],
    }))).toBeUndefined();
  });
});
