import { describe, expect, it } from "vitest";
import type { GameState, Role } from "../src/domain/game.js";
import {
  collectWerewolfAfterDeathEffects,
  resolveWerewolfEffectiveTeam,
  resolveWerewolfVictoryOverride,
  shouldPreventWerewolfDeath,
  WerewolfRoleHookConflictError,
} from "../src/games/werewolf/roles/RoleHookRunner.js";
import type { WerewolfRoleDefinition } from "../src/games/werewolf/roles/RoleDefinition.js";
import {
  WEREWOLF_ROLE_REGISTRY,
  type WerewolfInteractionKind,
} from "../src/games/werewolf/roles/registry.js";

function gameState(): GameState {
  return {
    config: { playerCount: 5, roleDeck: ["hunter", "villager", "villager", "seer", "werewolf"] },
    phase: "day_result",
    nightNumber: 1,
    dayNumber: 1,
    roles: { p1: "hunter", p2: "villager", p3: "villager", p4: "seer", p5: "werewolf" },
    confirmedRolePlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    actionId: "action-1",
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

type TestRegistry = Readonly<Record<Role, WerewolfRoleDefinition<Role, WerewolfInteractionKind>>>;

describe("Werewolf complex role lifecycle hooks", () => {
  it("expresses the existing hunter death trigger as an interaction effect", () => {
    const game = gameState();
    game.deadPlayerIds.push("p1");

    expect(collectWerewolfAfterDeathEffects(game, "p1", "night_attack", WEREWOLF_ROLE_REGISTRY))
      .toEqual([{ type: "interaction", kind: "hunter_shot", actorPlayerId: "p1" }]);
    expect(collectWerewolfAfterDeathEffects(game, "p1", "day_elimination", WEREWOLF_ROLE_REGISTRY))
      .toEqual([{ type: "interaction", kind: "hunter_shot", actorPlayerId: "p1" }]);
    expect(collectWerewolfAfterDeathEffects(game, "p1", "poison", WEREWOLF_ROLE_REGISTRY))
      .toEqual([]);
  });

  it("allows one role owner to prevent another player's death", () => {
    const game = gameState();
    const registry: TestRegistry = {
      ...WEREWOLF_ROLE_REGISTRY,
      villager: {
        ...WEREWOLF_ROLE_REGISTRY.villager,
        hooks: {
          beforeDeath: ({ rolePlayerId, deadPlayerId }) =>
            rolePlayerId === "p2" && deadPlayerId === "p3"
              ? { preventDeath: true, reason: "linked protector prevented the death" }
              : undefined,
        },
      },
    };

    expect(shouldPreventWerewolfDeath(game, "p3", "ability", registry)).toEqual({
      preventDeath: true,
      reasons: ["linked protector prevented the death"],
    });
    expect(shouldPreventWerewolfDeath(game, "p4", "ability", registry)).toEqual({
      preventDeath: false,
      reasons: [],
    });
  });

  it("supports dynamic alignment without changing the stored role id", () => {
    const game = gameState();
    const registry: TestRegistry = {
      ...WEREWOLF_ROLE_REGISTRY,
      seer: {
        ...WEREWOLF_ROLE_REGISTRY.seer,
        hooks: {
          resolveTeam: ({ game: currentGame }) => currentGame.dayNumber >= 2 ? "wolf" : "village",
        },
      },
    };

    expect(resolveWerewolfEffectiveTeam(game, "p4", registry)).toBe("village");
    game.dayNumber = 2;
    expect(resolveWerewolfEffectiveTeam(game, "p4", registry)).toBe("wolf");
    expect(game.roles.p4).toBe("seer");
  });

  it("allows a role to override the default winner", () => {
    const game = gameState();
    const registry: TestRegistry = {
      ...WEREWOLF_ROLE_REGISTRY,
      seer: {
        ...WEREWOLF_ROLE_REGISTRY.seer,
        hooks: {
          evaluateVictory: ({ rolePlayerId }) => rolePlayerId === "p4" ? "village" : undefined,
        },
      },
    };
    expect(resolveWerewolfVictoryOverride(game, "wolf", registry)).toBe("village");
  });

  it("rejects conflicting victory overrides instead of depending on registry order", () => {
    const game = gameState();
    const registry: TestRegistry = {
      ...WEREWOLF_ROLE_REGISTRY,
      seer: { ...WEREWOLF_ROLE_REGISTRY.seer, hooks: { evaluateVictory: () => "village" } },
      villager: {
        ...WEREWOLF_ROLE_REGISTRY.villager,
        hooks: {
          evaluateVictory: ({ rolePlayerId }) => rolePlayerId === "p2" ? "wolf" : undefined,
        },
      },
    };
    expect(() => resolveWerewolfVictoryOverride(game, null, registry)).toThrow(
      WerewolfRoleHookConflictError,
    );
  });
});
