import { describe, expect, it } from "vitest";
import type { GameState, Role } from "../src/domain/game.js";
import type { WerewolfRoleDefinition } from "../src/games/werewolf/roles/RoleDefinition.js";
import {
  createEmptyWerewolfRuleState,
  abilitySourceFor,
} from "../src/games/werewolf/roles/WerewolfRuleState.js";
import {
  learnMechanicalWolfAbility,
  resolveMechanicalWolfAbilityProfile,
} from "../src/games/werewolf/roles/experimental/MechanicalWolfAbilityResolver.js";

function gameState(): GameState {
  return {
    config: {
      playerCount: 4,
      roleDeck: ["werewolf", "seer", "witch", "villager"],
    },
    phase: "night_start",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      mech: "mechanical_wolf" as Role,
      seer: "seer",
      witch: "witch",
      villager: "villager",
    },
    confirmedRolePlayerIds: ["mech", "seer", "witch", "villager"],
    actionId: "b5-action",
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

type SpikeRoleId = Role | "mechanical_wolf";
type SpikeInteractionKind = "seer_check" | "witch_action";

const registry: Record<
  string,
  WerewolfRoleDefinition<SpikeRoleId, SpikeInteractionKind>
> = {
  mechanical_wolf: {
    id: "mechanical_wolf",
    name: "机械狼",
    description: "B5 architecture spike only",
    team: "wolf",
  },
  seer: {
    id: "seer",
    name: "预言家",
    description: "查验",
    team: "village",
    nightOrder: 40,
    interaction: {
      phase: "night_seer",
      kind: "seer_check",
      mode: "single",
      wakePolicy: { vibrate: true },
      completionPolicy: { type: "explicit_confirmation" },
    },
  },
  witch: {
    id: "witch",
    name: "女巫",
    description: "药",
    team: "village",
    nightOrder: 30,
    interaction: {
      phase: "night_witch",
      kind: "witch_action",
      mode: "single",
      wakePolicy: { vibrate: true },
      completionPolicy: { type: "single_submission" },
    },
  },
  villager: {
    id: "villager",
    name: "平民",
    description: "无技能",
    team: "village",
  },
};

describe("B5 Mechanical Wolf ability-source architecture spike", () => {
  it("stores a serializable one-time ability source without changing assigned role", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();

    const learned = learnMechanicalWolfAbility(game, ruleState, "mech", "seer");

    expect(game.roles.mech).toBe("mechanical_wolf");
    expect(learned).toEqual({
      ownerPlayerId: "mech",
      sourcePlayerId: "seer",
      sourceRoleId: "seer",
      learnedNightNumber: 1,
      availableFromNightNumber: 2,
    });
    expect(JSON.parse(JSON.stringify(ruleState))).toEqual(ruleState);
  });

  it("rejects a second learning choice", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "seer");

    expect(() =>
      learnMechanicalWolfAbility(game, ruleState, "mech", "witch"),
    ).toThrow("整局只能学习一次");
  });

  it("keeps wolf alignment while exposing learned role separately for identity checks", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "seer");

    const profile = resolveMechanicalWolfAbilityProfile(
      game,
      ruleState,
      "mech",
      registry,
    );

    expect(profile.assignedRoleId).toBe("mechanical_wolf");
    expect(profile.effectiveTeam).toBe("wolf");
    expect(profile.perceivedRoleId).toBe("seer");
    expect(profile.abilitySource?.sourceRoleId).toBe("seer");
  });

  it("does not make a copied active interaction available until its activation night", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "seer");

    expect(
      resolveMechanicalWolfAbilityProfile(game, ruleState, "mech", registry)
        .borrowedInteraction,
    ).toBeUndefined();

    game.nightNumber = 2;
    expect(
      resolveMechanicalWolfAbilityProfile(game, ruleState, "mech", registry)
        .borrowedInteraction?.kind,
    ).toBe("seer_check");
  });

  it("copies ability semantics but not the source role phase or night order", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "seer", 0);

    const borrowed = resolveMechanicalWolfAbilityProfile(
      game,
      ruleState,
      "mech",
      registry,
    ).borrowedInteraction;

    expect(borrowed?.kind).toBe("seer_check");
    expect(borrowed?.mode).toBe("single");
    expect(borrowed).not.toHaveProperty("phase");
    expect(borrowed).not.toHaveProperty("nightOrder");
  });

  it("learning a role with no active interaction preserves identity disguise but grants no interaction", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "villager", 0);

    const profile = resolveMechanicalWolfAbilityProfile(
      game,
      ruleState,
      "mech",
      registry,
    );

    expect(profile.perceivedRoleId).toBe("villager");
    expect(profile.borrowedInteraction).toBeUndefined();
    expect(profile.effectiveTeam).toBe("wolf");
  });

  it("retains the learned ability source after the learned player dies", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    learnMechanicalWolfAbility(game, ruleState, "mech", "witch", 0);
    game.deadPlayerIds.push("witch");

    expect(abilitySourceFor(ruleState, "mech")?.sourceRoleId).toBe("witch");
    expect(
      resolveMechanicalWolfAbilityProfile(game, ruleState, "mech", registry)
        .borrowedInteraction?.kind,
    ).toBe("witch_action");
  });

  it("rejects self-learning and unknown targets", () => {
    const game = gameState();

    expect(() =>
      learnMechanicalWolfAbility(game, createEmptyWerewolfRuleState(), "mech", "mech"),
    ).toThrow("不能学习自己");
    expect(() =>
      learnMechanicalWolfAbility(game, createEmptyWerewolfRuleState(), "mech", "missing"),
    ).toThrow("不是有效玩家");
  });
});
