import {
  isTroubleBrewingRoleId,
  troubleBrewingExpectedCounts,
  troubleBrewingRole,
  type BotcRoleCategory,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";

export type BotcSetupAssignment = {
  playerId: string;
  actualRoleId: TroubleBrewingRoleId;
  shownRoleId?: TroubleBrewingRoleId;
};

export type BotcCanonicalSetupAssignment = {
  playerId: string;
  actualRoleId: TroubleBrewingRoleId;
  shownRoleId: TroubleBrewingRoleId;
};

function unique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

/**
 * Validates and canonicalizes an already chosen Trouble Brewing setup.
 *
 * This is the setup-contract owner. It does not decide which roles or players
 * should be selected, advance gameplay, generate information, or make
 * storyteller recommendations.
 */
export function normalizeTroubleBrewingSetup(
  playerIds: readonly string[],
  assignments: readonly BotcSetupAssignment[],
): BotcCanonicalSetupAssignment[] {
  if (assignments.length !== playerIds.length) {
    throw new Error("BotC setup must assign exactly one role to every player");
  }

  unique(playerIds, "BotC player IDs must be unique");
  unique(
    assignments.map(assignment => assignment.playerId),
    "BotC setup contains duplicate player assignments",
  );

  const playerIdSet = new Set(playerIds);
  const normalized = assignments.map(assignment => {
    if (!playerIdSet.has(assignment.playerId)) {
      throw new Error("BotC setup assignment references a non-player");
    }
    if (!isTroubleBrewingRoleId(assignment.actualRoleId)) {
      throw new Error("BotC setup contains an unknown actual role");
    }

    if (assignment.actualRoleId === "drunk") {
      if (!assignment.shownRoleId) {
        throw new Error("Drunk setup requires a shown Townsfolk role");
      }
      const shown = troubleBrewingRole(assignment.shownRoleId);
      if (shown.category !== "townsfolk") {
        throw new Error("Drunk shown role must be a Townsfolk");
      }
      return {
        playerId: assignment.playerId,
        actualRoleId: assignment.actualRoleId,
        shownRoleId: assignment.shownRoleId,
      };
    }

    if (
      assignment.shownRoleId !== undefined &&
      assignment.shownRoleId !== assignment.actualRoleId
    ) {
      throw new Error("Only the Drunk may be shown a different setup role");
    }

    return {
      playerId: assignment.playerId,
      actualRoleId: assignment.actualRoleId,
      shownRoleId: assignment.actualRoleId,
    };
  });

  unique(
    normalized.map(assignment => assignment.actualRoleId),
    "Trouble Brewing setup cannot contain duplicate actual characters",
  );

  const actualRoles = normalized.map(assignment => assignment.actualRoleId);
  const drunk = normalized.find(assignment => assignment.actualRoleId === "drunk");
  if (drunk && actualRoles.includes(drunk.shownRoleId)) {
    throw new Error("Drunk shown Townsfolk character must not be actually in play");
  }

  const expected = troubleBrewingExpectedCounts(playerIds.length, actualRoles);
  const actual: Record<BotcRoleCategory, number> = {
    townsfolk: 0,
    outsider: 0,
    minion: 0,
    demon: 0,
  };

  for (const roleId of actualRoles) {
    actual[troubleBrewingRole(roleId).category] += 1;
  }

  for (const category of Object.keys(actual) as BotcRoleCategory[]) {
    if (actual[category] !== expected[category]) {
      throw new Error(
        `Illegal Trouble Brewing setup: expected ${expected[category]} ${category}, got ${actual[category]}`,
      );
    }
  }

  return normalized;
}
