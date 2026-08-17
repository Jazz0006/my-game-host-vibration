import { configFromRoleDeck, type GameConfig, type Role } from "../../../domain/game.js";

/**
 * A script selects roles and counts for a concrete table setup.
 * Role behavior remains in the role registry; scripts only compose roles.
 */
export type WerewolfScriptDefinition = {
  id: string;
  name: string;
  description?: string;
  roleDeck: readonly Role[];
};

export function playerCountForScript(script: WerewolfScriptDefinition): number {
  return script.roleDeck.length;
}

export function configFromScript(script: WerewolfScriptDefinition): GameConfig {
  return configFromRoleDeck(playerCountForScript(script), script.roleDeck);
}
