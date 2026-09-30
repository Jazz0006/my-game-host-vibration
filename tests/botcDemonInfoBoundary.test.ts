import { describe, expect, it } from "vitest";
import {
  createTroubleBrewingDemonInfoFacts,
} from "../src/games/botc/TroubleBrewingInformation.js";
import {
  createDemonBluffRecommendationRequest,
  validateDemonBluffRecommendation,
} from "../src/games/botc/TroubleBrewingRecommendation.js";
import type { BotcCanonicalSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";

function assignment(
  playerId: string,
  actualRoleId: BotcCanonicalSetupAssignment["actualRoleId"],
  shownRoleId: BotcCanonicalSetupAssignment["shownRoleId"] = actualRoleId,
): BotcCanonicalSetupAssignment {
  return { playerId, actualRoleId, shownRoleId };
}

describe("B0C1 Trouble Brewing Demon Info boundary", () => {
  it("derives authoritative Demon/Minion facts and legal not-in-play good bluff candidates", () => {
    const facts = createTroubleBrewingDemonInfoFacts([
      assignment("p1", "washerwoman"),
      assignment("p2", "chef"),
      assignment("p3", "empath"),
      assignment("p4", "monk"),
      assignment("p5", "saint"),
      assignment("p6", "poisoner"),
      assignment("p7", "imp"),
    ]);

    expect(facts.demonPlayerId).toBe("p7");
    expect(facts.minionPlayerIds).toEqual(["p6"]);

    expect(facts.legalBluffRoleIds).not.toContain("washerwoman");
    expect(facts.legalBluffRoleIds).not.toContain("chef");
    expect(facts.legalBluffRoleIds).not.toContain("empath");
    expect(facts.legalBluffRoleIds).not.toContain("monk");
    expect(facts.legalBluffRoleIds).not.toContain("saint");
    expect(facts.legalBluffRoleIds).not.toContain("poisoner");
    expect(facts.legalBluffRoleIds).not.toContain("imp");

    expect(facts.legalBluffRoleIds).toEqual(
      expect.arrayContaining([
        "librarian",
        "investigator",
        "fortune_teller",
        "undertaker",
        "ravenkeeper",
        "virgin",
        "slayer",
        "soldier",
        "mayor",
        "butler",
        "drunk",
        "recluse",
      ]),
    );
  });

  it("keeps the Drunk shown Townsfolk as a rules-legal bluff because that character is not actually in play", () => {
    const facts = createTroubleBrewingDemonInfoFacts([
      assignment("p1", "drunk", "empath"),
      assignment("p2", "washerwoman"),
      assignment("p3", "chef"),
      assignment("p4", "monk"),
      assignment("p5", "saint"),
      assignment("p6", "poisoner"),
      assignment("p7", "imp"),
    ]);

    expect(facts.legalBluffRoleIds).toContain("empath");

    const request = createDemonBluffRecommendationRequest(facts, {
      shownDrunkRoleId: "empath",
    });
    expect(request.requiredContext.legalBluffRoleIds).toContain("empath");
    expect(request.optionalContext).toEqual({
      shownDrunkRoleId: "empath",
    });
  });

  it("does not create standard Demon Info below seven players", () => {
    expect(() =>
      createTroubleBrewingDemonInfoFacts([
        assignment("p1", "washerwoman"),
        assignment("p2", "chef"),
        assignment("p3", "empath"),
        assignment("p4", "poisoner"),
        assignment("p5", "imp"),
      ]),
    ).toThrow("standard Demon Info requires at least 7 players");
  });

  it("keeps recommendation legality separate from recommendation quality", () => {
    const facts = createTroubleBrewingDemonInfoFacts([
      assignment("p1", "washerwoman"),
      assignment("p2", "chef"),
      assignment("p3", "empath"),
      assignment("p4", "monk"),
      assignment("p5", "saint"),
      assignment("p6", "poisoner"),
      assignment("p7", "imp"),
    ]);
    const request = createDemonBluffRecommendationRequest(facts);

    expect(
      validateDemonBluffRecommendation(request, {
        roleIds: ["librarian", "investigator", "fortune_teller"],
      }),
    ).toEqual({
      roleIds: ["librarian", "investigator", "fortune_teller"],
    });

    expect(() =>
      validateDemonBluffRecommendation(request, {
        roleIds: ["librarian", "librarian", "fortune_teller"],
      }),
    ).toThrow("three unique");

    expect(() =>
      validateDemonBluffRecommendation(request, {
        roleIds: ["librarian", "investigator", "washerwoman"],
      }),
    ).toThrow("legal bluff candidates");
  });
});
