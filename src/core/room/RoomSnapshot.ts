import type { RoomPlayer, RoomState } from "./types.js";

export type RoomSnapshotMetadata = {
  roomId: string;
  gameType: string;
  createdAt: number;
  updatedAt: number;
};

export type RoomSnapshotMember = Pick<
  RoomPlayer,
  "id" | "name" | "seat" | "isHost" | "resumeTokenHash"
>;

/**
 * Authoritative room recovery payload. Transport-only connection state is
 * intentionally excluded; sockets are rebound after identity authentication.
 */
export type RoomSnapshot<
  TGameState = unknown,
  TGameConfig = unknown,
  TRuleState = unknown,
  TPendingInteraction = unknown,
  TCommandReceipt = unknown,
> = {
  revision: number;
  metadata: RoomSnapshotMetadata;
  membership: RoomSnapshotMember[];
  gameConfig: TGameConfig;
  game?: TGameState;
  ruleState?: TRuleState;
  pendingInteraction?: TPendingInteraction;
  /** Bounded C3 dedupe receipts; never an unbounded event history. */
  commandReceipts?: TCommandReceipt[];
};

export type CreateRoomSnapshotOptions<
  TRuleState,
  TPendingInteraction,
  TCommandReceipt = unknown,
> = {
  revision: number;
  ruleState?: TRuleState;
  pendingInteraction?: TPendingInteraction;
  commandReceipts?: TCommandReceipt[];
};

export type RestoredRoomSnapshot<
  TGameState,
  TGameConfig,
  TRuleState,
  TPendingInteraction,
  TCommandReceipt = unknown,
> = {
  revision: number;
  room: RoomState<TGameState, TGameConfig, RoomPlayer>;
  ruleState?: TRuleState;
  pendingInteraction?: TPendingInteraction;
  commandReceipts?: TCommandReceipt[];
};

function assertRoomRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("room revision must be a non-negative safe integer");
  }
}

export function nextRoomRevision(currentRevision: number): number {
  assertRoomRevision(currentRevision);
  if (currentRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error("room revision cannot advance beyond the safe integer range");
  }
  return currentRevision + 1;
}

/**
 * Projects a room into the platform-neutral data required to recover it.
 * Extra runtime fields on players (for example socketId/connected) are dropped.
 *
 * Game/config/rule/interaction/receipt values are treated as immutable snapshot
 * inputs; the eventual persistence adapter is responsible for serialization.
 */
export function createRoomSnapshot<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
  TRuleState = unknown,
  TPendingInteraction = unknown,
  TCommandReceipt = unknown,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
  options: CreateRoomSnapshotOptions<TRuleState, TPendingInteraction, TCommandReceipt>,
): RoomSnapshot<TGameState, TGameConfig, TRuleState, TPendingInteraction, TCommandReceipt> {
  assertRoomRevision(options.revision);

  return {
    revision: options.revision,
    metadata: {
      roomId: room.id,
      gameType: room.gameType,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    },
    membership: room.players.map(player => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      isHost: player.isHost,
      resumeTokenHash: player.resumeTokenHash,
    })),
    gameConfig: room.gameConfig,
    ...(room.game === undefined ? {} : { game: room.game }),
    ...(options.ruleState === undefined ? {} : { ruleState: options.ruleState }),
    ...(options.pendingInteraction === undefined
      ? {}
      : { pendingInteraction: options.pendingInteraction }),
    ...(options.commandReceipts === undefined
      ? {}
      : { commandReceipts: options.commandReceipts }),
  };
}

/**
 * Restores platform-neutral authoritative state. Runtime connection state is
 * deliberately not reconstructed here; after restoration each runtime must
 * rebind socket/client transport state through the C1 identity contract.
 */
export function restoreRoomSnapshot<
  TGameState,
  TGameConfig,
  TRuleState = unknown,
  TPendingInteraction = unknown,
  TCommandReceipt = unknown,
>(
  snapshot: RoomSnapshot<
    TGameState,
    TGameConfig,
    TRuleState,
    TPendingInteraction,
    TCommandReceipt
  >,
): RestoredRoomSnapshot<
  TGameState,
  TGameConfig,
  TRuleState,
  TPendingInteraction,
  TCommandReceipt
> {
  assertRoomRevision(snapshot.revision);

  return {
    revision: snapshot.revision,
    room: {
      id: snapshot.metadata.roomId,
      gameType: snapshot.metadata.gameType,
      players: snapshot.membership.map(member => ({ ...member })),
      createdAt: snapshot.metadata.createdAt,
      updatedAt: snapshot.metadata.updatedAt,
      gameConfig: snapshot.gameConfig,
      ...(snapshot.game === undefined ? {} : { game: snapshot.game }),
    },
    ...(snapshot.ruleState === undefined ? {} : { ruleState: snapshot.ruleState }),
    ...(snapshot.pendingInteraction === undefined
      ? {}
      : { pendingInteraction: snapshot.pendingInteraction }),
    ...(snapshot.commandReceipts === undefined
      ? {}
      : { commandReceipts: snapshot.commandReceipts }),
  };
}
