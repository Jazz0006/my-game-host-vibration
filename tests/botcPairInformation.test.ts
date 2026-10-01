import { describe, expect, it } from "vitest";
import {
  createTroubleBrewingInvestigatorInformationCandidates,
  createTroubleBrewingLibrarianInformationCandidates,
  createTroubleBrewingWasherwomanInformationCandidates,
} from "../src/games/botc/TroubleBrewingInformation.js";
import type { BotcCanonicalSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";

function assignment(
  playerId: string,
  actualRoleId: BotcCanonicalSetupAssignment["actualRoleId"],
  shownRoleId: BotcCanonicalSetupAssignment["shownRoleId"] = actualRoleId,
): BotcCanonicalSetupAssignment {
  return { playerId, actualRoleId, shownRoleId };
}

describe("PV-3B2B Librarian + Investigator pair-information domain", () => {
  it("represents Librarian zero-Outsider information only when zero Outsiders are actually in play", () => {
    const candidates = createTroubleBrewingLibrarianInformationCandidates(
      [
        assignment("p1", "librarian"),
        assignment("p2", "chef"),
        assignment("p3", "empath"),
        assignment("p4", "poisoner"),
        assignment("p5", "imp"),
      ],
      "p1",
    );

    expect(candidates).toEqual([
      {
        candidateId: "librarian:no-outsiders",
        noCharacterCategory: "outsider",
        legalResolutions: [
          {
            noCharacterCategory: "outsider",
            truthSource: "actual_state",
          },
        ],
      },
    ]);

    const drunkShownLibrarian = createTroubleBrewingLibrarianInformationCandidates(
      [
        assignment("p1", "drunk", "librarian"),
        assignment("p2", "chef"),
        assignment("p3", "empath"),
        assignment("p4", "poisoner"),
        assignment("p5", "imp"),
      ],
      "p1",
    );
    expect(
      drunkShownLibrarian.some(candidate => candidate.candidateId === "librarian:no-outsiders"),
    ).toBe(false);
    expect(drunkShownLibrarian).toContainEqual({
      candidateId: "librarian:drunk:p1:p2",
      learnedRoleId: "drunk",
      shownPlayerIds: ["p1", "p2"],
      legalResolutions: [
        {
          matchingPlayerId: "p1",
          matchSource: "actual",
        },
      ],
    });
  });

  it("allows a sole-Townsfolk Washerwoman to learn themself plus another player", () => {
    const candidates = createTroubleBrewingWasherwomanInformationCandidates(
      [
        assignment("p1", "washerwoman"),
        assignment("p2", "drunk", "empath"),
        assignment("p3", "saint"),
        assignment("p4", "baron"),
        assignment("p5", "imp"),
      ],
      "p1",
    );

    expect(candidates).toContainEqual({
      candidateId: "washerwoman:washerwoman:p1:p2",
      learnedRoleId: "washerwoman",
      shownPlayerIds: ["p1", "p2"],
      legalResolutions: [
        {
          matchingPlayerId: "p1",
          matchSource: "actual",
        },
      ],
    });
  });

  it("keeps Librarian zero-Outsider truth legal while also exposing Spy registered-Outsider pair truths", () => {
    const candidates = createTroubleBrewingLibrarianInformationCandidates(
      [
        assignment("p1", "librarian"),
        assignment("p2", "spy"),
        assignment("p3", "chef"),
        assignment("p4", "empath"),
        assignment("p5", "imp"),
      ],
      "p1",
    );

    expect(candidates).toContainEqual({
      candidateId: "librarian:no-outsiders",
      noCharacterCategory: "outsider",
      legalResolutions: [
        {
          noCharacterCategory: "outsider",
          truthSource: "actual_state",
        },
      ],
    });
    expect(candidates).toContainEqual({
      candidateId: "librarian:saint:p2:p3",
      learnedRoleId: "saint",
      shownPlayerIds: ["p2", "p3"],
      legalResolutions: [
        {
          matchingPlayerId: "p2",
          matchSource: "spy",
        },
      ],
    });
    expect(
      candidates.some(
        candidate =>
          "shownPlayerIds" in candidate &&
          candidate.shownPlayerIds.includes("p1"),
      ),
    ).toBe(true);
  });

  it("generates Investigator truths from actual Minions and Recluse registered Minions", () => {
    const candidates = createTroubleBrewingInvestigatorInformationCandidates(
      [
        assignment("p1", "investigator"),
        assignment("p2", "recluse"),
        assignment("p3", "chef"),
        assignment("p4", "poisoner"),
        assignment("p5", "imp"),
      ],
      "p1",
    );

    expect(candidates).toContainEqual({
      candidateId: "investigator:poisoner:p3:p4",
      learnedRoleId: "poisoner",
      shownPlayerIds: ["p3", "p4"],
      legalResolutions: [
        {
          matchingPlayerId: "p4",
          matchSource: "actual",
        },
      ],
    });
    expect(candidates).toContainEqual({
      candidateId: "investigator:scarlet_woman:p2:p3",
      learnedRoleId: "scarlet_woman",
      shownPlayerIds: ["p2", "p3"],
      legalResolutions: [
        {
          matchingPlayerId: "p2",
          matchSource: "recluse",
        },
      ],
    });
    expect(
      candidates.some(candidate => candidate.shownPlayerIds.includes("p1")),
    ).toBe(true);
  });
});
