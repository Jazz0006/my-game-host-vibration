import { describe, expect, it } from "vitest";
import { checkVictory, type GameState, type Role } from "../src/domain/game.js";
import type { WerewolfRoleDefinition } from "../src/games/werewolf/roles/RoleDefinition.js";
import {
  createEmptyWerewolfRuleState,
  addLoversRelationship,
} from "../src/games/werewolf/roles/WerewolfRuleState.js";
import {
  resolveLoversEffectiveTeam,
  resolveLoversVictory,
} from "../src/games/werewolf/roles/experimental/LoversRuleResolver.js";

function gameState(): GameState {
  return {
    config: {
      playerCount: 4,
      roleDeck: ["werewolf", "villager", "werewolf", "villager"],
    },
    phase: "night_start",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      a: "werewolf",
      b: "villager",
      c: "werewolf",
      d: "villager",
    },
    confirmedRolePlayerIds: ["a", "b", "c", "d"],
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

const role = (id: Role, team: "wolf" | "village"): WerewolfRoleDefinition<Role, string> => ({
  id,
  name: id,
  description: "B4.1 fixture",
  team,
});

const registry = {
  werewolf: role("werewolf", "wolf"),
  villager: role("villager", "village"),
};

function mixedLovers() {
  const ruleState = createEmptyWerewolfRuleState();
  addLoversRelationship(ruleState, {
    id: "lovers-mixed",
    kind: "lovers",
    sourceRolePlayerId: "d",
    playerIds: ["a", "b"],
  });
  return ruleState;
}

describe("B4.1 mixed Lovers alignment and victory spike", () => {
  it("keeps role identity but resolves both members of a wolf/villager pair to Lovers team", () => {
    const game = gameState();
    const ruleState = mixedLovers();

    expect(game.roles.a).toBe("werewolf");
    expect(game.roles.b).toBe("villager");
    expect(resolveLoversEffectiveTeam(game, "a", registry, ruleState)).toBe("lovers");
    expect(resolveLoversEffectiveTeam(game, "b", registry, ruleState)).toBe("lovers");
    expect(resolveLoversEffectiveTeam(game, "c", registry, ruleState)).toBe("wolf");
  });

  it("does not change the effective team of same-team lovers", () => {
    const game = gameState();
    const ruleState = createEmptyWerewolfRuleState();
    addLoversRelationship(ruleState, {
      id: "lovers-village",
      kind: "lovers",
      sourceRolePlayerId: "a",
      playerIds: ["b", "d"],
    });

    expect(resolveLoversEffectiveTeam(game, "b", registry, ruleState)).toBe("village");
    expect(resolveLoversEffectiveTeam(game, "d", registry, ruleState)).toBe("village");
  });

  it("composes with a caller-provided dynamic base-team resolver", () => {
    const game = gameState();
    const ruleState = mixedLovers();
    const dynamicTeam = (playerId: string) => {
      if (playerId === "a") return "village" as const;
      return game.roles[playerId] === "werewolf" ? ("wolf" as const) : ("village" as const);
    };

    expect(resolveLoversEffectiveTeam(game, "a", registry, ruleState, dynamicTeam)).toBe("village");
    expect(resolveLoversEffectiveTeam(game, "b", registry, ruleState, dynamicTeam)).toBe("village");
    expect(resolveLoversVictory(game, "wolf", registry, ruleState, dynamicTeam)).toBe("wolf");
  });

  it("suppresses the normal wolf parity victory while a mixed pair is alive", () => {
    const game = gameState();
    game.deadPlayerIds.push("d");
    const ruleState = mixedLovers();

    expect(checkVictory(game)).toBe("wolf");
    expect(resolveLoversVictory(game, checkVictory(game), registry, ruleState)).toBeNull();
  });

  it("awards Lovers victory when the mixed pair are the final two living players", () => {
    const game = gameState();
    game.deadPlayerIds.push("c", "d");
    const ruleState = mixedLovers();

    expect(checkVictory(game)).toBe("wolf");
    expect(resolveLoversVictory(game, checkVictory(game), registry, ruleState)).toBe("lovers");
  });

  it("returns to normal faction victory once the mixed pair is broken", () => {
    const game = gameState();
    game.deadPlayerIds.push("b", "d");
    const ruleState = mixedLovers();

    expect(checkVictory(game)).toBe("wolf");
    expect(resolveLoversVictory(game, checkVictory(game), registry, ruleState)).toBe("wolf");
  });

  it("rejects overlapping lovers relationships", () => {
    const ruleState = mixedLovers();

    expect(() =>
      addLoversRelationship(ruleState, {
        id: "lovers-overlap",
        kind: "lovers",
        sourceRolePlayerId: "c",
        playerIds: ["b", "c"],
      }),
    ).toThrow("不能同时属于多组恋人关系");
  });
});
