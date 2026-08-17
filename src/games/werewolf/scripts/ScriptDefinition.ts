import { configFromRoleDeck, type GameConfig, type Role } from "../../../domain/game.js";

/**
 * A script selects roles and counts for a concrete table setup.
 * Role behavior remains in the role registry; scripts only compose roles.
 *
 * The generic role id lets architecture spikes compose roles that have not yet
 * been added to the legacy domain Role union. Production config conversion stays
 * intentionally restricted to legacy Role until that migration is ready.
 */
export type WerewolfScriptDefinition<TRoleId extends string = Role> = {
  id: string;
  name: string;
  description?: string;
  roleDeck: readonly TRoleId[];
};

export function playerCountForScript<TRoleId extends string>(
  script: WerewolfScriptDefinition<TRoleId>,
): number {
  return script.roleDeck.length;
}

export function configFromScript(script: WerewolfScriptDefinition<Role>): GameConfig {
  return configFromRoleDeck(playerCountForScript(script), script.roleDeck);
}
