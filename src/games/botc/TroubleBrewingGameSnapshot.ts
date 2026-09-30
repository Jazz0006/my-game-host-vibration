export const TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_ID = "botc.tb.game-snapshot";
export const TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_VERSION = 1;
export const TROUBLE_BREWING_GAME_SNAPSHOT_SCRIPT_ID = "trouble_brewing";

export type TroubleBrewingSnapshotField<T> =
  | Readonly<{ state: "KNOWN"; value: T }>
  | Readonly<{ state: "UNCOMMITTED" }>
  | Readonly<{ state: "UNKNOWN" }>
  | Readonly<{ state: "NOT_APPLICABLE" }>;

export type TroubleBrewingSnapshotStage =
  | "SETUP_PRECOMMIT"
  | "SETUP_COMMITTED"
  | "RUNTIME";

export type TroubleBrewingSnapshotPhase = "DAY" | "NIGHT";

export type TroubleBrewingSnapshotPosition = Readonly<{
  stage: TroubleBrewingSnapshotStage;
  phase: TroubleBrewingSnapshotField<TroubleBrewingSnapshotPhase>;
  round: TroubleBrewingSnapshotField<number>;
  gameStateRevision: TroubleBrewingSnapshotField<number>;
  playerInputRevision: TroubleBrewingSnapshotField<number>;
}>;

export type TroubleBrewingSnapshotSeat = Readonly<{
  seat: number;
  shownRoleId: TroubleBrewingSnapshotField<string>;
  actualRoleId: TroubleBrewingSnapshotField<string>;
  alive: TroubleBrewingSnapshotField<boolean>;
  poisoned: TroubleBrewingSnapshotField<boolean>;
}>;

export type TroubleBrewingSnapshotSetupState = Readonly<{
  hasDrunk: TroubleBrewingSnapshotField<boolean>;
  drunkAssignmentSeat: TroubleBrewingSnapshotField<number>;
}>;

export type TroubleBrewingGameSnapshotV1 = Readonly<{
  schemaId: typeof TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_ID;
  schemaVersion: typeof TROUBLE_BREWING_GAME_SNAPSHOT_SCHEMA_VERSION;
  gameId: string;
  script: typeof TROUBLE_BREWING_GAME_SNAPSHOT_SCRIPT_ID;
  gameSeed: number;
  position: TroubleBrewingSnapshotPosition;
  grimoireSeats: readonly TroubleBrewingSnapshotSeat[];
  setupState: TroubleBrewingSnapshotSetupState;
}>;

/**
 * Deterministic V1 JSON interchange encoding. Property insertion order mirrors
 * the frozen Host V1 codec so cross-project golden fixtures can compare bytes.
 */
export function encodeTroubleBrewingGameSnapshotV1(
  snapshot: TroubleBrewingGameSnapshotV1,
): string {
  return JSON.stringify({
    schemaId: snapshot.schemaId,
    schemaVersion: snapshot.schemaVersion,
    gameId: snapshot.gameId,
    script: snapshot.script,
    gameSeed: snapshot.gameSeed,
    position: {
      stage: snapshot.position.stage,
      phase: snapshot.position.phase,
      round: snapshot.position.round,
      gameStateRevision: snapshot.position.gameStateRevision,
      playerInputRevision: snapshot.position.playerInputRevision,
    },
    grimoireSeats: snapshot.grimoireSeats.map(seat => ({
      seat: seat.seat,
      shownRoleId: seat.shownRoleId,
      actualRoleId: seat.actualRoleId,
      alive: seat.alive,
      poisoned: seat.poisoned,
    })),
    setupState: {
      hasDrunk: snapshot.setupState.hasDrunk,
      drunkAssignmentSeat: snapshot.setupState.drunkAssignmentSeat,
    },
  });
}
