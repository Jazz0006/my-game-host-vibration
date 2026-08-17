import { describe, expect, it } from "vitest";
import { configFromRoleDeck, confirmRole, startGame } from "../src/domain/game.js";
import type { GameRandomSource } from "../src/domain/gameRandom.js";

function deterministicRandom(): GameRandomSource {
  let id = 0;
  return {
    randomInt(maxExclusive) {
      return maxExclusive - 1;
    },
    randomId() {
      id += 1;
      return `action-${id}`;
    },
  };
}

describe("game random injection", () => {
  it("uses the injected source for role dealing and action ids", () => {
    const random = deterministicRandom();
    const playerIds = ["p1", "p2", "p3", "p4", "p5"];
    const config = configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]);

    const game = startGame(playerIds, config, random);

    expect(game.actionId).toBe("action-1");
    expect(game.roles).toEqual({
      p1: "werewolf",
      p2: "seer",
      p3: "witch",
      p4: "villager",
      p5: "villager",
    });

    for (const playerId of playerIds.slice(0, -1)) {
      expect(confirmRole(game, playerId, game.actionId, random)).toBe(false);
    }
    expect(confirmRole(game, "p5", game.actionId, random)).toBe(true);
    expect(game.phase).toBe("night_start");
    expect(game.actionId).toBe("action-2");
  });
});
