import {
  TROUBLE_BREWING_ROLES,
  troubleBrewingRole,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";

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
