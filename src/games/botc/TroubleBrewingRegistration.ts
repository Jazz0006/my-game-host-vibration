import {
  TROUBLE_BREWING_ROLES,
  type TroubleBrewingRoleId,
} from "./TroubleBrewing.js";
import type { BotcCanonicalSetupAssignment } from "./TroubleBrewingSetup.js";

export type TroubleBrewingCharacterRegistrationSource =
  | "actual"
  | "spy"
  | "recluse";

export type TroubleBrewingCharacterRegistration = {
  roleId: TroubleBrewingRoleId;
  source: TroubleBrewingCharacterRegistrationSource;
};

/**
 * Returns the character identities this player may register as in Trouble
 * Brewing.
 *
 * This is a concrete Trouble Brewing rules seam, not a generic registration
 * DSL. Canonical actual identity remains unchanged; registration is contextual
 * information/effect resolution only.
 */
export function troubleBrewingCharacterRegistrations(
  assignment: BotcCanonicalSetupAssignment,
): TroubleBrewingCharacterRegistration[] {
  const registrations: TroubleBrewingCharacterRegistration[] = [
    {
      roleId: assignment.actualRoleId,
      source: "actual",
    },
  ];

  if (assignment.actualRoleId === "spy") {
    registrations.push(
      ...TROUBLE_BREWING_ROLES
        .filter(
          role =>
            role.category === "townsfolk" ||
            role.category === "outsider",
        )
        .map(role => ({
          roleId: role.id,
          source: "spy" as const,
        })),
    );
  }

  if (assignment.actualRoleId === "recluse") {
    registrations.push(
      ...TROUBLE_BREWING_ROLES
        .filter(
          role => role.category === "minion" || role.category === "demon",
        )
        .map(role => ({
          roleId: role.id,
          source: "recluse" as const,
        })),
    );
  }

  return registrations;
}
