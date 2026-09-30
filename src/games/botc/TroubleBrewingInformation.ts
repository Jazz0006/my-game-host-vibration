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

export type TroubleBrewingWasherwomanInformationResolution = {
  matchingPlayerId: string;
  matchSource: TroubleBrewingCharacterRegistrationSource;
};

export type TroubleBrewingWasherwomanInformationCandidate = {
  learnedRoleId: TroubleBrewingRoleId;
  shownPlayerIds: [string, string];
  legalResolutions: TroubleBrewingWasherwomanInformationResolution[];
};

/**
 * Generates all distinct truthful Washerwoman information choices for the
 * current Trouble Brewing canonical setup.
 *
 * Player-visible information is unique by learned Townsfolk + shown pair.
 * When the same visible statement can be made true in multiple ways (for
 * example an actual Chef and a Spy registering as Chef), those possibilities
 * are grouped as legal resolutions instead of duplicated as recommendation
 * candidates. This prevents registration multiplicity from accidentally
 * becoming recommendation weight.
 */
export function createTroubleBrewingWasherwomanInformationCandidates(
  assignments: readonly BotcCanonicalSetupAssignment[],
): TroubleBrewingWasherwomanInformationCandidate[] {
  const candidates = new Map<
    string,
    TroubleBrewingWasherwomanInformationCandidate
  >();

  assignments.forEach((matchingAssignment, matchingIndex) => {
    for (const registration of troubleBrewingCharacterRegistrations(
      matchingAssignment,
    )) {
      if (troubleBrewingRole(registration.roleId).category !== "townsfolk") {
        continue;
      }

      assignments.forEach((otherAssignment, otherIndex) => {
        if (otherIndex === matchingIndex) return;

        const shownPlayerIds: [string, string] =
          matchingIndex < otherIndex
            ? [matchingAssignment.playerId, otherAssignment.playerId]
            : [otherAssignment.playerId, matchingAssignment.playerId];
        const key = JSON.stringify([
          registration.roleId,
          shownPlayerIds[0],
          shownPlayerIds[1],
        ]);

        const resolution: TroubleBrewingWasherwomanInformationResolution = {
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
          learnedRoleId: registration.roleId,
          shownPlayerIds,
          legalResolutions: [resolution],
        });
      });
    }
  });

  return [...candidates.values()];
}
