import { describe, expect, it } from "vitest";
import {
  createTroubleBrewingWasherwomanInformationCandidates,
} from "../src/games/botc/TroubleBrewingInformation.js";
import {
  troubleBrewingCharacterRegistrations,
  type TroubleBrewingCharacterRegistration,
} from "../src/games/botc/TroubleBrewingRegistration.js";
import type { BotcCanonicalSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";

function assignment(
  playerId: string,
  actualRoleId: BotcCanonicalSetupAssignment["actualRoleId"],
  shownRoleId: BotcCanonicalSetupAssignment["shownRoleId"] = actualRoleId,
): BotcCanonicalSetupAssignment {
  return { playerId, actualRoleId, shownRoleId };
}

function roleIds(registrations: TroubleBrewingCharacterRegistration[]): string[] {
  return registrations.map(registration => registration.roleId);
}

describe("B0C3A Trouble Brewing registration + Washerwoman truthful information", () => {
  it("keeps canonical identity separate from context-dependent Spy/Recluse registration", () => {
    expect(
      troubleBrewingCharacterRegistrations(assignment("chef", "chef")),
    ).toEqual([
      {
        roleId: "chef",
        source: "actual",
      },
    ]);

    const spy = troubleBrewingCharacterRegistrations(
      assignment("spy", "spy"),
    );
    expect(spy).toContainEqual({ roleId: "spy", source: "actual" });
    expect(spy).toContainEqual({ roleId: "ravenkeeper", source: "spy" });
    expect(spy).toContainEqual({ roleId: "saint", source: "spy" });
    expect(roleIds(spy)).not.toContain("imp");
    expect(roleIds(spy)).not.toContain("poisoner");

    const recluse = troubleBrewingCharacterRegistrations(
      assignment("recluse", "recluse"),
    );
    expect(recluse).toContainEqual({ roleId: "recluse", source: "actual" });
    expect(recluse).toContainEqual({ roleId: "poisoner", source: "recluse" });
    expect(recluse).toContainEqual({ roleId: "imp", source: "recluse" });
    expect(roleIds(recluse)).not.toContain("chef");
  });

  it("does not treat the Drunk shown Townsfolk as a registration identity", () => {
    expect(
      troubleBrewingCharacterRegistrations(
        assignment("drunk", "drunk", "empath"),
      ),
    ).toEqual([
      {
        roleId: "drunk",
        source: "actual",
      },
    ]);
  });

  it("generates truthful Washerwoman candidates from actual Townsfolk", () => {
    const candidates = createTroubleBrewingWasherwomanInformationCandidates([
      assignment("washerwoman", "washerwoman"),
      assignment("chef", "chef"),
      assignment("baron", "baron"),
      assignment("imp", "imp"),
    ]);

    expect(candidates).toContainEqual({
      candidateId: "washerwoman:chef:washerwoman:chef",
      learnedRoleId: "chef",
      shownPlayerIds: ["washerwoman", "chef"],
      legalResolutions: [
        {
          matchingPlayerId: "chef",
          matchSource: "actual",
        },
      ],
    });
    expect(candidates).toContainEqual({
      candidateId: "washerwoman:chef:chef:baron",
      learnedRoleId: "chef",
      shownPlayerIds: ["chef", "baron"],
      legalResolutions: [
        {
          matchingPlayerId: "chef",
          matchSource: "actual",
        },
      ],
    });
    expect(
      candidates.every(candidate => candidate.shownPlayerIds[0] !== candidate.shownPlayerIds[1]),
    ).toBe(true);
  });

  it("allows the Spy to be the truthful Townsfolk registration, including a role not actually in play", () => {
    const candidates = createTroubleBrewingWasherwomanInformationCandidates([
      assignment("washerwoman", "washerwoman"),
      assignment("chef", "chef"),
      assignment("spy", "spy"),
      assignment("imp", "imp"),
    ]);

    expect(candidates).toContainEqual({
      candidateId: "washerwoman:ravenkeeper:chef:spy",
      learnedRoleId: "ravenkeeper",
      shownPlayerIds: ["chef", "spy"],
      legalResolutions: [
        {
          matchingPlayerId: "spy",
          matchSource: "spy",
        },
      ],
    });

    expect(candidates).toContainEqual({
      candidateId: "washerwoman:chef:chef:spy",
      learnedRoleId: "chef",
      shownPlayerIds: ["chef", "spy"],
      legalResolutions: [
        {
          matchingPlayerId: "chef",
          matchSource: "actual",
        },
        {
          matchingPlayerId: "spy",
          matchSource: "spy",
        },
      ],
    });
  });

  it("allows a Drunk shown as the learned Townsfolk to be the wrong player, but never the matching player", () => {
    const candidates = createTroubleBrewingWasherwomanInformationCandidates([
      assignment("washerwoman", "washerwoman"),
      assignment("empath", "empath"),
      assignment("drunk", "drunk", "empath"),
      assignment("imp", "imp"),
    ]);

    expect(candidates).toContainEqual({
      candidateId: "washerwoman:empath:empath:drunk",
      learnedRoleId: "empath",
      shownPlayerIds: ["empath", "drunk"],
      legalResolutions: [
        {
          matchingPlayerId: "empath",
          matchSource: "actual",
        },
      ],
    });

    expect(
      candidates.some(
        candidate =>
          candidate.learnedRoleId === "empath" &&
          candidate.legalResolutions.some(
            resolution => resolution.matchingPlayerId === "drunk",
          ),
      ),
    ).toBe(false);
  });

  it("only emits Townsfolk identities for Washerwoman truthful information", () => {
    const candidates = createTroubleBrewingWasherwomanInformationCandidates([
      assignment("washerwoman", "washerwoman"),
      assignment("saint", "saint"),
      assignment("spy", "spy"),
      assignment("recluse", "recluse"),
      assignment("imp", "imp"),
    ]);

    expect(candidates.some(candidate => candidate.learnedRoleId === "saint")).toBe(
      false,
    );
    expect(
      candidates.some(candidate => candidate.learnedRoleId === "poisoner"),
    ).toBe(false);
    expect(candidates.some(candidate => candidate.learnedRoleId === "imp")).toBe(
      false,
    );
  });
});
