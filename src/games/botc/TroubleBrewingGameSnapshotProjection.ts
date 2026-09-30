import type { BotcGameState } from "./BotcGameModule.js";
import {
  TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_ID,
  TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_VERSION,
  TROUBLE_BREWING_GAME_SNAPSHOT_SCRIPT_ID,
  type TroubleBrewingGameSnapshotV1,
  type TroubleBrewingSnapshotField,
  type TroubleBrewingSnapshotPhase,
  type TroubleBrewingSnapshotPosition,
  type TroubleBrewingSnapshotSeat,
} from "./TroubleBrewingGameSnapshot.js";

/**
 * Projection-only context that is owned outside BotcGameState.
 *
 * gameId, seed and persistence revisions are intentionally not invented by the
 * GameModule. A caller must supply the cross-project identity/seed when it has
 * an authoritative owner. Revisions may be omitted when this runtime has no
 * semantically equivalent producer; V1 then records NOT_APPLICABLE rather than
 * manufacturing a value.
 */
export type TroubleBrewingGameSnapshotProjectionContext = Readonly<{
  gameId: string;
  gameSeed: number;
  seatOrder: readonly string[];
  gameStateRevision?: number;
  playerInputRevision?: number;
}>;

const SNAPSHOT_NOT_APPLICABLE: TroubleBrewingSnapshotField<never> = {
  state: "NOT_APPLICABLE",
};

function known<T>(value: T): TroubleBrewingSnapshotField<T> {
  return { state: "KNOWN", value };
}

function notApplicable<T>(): TroubleBrewingSnapshotField<T> {
  return SNAPSHOT_NOT_APPLICABLE;
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertProjectionContext(
  state: BotcGameState,
  context: TroubleBrewingGameSnapshotProjectionContext,
): void {
  if (!context.gameId.trim()) {
    throw new Error("Trouble Brewing snapshot gameId cannot be blank");
  }
  if (!Number.isSafeInteger(context.gameSeed)) {
    throw new Error("Trouble Brewing snapshot gameSeed must be a safe integer");
  }
  if (context.seatOrder.length !== state.assignments.length) {
    throw new Error("Trouble Brewing snapshot seat order must cover every assignment");
  }
  if (new Set(context.seatOrder).size !== context.seatOrder.length) {
    throw new Error("Trouble Brewing snapshot seat order contains duplicate players");
  }

  const assignmentPlayers = new Set(
    state.assignments.map(assignment => assignment.playerId),
  );
  if (
    context.seatOrder.some(playerId => !assignmentPlayers.has(playerId)) ||
    state.assignments.some(assignment => !context.seatOrder.includes(assignment.playerId))
  ) {
    throw new Error("Trouble Brewing snapshot seat order must match canonical assignments");
  }

  if (context.gameStateRevision !== undefined) {
    assertNonNegativeSafeInteger(context.gameStateRevision, "gameStateRevision");
  }
  if (context.playerInputRevision !== undefined) {
    assertNonNegativeSafeInteger(context.playerInputRevision, "playerInputRevision");
  }
}

function runtimePosition(
  state: BotcGameState,
  context: TroubleBrewingGameSnapshotProjectionContext,
): TroubleBrewingSnapshotPosition {
  let phase: TroubleBrewingSnapshotPhase;
  let round: number;

  switch (state.phase) {
    case "first_night":
      phase = "NIGHT";
      round = state.nightNumber;
      break;
    case "other_night":
      phase = "NIGHT";
      round = state.nightNumber;
      break;
    case "day":
      phase = "DAY";
      round = state.dayNumber;
      break;
    case "role_reveal":
      throw new Error("role_reveal is not a runtime snapshot phase");
  }

  if (!Number.isSafeInteger(round) || round <= 0) {
    throw new Error("Known Trouble Brewing snapshot round must be a positive safe integer");
  }

  return {
    stage: "RUNTIME",
    phase: known(phase),
    round: known(round),
    gameStateRevision:
      context.gameStateRevision === undefined
        ? notApplicable()
        : known(context.gameStateRevision),
    playerInputRevision:
      context.playerInputRevision === undefined
        ? notApplicable()
        : known(context.playerInputRevision),
  };
}

function snapshotPosition(
  state: BotcGameState,
  context: TroubleBrewingGameSnapshotProjectionContext,
): TroubleBrewingSnapshotPosition {
  if (state.phase === "role_reveal") {
    return {
      stage: "SETUP_COMMITTED",
      phase: notApplicable(),
      round: notApplicable(),
      gameStateRevision: notApplicable(),
      playerInputRevision: notApplicable(),
    };
  }
  return runtimePosition(state, context);
}

/**
 * Pure projection from the online authoritative BotcGameState into the shared
 * TroubleBrewingGameSnapshotV1 read/interchange contract.
 *
 * This adapter owns no rules, random selection, persistence or client privacy
 * policy. It only maps already-authoritative facts into the exact V1 semantics.
 */
export function projectTroubleBrewingGameSnapshotV1(
  state: BotcGameState,
  context: TroubleBrewingGameSnapshotProjectionContext,
): TroubleBrewingGameSnapshotV1 {
  assertProjectionContext(state, context);

  const assignmentsByPlayerId = new Map(
    state.assignments.map(assignment => [assignment.playerId, assignment] as const),
  );
  const deadPlayerIds = new Set(state.deadPlayerIds);

  const grimoireSeats = context.seatOrder.map((playerId, index) => {
    const assignment = assignmentsByPlayerId.get(playerId);
    if (!assignment) {
      throw new Error("Trouble Brewing snapshot seat references a missing assignment");
    }

    return {
      seat: index + 1,
      shownRoleId: known(assignment.shownRoleId),
      actualRoleId: known(assignment.actualRoleId),
      alive: known(!deadPlayerIds.has(playerId)),
      poisoned: known(state.poisonedPlayerId === playerId),
    } satisfies TroubleBrewingSnapshotSeat;
  });

  const drunk = state.assignments.find(
    assignment => assignment.actualRoleId === "drunk",
  );
  const drunkSeat = drunk
    ? context.seatOrder.indexOf(drunk.playerId) + 1
    : undefined;
  if (drunk && (!drunkSeat || drunkSeat > grimoireSeats.length)) {
    throw new Error("Known Drunk assignment must reference a snapshot seat");
  }

  return {
    schemaId: TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_ID,
    schemaVersion: TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_VERSION,
    gameId: context.gameId,
    script: TROUBLE_BREWING_GAME_SNAPSHOT_SCRIPT_ID,
    gameSeed: context.gameSeed,
    position: snapshotPosition(state, context),
    grimoireSeats,
    setupState: {
      hasDrunk: known(Boolean(drunk)),
      drunkAssignmentSeat: drunk
        ? known(drunkSeat!)
        : notApplicable(),
    },
  };
}
