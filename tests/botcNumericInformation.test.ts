import { describe, expect, it } from "vitest";
import {
  createTroubleBrewingChefInformationCandidates,
  createTroubleBrewingEmpathInformationCandidates,
} from "../src/games/botc/TroubleBrewingInformation.js";
import type { BotcCanonicalSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";

function assignment(
  playerId: string,
  actualRoleId: BotcCanonicalSetupAssignment["actualRoleId"],
  shownRoleId: BotcCanonicalSetupAssignment["shownRoleId"] = actualRoleId,
): BotcCanonicalSetupAssignment {
  return { playerId, actualRoleId, shownRoleId };
}

describe("PV-3B2C Chef + Empath numeric information domain", () => {
  it("counts Chef evil adjacency on the circular seat order including wraparound", () => {
    const seating = ["p1", "p2", "p3", "p4", "p5"];
    const candidates = createTroubleBrewingChefInformationCandidates(
      [
        assignment("p3", "chef"),
        assignment("p1", "poisoner"),
        assignment("p5", "imp"),
        assignment("p2", "empath"),
        assignment("p4", "saint"),
      ],
      seating,
    );

    expect(candidates.map(candidate => candidate.value)).toEqual([1]);
    expect(candidates[0]).toMatchObject({
      candidateId: "chef:number:1",
      value: 1,
    });
    expect(candidates[0]!.legalResolutions[0]).toMatchObject({
      kind: "chef_pairs",
    });
  });

  it("allows Spy/Recluse alignment registration to vary independently across Chef pairs", () => {
    const candidates = createTroubleBrewingChefInformationCandidates(
      [
        assignment("p1", "imp"),
        assignment("p2", "recluse"),
        assignment("p3", "poisoner"),
        assignment("p4", "spy"),
        assignment("p5", "chef"),
      ],
      ["p1", "p2", "p3", "p4", "p5"],
    );

    expect(candidates.map(candidate => candidate.value)).toEqual([0, 1, 2, 3]);
    const one = candidates.find(candidate => candidate.value === 1);
    expect(one?.legalResolutions.length).toBeGreaterThan(1);
    expect(
      one?.legalResolutions.some(
        resolution =>
          resolution.kind === "chef_pairs" &&
          resolution.pairs.some(
            pair =>
              pair.playerIds.join(":") === "p1:p2" &&
              pair.rightRegistration.source === "recluse" &&
              pair.rightRegistration.alignment === "evil",
          ) &&
          resolution.pairs.some(
            pair =>
              pair.playerIds.join(":") === "p2:p3" &&
              pair.leftRegistration.source === "actual" &&
              pair.leftRegistration.alignment === "good",
          ),
      ),
    ).toBe(true);
  });

  it("uses the closest distinct alive clockwise/counterclockwise players for Empath", () => {
    const candidates = createTroubleBrewingEmpathInformationCandidates(
      [
        assignment("p1", "empath"),
        assignment("p2", "chef"),
        assignment("p3", "poisoner"),
        assignment("p4", "librarian"),
        assignment("p5", "imp"),
      ],
      ["p1", "p2", "p3", "p4", "p5"],
      ["p2", "p5"],
      "p1",
    );

    expect(candidates.map(candidate => candidate.value)).toEqual([1]);
    expect(candidates[0]!.legalResolutions[0]).toMatchObject({
      kind: "empath_neighbors",
      clockwiseNeighborPlayerId: "p3",
      counterclockwiseNeighborPlayerId: "p4",
    });
  });

  it("exposes all legal Empath values when Spy/Recluse are the two living neighbors", () => {
    const candidates = createTroubleBrewingEmpathInformationCandidates(
      [
        assignment("p1", "empath"),
        assignment("p2", "spy"),
        assignment("p3", "chef"),
        assignment("p4", "librarian"),
        assignment("p5", "recluse"),
      ],
      ["p1", "p2", "p3", "p4", "p5"],
      [],
      "p1",
    );

    expect(candidates.map(candidate => candidate.value)).toEqual([0, 1, 2]);
  });
});
