import type { RoomPlayer, RoomState } from "./types.js";
import type { SessionTokenService } from "../session/SessionTokenService.js";

/**
 * Transport-independent credentials used to reclaim an existing room member.
 * A socket id is intentionally not part of this contract.
 */
export type RejoinCredentials = {
  roomId: string;
  playerId: string;
  rejoinToken: string;
};

/**
 * Stable room-member identity that survives socket replacement.
 */
export type RoomMemberIdentity = {
  playerId: string;
  displayName: string;
  isHost: boolean;
};

export function roomMemberIdentity(
  player: Pick<RoomPlayer, "id" | "name" | "isHost">,
): RoomMemberIdentity {
  return {
    playerId: player.id,
    displayName: player.name,
    isHost: player.isHost,
  };
}

/**
 * Authenticates a rejoin request against authoritative room membership.
 * The plaintext token is supplied by the client; only its hash is stored in the room.
 */
export async function authenticateRejoin<
  TGameState,
  TGameConfig,
  TPlayer extends RoomPlayer,
>(
  room: RoomState<TGameState, TGameConfig, TPlayer>,
  credentials: RejoinCredentials,
  tokens: SessionTokenService,
): Promise<TPlayer | undefined> {
  if (
    credentials.roomId !== room.id ||
    !credentials.playerId ||
    !credentials.rejoinToken
  ) {
    return undefined;
  }

  const player = room.players.find(item => item.id === credentials.playerId);
  if (!player) return undefined;

  const valid = await tokens
    .verifySessionToken(credentials.rejoinToken, player.resumeTokenHash)
    .catch(() => false);
  return valid ? player : undefined;
}
