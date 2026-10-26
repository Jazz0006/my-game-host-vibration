import {
  BOTC_GAME_STATE_SCHEMA_VERSION,
  type BotcGameState,
} from "./BotcGameModule.js";
import {
  isTroubleBrewingRoleId,
  TROUBLE_BREWING_SCRIPT_ID,
} from "./TroubleBrewing.js";

/**
 * Internal Session format, independent of RoomSnapshot and TBGS V1 versions.
 * Unversioned games cannot recover their opening facts; reject them without
 * rewriting storage or guessing from current roles. Lobbies have no game.
 * This boundary checks the S1 envelope, not gameplay legality or progression.
 */
export function assertSupportedBotcGameState(value: unknown): void {
  if (
    !value || typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== BOTC_GAME_STATE_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported BotC game state version; unversioned games require a new game");
  }

  const state = value as Partial<BotcGameState>;
  const initial = state.initialSetup;
  if (
    typeof state.gameId !== "string" || !state.gameId.trim() ||
    state.scriptId !== TROUBLE_BREWING_SCRIPT_ID ||
    !initial || initial.config?.scriptId !== TROUBLE_BREWING_SCRIPT_ID ||
    !Array.isArray(initial.seatingPlayerIds) ||
    !Array.isArray(initial.assignments)
  ) {
    throw new Error("Invalid BotC game identity or initial setup");
  }

  const ids = initial.seatingPlayerIds;
  if (
    ids.length < 5 || ids.length > 15 ||
    ids.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(ids).size !== ids.length ||
    initial.assignments.length !== ids.length ||
    new Set(initial.assignments.map(assignment => assignment?.playerId)).size !== ids.length ||
    initial.assignments.some(assignment =>
      !assignment || !ids.includes(assignment.playerId) ||
      !isTroubleBrewingRoleId(assignment.actualRoleId) ||
      !isTroubleBrewingRoleId(assignment.shownRoleId),
    )
  ) {
    throw new Error("Invalid BotC initial participants or assignments");
  }
}
