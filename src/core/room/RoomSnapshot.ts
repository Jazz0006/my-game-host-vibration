import type { RoomPlayer } from "./types.js";

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
> = {
  revision: number;
  metadata: RoomSnapshotMetadata;
  membership: RoomSnapshotMember[];
  gameConfig: TGameConfig;
  game?: TGameState;
  ruleState?: TRuleState;
  pendingInteraction?: TPendingInteraction;
};

export function nextRoomRevision(currentRevision: number): number {
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
    throw new Error("room revision must be a non-negative safe integer");
  }
  return currentRevision + 1;
}
