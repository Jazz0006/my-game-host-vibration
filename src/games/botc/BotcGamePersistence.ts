import {
  BOTC_GAME_STATE_SCHEMA_VERSION,
  type BotcGameState,
} from "./BotcGameModule.js";
import {
  isTroubleBrewingRoleId,
  TROUBLE_BREWING_SCRIPT_ID,
} from "./TroubleBrewing.js";
import type { BotcNightInformationState } from "./BotcNightInformationRuntime.js";

/**
 * Internal Session format, independent of RoomSnapshot and TBGS V1 versions.
 * Unversioned games cannot recover their opening facts; reject them without
 * rewriting storage or guessing from current roles. Lobbies have no game.
 * This boundary checks opening/history structure, not gameplay progression.
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
  if (
    typeof state.interactionId !== "string" || !state.interactionId ||
    !Array.isArray(state.ghostVoteSpentPlayerIds) ||
    !state.history || !["from_creation", "from_upgrade"].includes(state.history.coverage) ||
    !Number.isSafeInteger(state.history.nextSequence) || state.history.nextSequence < 1 ||
    !Array.isArray(state.history.actions) || !Array.isArray(state.history.observations) ||
    !Array.isArray(state.history.notices) ||
    !Array.isArray(state.history.acknowledgedObservationIds)
  ) throw new Error("Invalid BotC history coverage or interaction");
  const records = [...state.history.actions, ...state.history.observations, ...state.history.notices];
  const known = records.filter(record => record.sequence !== null);
  if (known.length !== state.history.nextSequence - 1 ||
      new Set(records.map(record => record.recordId)).size !== records.length ||
      new Set(known.map(record => record.sequence)).size !== known.length ||
      known.some(record => !Number.isSafeInteger(record.sequence) || record.sequence! < 1 ||
        record.sequence! >= state.history!.nextSequence)) {
    throw new Error("Invalid BotC global history sequence");
  }
}

/** S1 archives contain real information, but no cross-action chronology. */
export function restoreBotcGameState(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1) {
    assertSupportedBotcGameState(value);
    return value;
  }
  const legacy = structuredClone(value) as Record<string, unknown>;
  if (!Array.isArray(legacy.informationHistory)) throw new Error("Invalid BotC S1 information history");
  const acknowledgedObservationIds: string[] = [];
  const observations = (legacy.informationHistory as BotcNightInformationState[]).map((item, index) => {
    const { acknowledged, ...content } = item;
    const recordId = `${legacy.gameId}:legacy-information:${index}`;
    if (acknowledged) acknowledgedObservationIds.push(recordId);
    return { ...content, recordId, sequence: null };
  });
  delete legacy.informationHistory;
  const restored = {
    ...legacy, schemaVersion: BOTC_GAME_STATE_SCHEMA_VERSION,
    ghostVoteSpentPlayerIds: [],
    interactionId: `${legacy.gameId}:interaction:upgrade`,
    history: { coverage: "from_upgrade", nextSequence: 1, actions: [], observations, notices: [], acknowledgedObservationIds },
  };
  assertSupportedBotcGameState(restored);
  return restored;
}
