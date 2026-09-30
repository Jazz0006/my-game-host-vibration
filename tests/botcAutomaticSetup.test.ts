import { describe, expect, it } from "vitest";
import type { RandomProvider } from "../src/core/random/RandomProvider.js";
import {
  createTroubleBrewingAutomaticSetup,
} from "../src/games/botc/TroubleBrewingAutomaticSetup.js";
import {
  troubleBrewingBaseCounts,
  troubleBrewingRole,
} from "../src/games/botc/TroubleBrewing.js";

const firstRandom: RandomProvider = {
  randomInt: () => 0,
  randomId: () => "unused",
};

describe("PV-1 Trouble Brewing automatic setup baseline", () => {
  it.each(Array.from({ length: 11 }, (_, index) => index + 5))(
    "creates a canonical legal %i-player setup without advanced recommendation policy",
    playerCount => {
      const playerIds = Array.from(
        { length: playerCount },
        (_, index) => `p${index + 1}`,
      );
      const assignments = createTroubleBrewingAutomaticSetup(
        playerIds,
        firstRandom,
      );

      expect(assignments).toHaveLength(playerCount);
      expect(new Set(assignments.map(item => item.playerId)).size).toBe(
        playerCount,
      );
      expect(
        new Set(assignments.map(item => item.actualRoleId)).size,
      ).toBe(playerCount);
      expect(assignments.some(item => item.actualRoleId === "baron")).toBe(false);

      const actualCounts = {
        townsfolk: 0,
        outsider: 0,
        minion: 0,
        demon: 0,
      };
      for (const assignment of assignments) {
        actualCounts[troubleBrewingRole(assignment.actualRoleId).category] += 1;
      }
      expect(actualCounts).toEqual(troubleBrewingBaseCounts(playerCount));
    },
  );

  it("gives an automatically selected Drunk a non-play Townsfolk shown role", () => {
    const chooseDrunk: RandomProvider = {
      randomInt(maxExclusive) {
        return maxExclusive === 4 ? 1 : 0;
      },
      randomId: () => "unused",
    };
    const assignments = createTroubleBrewingAutomaticSetup(
      ["p1", "p2", "p3", "p4", "p5", "p6"],
      chooseDrunk,
    );

    const drunk = assignments.find(item => item.actualRoleId === "drunk");
    expect(drunk).toBeDefined();
    expect(troubleBrewingRole(drunk!.shownRoleId).category).toBe("townsfolk");
    expect(
      assignments.some(item => item.actualRoleId === drunk!.shownRoleId),
    ).toBe(false);
  });
});
