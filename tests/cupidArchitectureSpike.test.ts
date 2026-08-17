import { describe, expect, it } from "vitest";
import type { GameState, Role } from "../src/domain/game.js";
import type { WerewolfRoleDefinition } from "../src/games/werewolf/roles/RoleDefinition.js";
import { resolveWerewolfDeathChain } from "../src/games/werewolf/roles/RoleEffectResolver.js";
import {
  createEmptyWerewolfRuleState,
  loverOf,
} from "../src/games/werewolf/roles/WerewolfRuleState.js";
import {
  applyCupidFirstNightSelection,
  CUPID_SPIKE_ROLE_DEFINITION,
  type CupidSpikeInteractionKind,
  type CupidSpikeRoleId,
} from "../src/games/werewolf/roles/experimental/CupidRoleDefinition.js";

function spikeGame(): GameState {
  return {
    config: {
      playerCount: 4,
      roleDeck: ["villager", "villager", "werewolf", "villager"],
    },
    phase: "night_start",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      cupid: "cupid" as Role,
      a: "villager",
      b: "werewolf",
      c: "villager",
    },
    confirmedRolePlayerIds: ["cupid", "a", "b", "c"],
    actionId: "spike-action",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
  };
}

const passiveVillage: WerewolfRoleDefinition<CupidSpikeRoleId, CupidSpikeInteractionKind> = {
  id: "villager",
  name: "平民",
  description: "spike fixture",
  team: "village",
};
const passiveWolf: WerewolfRoleDefinition<CupidSpikeRoleId, CupidSpikeInteractionKind> = {
  id: "werewolf",
  name: "狼人",
  description: "spike fixture",
  team: "wolf",
};
const registry = {
  cupid: CUPID_SPIKE_ROLE_DEFINITION,
  villager: passiveVillage,
  werewolf: passiveWolf,
};

describe("Cupid relationship architecture spike", () => {
  it("stores the first-night lovers relationship as serializable rule state", () => {
    const ruleState = createEmptyWerewolfRuleState();
    applyCupidFirstNightSelection(ruleState, "cupid", ["a", "b"], "lovers-1");

    expect(loverOf(ruleState, "a")).toBe("b");
    expect(loverOf(ruleState, "b")).toBe("a");
    expect(JSON.parse(JSON.stringify(ruleState))).toEqual(ruleState);
  });

  it("allows Cupid to be one of the two lovers", () => {
    const ruleState = createEmptyWerewolfRuleState();
    applyCupidFirstNightSelection(ruleState, "cupid", ["cupid", "a"], "lovers-self");
    expect(loverOf(ruleState, "cupid")).toBe("a");
  });

  it("rejects selecting the same player twice", () => {
    const ruleState = createEmptyWerewolfRuleState();
    expect(() =>
      applyCupidFirstNightSelection(ruleState, "cupid", ["a", "a"], "invalid"),
    ).toThrow("两名不同玩家");
  });

  it("resolves a lover death into one linked ability death without mutating GameState", () => {
    const game = spikeGame();
    const ruleState = createEmptyWerewolfRuleState();
    applyCupidFirstNightSelection(ruleState, "cupid", ["a", "b"], "lovers-1");

    const result = resolveWerewolfDeathChain(
      game,
      { playerId: "a", cause: "night_attack" },
      ruleState,
      registry,
    );

    expect(result.deaths).toEqual([
      { playerId: "a", cause: "night_attack" },
      { playerId: "b", cause: "ability" },
    ]);
    expect(result.interactionEffects).toEqual([]);
    expect(game.deadPlayerIds).toEqual([]);
  });

  it("does not loop when the linked lover death points back to the first lover", () => {
    const game = spikeGame();
    const ruleState = createEmptyWerewolfRuleState();
    applyCupidFirstNightSelection(ruleState, "cupid", ["a", "b"], "lovers-1");

    const result = resolveWerewolfDeathChain(
      game,
      { playerId: "b", cause: "day_elimination" },
      ruleState,
      registry,
    );

    expect(result.deaths).toEqual([
      { playerId: "b", cause: "day_elimination" },
      { playerId: "a", cause: "ability" },
    ]);
  });

  it("ignores a linked-death target that was already dead before the chain started", () => {
    const game = spikeGame();
    game.deadPlayerIds.push("b");
    const ruleState = createEmptyWerewolfRuleState();
    applyCupidFirstNightSelection(ruleState, "cupid", ["a", "b"], "lovers-1");

    const result = resolveWerewolfDeathChain(
      game,
      { playerId: "a", cause: "poison" },
      ruleState,
      registry,
    );

    expect(result.deaths).toEqual([{ playerId: "a", cause: "poison" }]);
  });
});
