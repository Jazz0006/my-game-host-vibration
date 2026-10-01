import {
  TROUBLE_BREWING_ROLES,
  troubleBrewingRole,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";
import {
  troubleBrewingCharacterRegistrations,
  type TroubleBrewingCharacterRegistrationSource,
} from "./TroubleBrewingRegistration.js";

export type TroubleBrewingDemonInfoFacts = {
  demonPlayerId: string;
  minionPlayerIds: string[];
  legalBluffRoleIds: TroubleBrewingRoleId[];
};

/**
 * Resolves the authoritative standard Demon Info facts for Trouble Brewing.
 *
 * This owner decides only what is rules-legal:
 * - who the Demon is;
 * - which players are Minions;
 * - which good characters are actually not in play and may therefore be used
 *   as Demon bluffs.
 *
 * It deliberately does not choose which three bluffs are best.
 */
export function createTroubleBrewingDemonInfoFacts(
  assignments: readonly BotcCanonicalSetupAssignment[],
): TroubleBrewingDemonInfoFacts {
  if (assignments.length < 7) {
    throw new Error("Trouble Brewing standard Demon Info requires at least 7 players");
  }

  const demonAssignments = assignments.filter(
    assignment => troubleBrewingRole(assignment.actualRoleId).category === "demon",
  );
  if (demonAssignments.length !== 1) {
    throw new Error("Trouble Brewing Demon Info requires exactly one actual Demon");
  }

  const inPlayActualRoleIds = new Set(
    assignments.map(assignment => assignment.actualRoleId),
  );

  const legalBluffRoleIds = TROUBLE_BREWING_ROLES
    .filter(role => role.category === "townsfolk" || role.category === "outsider")
    .map(role => role.id)
    .filter(roleId => !inPlayActualRoleIds.has(roleId));

  if (legalBluffRoleIds.length < 3) {
    throw new Error("Trouble Brewing Demon Info requires at least three legal good bluffs");
  }

  return {
    demonPlayerId: demonAssignments[0]!.playerId,
    minionPlayerIds: assignments
      .filter(
        assignment =>
          troubleBrewingRole(assignment.actualRoleId).category === "minion",
      )
      .map(assignment => assignment.playerId),
    legalBluffRoleIds: [...legalBluffRoleIds],
  };
}

export type TroubleBrewingPairInformationAbilityRoleId =
  | "washerwoman"
  | "librarian"
  | "investigator";

export type TroubleBrewingPairInformationResolution = {
  matchingPlayerId: string;
  matchSource: TroubleBrewingCharacterRegistrationSource;
};

export type TroubleBrewingNoCharactersInformationResolution = {
  noCharacterCategory: "outsider";
  truthSource: "actual_state";
};

export type TroubleBrewingWasherwomanInformationResolution =
  TroubleBrewingPairInformationResolution;

export type TroubleBrewingInformationReliability =
  | "reliable"
  | "drunk"
  | "poisoned";

export type TroubleBrewingSemanticTruth =
  | "true"
  | "false"
  | "partially_true"
  | "not_applicable";

export type TroubleBrewingPairInformationCandidate = {
  candidateId: string;
  learnedRoleId: TroubleBrewingRoleId;
  shownPlayerIds: [string, string];
  legalResolutions: TroubleBrewingPairInformationResolution[];
};

export type TroubleBrewingNoCharactersInformationCandidate = {
  candidateId: string;
  noCharacterCategory: "outsider";
  legalResolutions: TroubleBrewingNoCharactersInformationResolution[];
};

export type TroubleBrewingInformationCandidate =
  | TroubleBrewingPairInformationCandidate
  | TroubleBrewingNoCharactersInformationCandidate;

export type TroubleBrewingWasherwomanInformationCandidate =
  TroubleBrewingPairInformationCandidate;

export type TroubleBrewingPairInformationResult =
  | {
      kind: "pair";
      abilityRoleId: TroubleBrewingPairInformationAbilityRoleId;
      recipientPlayerId: string;
      learnedRoleId: TroubleBrewingRoleId;
      shownPlayerIds: [string, string];
      reliability: TroubleBrewingInformationReliability;
      semanticTruth: TroubleBrewingSemanticTruth;
      selectedCandidateId: string;
      selectedResolution: TroubleBrewingPairInformationResolution;
    }
  | {
      kind: "no_characters";
      abilityRoleId: "librarian";
      recipientPlayerId: string;
      noCharacterCategory: "outsider";
      reliability: TroubleBrewingInformationReliability;
      semanticTruth: TroubleBrewingSemanticTruth;
      selectedCandidateId: string;
      selectedResolution: TroubleBrewingNoCharactersInformationResolution;
    };

export type TroubleBrewingWasherwomanInformationResult = Extract<
  TroubleBrewingPairInformationResult,
  { kind: "pair" }
> & {
  abilityRoleId: "washerwoman";
};

export function isTroubleBrewingPairCandidate(
  candidate: TroubleBrewingInformationCandidate,
): candidate is TroubleBrewingPairInformationCandidate {
  return "learnedRoleId" in candidate;
}

function pairInformationTargetCategory(
  abilityRoleId: TroubleBrewingPairInformationAbilityRoleId,
): "townsfolk" | "outsider" | "minion" {
  switch (abilityRoleId) {
    case "washerwoman":
      return "townsfolk";
    case "librarian":
      return "outsider";
    case "investigator":
      return "minion";
  }
}

/**
 * Generates the natural truthful information domain shared by Washerwoman,
 * Librarian and Investigator.
 *
 * Pair-visible statements are unique by learned character + shown player pair.
 * Multiple registration witnesses for the same visible statement are grouped
 * as legal resolutions so registration multiplicity never becomes accidental
 * recommendation weight.
 *
 * The information recipient remains a legal member of the shown pair. This is
 * required for valid Baron setups where the Washerwoman can be the only
 * Townsfolk in play and therefore must be able to learn themself plus one
 * other player. The optional recipient argument is retained at this boundary
 * to make that rule choice explicit for runtime callers.
 *
 * Librarian additionally has one typed "no Outsiders" candidate only when
 * there are no actual Outsiders in play. A Spy may still create registered-
 * Outsider pair candidates in that setup; registration does not invalidate
 * the natural zero-Outsider statement.
 */
export function createTroubleBrewingPairInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  abilityRoleId: TroubleBrewingPairInformationAbilityRoleId,
  _recipientPlayerId?: string,
): TroubleBrewingInformationCandidate[] {
  const targetCategory = pairInformationTargetCategory(abilityRoleId);
  const candidates = new Map<string, TroubleBrewingPairInformationCandidate>();

  assignments.forEach((matchingAssignment, matchingIndex) => {
    for (const registration of troubleBrewingCharacterRegistrations(
      matchingAssignment,
    )) {
      if (troubleBrewingRole(registration.roleId).category !== targetCategory) {
        continue;
      }

      assignments.forEach((otherAssignment, otherIndex) => {
        if (otherIndex === matchingIndex) {
          return;
        }

        const shownPlayerIds: [string, string] =
          matchingIndex < otherIndex
            ? [matchingAssignment.playerId, otherAssignment.playerId]
            : [otherAssignment.playerId, matchingAssignment.playerId];
        const key = JSON.stringify([
          registration.roleId,
          shownPlayerIds[0],
          shownPlayerIds[1],
        ]);

        const resolution: TroubleBrewingPairInformationResolution = {
          matchingPlayerId: matchingAssignment.playerId,
          matchSource: registration.source,
        };
        const existing = candidates.get(key);
        if (existing) {
          if (
            !existing.legalResolutions.some(
              item =>
                item.matchingPlayerId === resolution.matchingPlayerId &&
                item.matchSource === resolution.matchSource,
            )
          ) {
            existing.legalResolutions.push(resolution);
          }
          return;
        }

        candidates.set(key, {
          candidateId: `${abilityRoleId}:${registration.roleId}:${shownPlayerIds[0]}:${shownPlayerIds[1]}`,
          learnedRoleId: registration.roleId,
          shownPlayerIds,
          legalResolutions: [resolution],
        });
      });
    }
  });

  const pairCandidates = [...candidates.values()];
  if (
    abilityRoleId === "librarian" &&
    !assignments.some(
      assignment => troubleBrewingRole(assignment.actualRoleId).category === "outsider",
    )
  ) {
    const zeroCandidate: TroubleBrewingNoCharactersInformationCandidate = {
      candidateId: "librarian:no-outsiders",
      noCharacterCategory: "outsider",
      legalResolutions: [
        {
          noCharacterCategory: "outsider",
          truthSource: "actual_state",
        },
      ],
    };
    return [zeroCandidate, ...pairCandidates];
  }

  return pairCandidates;
}

export function createTroubleBrewingWasherwomanInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  recipientPlayerId?: string,
): TroubleBrewingWasherwomanInformationCandidate[] {
  return createTroubleBrewingPairInformationCandidates(
    assignments,
    "washerwoman",
    recipientPlayerId,
  ).filter(isTroubleBrewingPairCandidate);
}

export function createTroubleBrewingLibrarianInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  recipientPlayerId?: string,
): TroubleBrewingInformationCandidate[] {
  return createTroubleBrewingPairInformationCandidates(
    assignments,
    "librarian",
    recipientPlayerId,
  );
}

export function createTroubleBrewingInvestigatorInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
  recipientPlayerId?: string,
): TroubleBrewingPairInformationCandidate[] {
  return createTroubleBrewingPairInformationCandidates(
    assignments,
    "investigator",
    recipientPlayerId,
  ).filter(isTroubleBrewingPairCandidate);
}
