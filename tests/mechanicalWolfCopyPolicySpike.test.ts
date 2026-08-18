import { describe, expect, it } from "vitest";
import type { GameState, Role } from "../src/domain/game.js";
import {
  abilityResourceFor,
  createEmptyWerewolfRuleState,
} from "../src/games/werewolf/roles/WerewolfRuleState.js";
import { learnMechanicalWolfAbility } from "../src/games/werewolf/roles/experimental/MechanicalWolfAbilityResolver.js";
import {
  MECHANICAL_WOLF_COPY_POLICIES,
  availableMechanicalWolfCopiedInteractions,
  consumeMechanicalWolfCopiedInteraction,
  initializeMechanicalWolfCopiedResources,
  resolveMechanicalWolfCopiedSelfDeathEffects,
} from "../src/games/werewolf/roles/experimental/MechanicalWolfCopyPolicy.js";

function gameState(): GameState {
  return {
    config: {
      playerCount: 4,
      roleDeck: ["werewolf", "hunter", "witch", "villager"],
    },
    phase: "night_start",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      mech: "mechanical_wolf" as Role,
      hunter: "hunter",
      witch: "witch",
      villager: "villager",
    },
    confirmedRolePlayerIds: ["mech", "hunter", "witch", "villager"],
    actionId: "b5-1-action",
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

describe("B5.1 Mechanical Wolf explicit copy policy spike", () => {
  it("copies Hunter as an explicit self-death trigger without delegating the source role hook bundle", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "hunter");

    expect(
      resolveMechanicalWolfCopiedSelfDeathEffects(
        ruleState,
        "mech",
        "mech",
        "night_attack",
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toEqual([{ type: "interaction", kind: "hunter_shot", actorPlayerId: "mech" }]);
  });

  it("allows copied Hunter on day elimination but not poison death", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "hunter");

    expect(
      resolveMechanicalWolfCopiedSelfDeathEffects(
        ruleState,
        "mech",
        "mech",
        "day_elimination",
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toHaveLength(1);
    expect(
      resolveMechanicalWolfCopiedSelfDeathEffects(
        ruleState,
        "mech",
        "mech",
        "poison",
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toEqual([]);
  });

  it("does not trigger copied Hunter when another player dies", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "hunter");

    expect(
      resolveMechanicalWolfCopiedSelfDeathEffects(
        ruleState,
        "mech",
        "villager",
        "night_attack",
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toEqual([]);
  });

  it("gives copied Witch its own one-use poison resource instead of sharing the real Witch resource", () => {
    const game = gameState();
    game.witchPoisonSpent = true;
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "witch");
    initializeMechanicalWolfCopiedResources(
      ruleState,
      "mech",
      MECHANICAL_WOLF_COPY_POLICIES,
    );

    expect(abilityResourceFor(ruleState, "mech", "copied_witch_poison")).toEqual({
      ownerPlayerId: "mech",
      key: "copied_witch_poison",
      remainingUses: 1,
    });
    expect(JSON.parse(JSON.stringify(ruleState))).toEqual(ruleState);
  });

  it("keeps copied Witch poison unavailable until the next night", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "witch");
    initializeMechanicalWolfCopiedResources(
      ruleState,
      "mech",
      MECHANICAL_WOLF_COPY_POLICIES,
    );

    expect(
      availableMechanicalWolfCopiedInteractions(
        ruleState,
        "mech",
        1,
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toEqual([]);
    expect(
      availableMechanicalWolfCopiedInteractions(
        ruleState,
        "mech",
        2,
        MECHANICAL_WOLF_COPY_POLICIES,
      ).map(item => item.interactionKind),
    ).toEqual(["mechanical_wolf_poison"]);
  });

  it("consumes copied Witch poison exactly once", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "witch");
    initializeMechanicalWolfCopiedResources(
      ruleState,
      "mech",
      MECHANICAL_WOLF_COPY_POLICIES,
    );

    consumeMechanicalWolfCopiedInteraction(
      ruleState,
      "mech",
      2,
      "mechanical_wolf_poison",
      MECHANICAL_WOLF_COPY_POLICIES,
    );

    expect(
      abilityResourceFor(ruleState, "mech", "copied_witch_poison")?.remainingUses,
    ).toBe(0);
    expect(
      availableMechanicalWolfCopiedInteractions(
        ruleState,
        "mech",
        2,
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toEqual([]);
    expect(() =>
      consumeMechanicalWolfCopiedInteraction(
        ruleState,
        "mech",
        2,
        "mechanical_wolf_poison",
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toThrow("当前不可用");
  });

  it("does not allow copied Witch poison to be consumed before activation", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "witch");
    initializeMechanicalWolfCopiedResources(
      ruleState,
      "mech",
      MECHANICAL_WOLF_COPY_POLICIES,
    );

    expect(() =>
      consumeMechanicalWolfCopiedInteraction(
        ruleState,
        "mech",
        1,
        "mechanical_wolf_poison",
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toThrow("当前不可用");
  });

  it("gives passive roles no copied capability or resource", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "villager", 0);
    initializeMechanicalWolfCopiedResources(
      ruleState,
      "mech",
      MECHANICAL_WOLF_COPY_POLICIES,
    );

    expect(ruleState.abilityResources).toEqual([]);
    expect(
      availableMechanicalWolfCopiedInteractions(
        ruleState,
        "mech",
        1,
        MECHANICAL_WOLF_COPY_POLICIES,
      ),
    ).toEqual([]);
  });
});
