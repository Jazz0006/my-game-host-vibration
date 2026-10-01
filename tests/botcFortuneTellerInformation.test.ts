import { describe, expect, it } from "vitest";
import {
  createTroubleBrewingFortuneTellerInformationCandidates,
  createTroubleBrewingRedHerringCandidates,
} from "../src/games/botc/TroubleBrewingFortuneTeller.js";
import type { BotcCanonicalSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";
import {
  createRedHerringRecommendationRequest,
  recommendRedHerringBaselineV1,
} from "../src/games/botc/TroubleBrewingRecommendation.js";

function assignment(
  playerId: string,
  actualRoleId: BotcCanonicalSetupAssignment["actualRoleId"],
): BotcCanonicalSetupAssignment {
  return { playerId, actualRoleId, shownRoleId: actualRoleId };
}

describe("PV-3B3 Fortune Teller rules", () => {
  it("chooses Red Herring candidates from actual good alignment only", () => {
    const candidates = createTroubleBrewingRedHerringCandidates([
      assignment("ft", "fortune_teller"),
      assignment("recluse", "recluse"),
      assignment("drunk", "drunk"),
      assignment("spy", "spy"),
      assignment("imp", "imp"),
    ]);

    expect(candidates).toEqual(["drunk", "ft", "recluse"]);
    expect(candidates).not.toContain("spy");
  });

  it("keeps automatic Red Herring choice in the Recommendation owner", () => {
    const request = createRedHerringRecommendationRequest(["p3", "p1", "p2"]);
    expect(recommendRedHerringBaselineV1(request)).toEqual({ playerId: "p1" });
  });

  it("forces YES when either selected player is the Red Herring", () => {
    const candidates = createTroubleBrewingFortuneTellerInformationCandidates(
      [
        assignment("ft", "fortune_teller"),
        assignment("a", "chef"),
        assignment("b", "empath"),
        assignment("imp", "imp"),
      ],
      ["a", "b"],
      "b",
    );

    expect(candidates.map(candidate => candidate.value)).toEqual([true]);
    expect(candidates[0]).toMatchObject({
      candidateId: "fortune_teller:boolean:yes",
      value: true,
    });
    expect(
      candidates[0]!.legalResolutions.some(
        resolution =>
          resolution.kind === "fortune_teller" &&
          resolution.targets.some(
            target => target.playerId === "b" && target.redHerringMatch,
          ),
      ),
    ).toBe(true);
  });

  it("forces YES for an actual Demon and NO for two ordinary good players", () => {
    const assignments = [
      assignment("ft", "fortune_teller"),
      assignment("a", "chef"),
      assignment("b", "empath"),
      assignment("imp", "imp"),
    ];

    expect(
      createTroubleBrewingFortuneTellerInformationCandidates(
        assignments,
        ["a", "imp"],
        "ft",
      ).map(candidate => candidate.value),
    ).toEqual([true]);

    expect(
      createTroubleBrewingFortuneTellerInformationCandidates(
        assignments,
        ["a", "b"],
        "ft",
      ).map(candidate => candidate.value),
    ).toEqual([false]);
  });

  it("allows Recluse registration to make either NO or YES rules-legal", () => {
    const candidates = createTroubleBrewingFortuneTellerInformationCandidates(
      [
        assignment("ft", "fortune_teller"),
        assignment("a", "chef"),
        assignment("recluse", "recluse"),
        assignment("imp", "imp"),
      ],
      ["a", "recluse"],
      "ft",
    );

    expect(candidates.map(candidate => candidate.value)).toEqual([false, true]);
    expect(
      candidates
        .find(candidate => candidate.value)
        ?.legalResolutions.some(
          resolution =>
            resolution.kind === "fortune_teller" &&
            resolution.targets.some(
              target =>
                target.playerId === "recluse" &&
                target.registration.source === "recluse" &&
                target.registersAsDemon,
            ),
        ),
    ).toBe(true);
  });
});
