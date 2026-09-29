import crypto from "node:crypto";
import type { SessionTokenService } from "../../core/session/SessionTokenService.js";
import {
  IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS,
  IDENTITY_RECOVERY_TTL_MS,
  IdentityRecoveryService,
  type IdentityRecoveryState,
  type IdentityRecoveryStateRepository,
} from "../shared/IdentityRecoveryService.js";
import type { RuntimeRoom } from "./roomBridge.js";

export {
  IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS,
  IDENTITY_RECOVERY_TTL_MS,
} from "../shared/IdentityRecoveryService.js";

const roomRecoveryState = new WeakMap<RuntimeRoom, IdentityRecoveryState>();

class NodeIdentityRecoveryRepository implements IdentityRecoveryStateRepository {
  constructor(private readonly room: RuntimeRoom) {}

  async load(): Promise<IdentityRecoveryState | undefined> {
    return roomRecoveryState.get(this.room);
  }

  async save(state: IdentityRecoveryState): Promise<void> {
    roomRecoveryState.set(this.room, state);
  }

  async clear(): Promise<void> {
    roomRecoveryState.delete(this.room);
  }
}

function recoveryService(
  room: RuntimeRoom,
  sessionTokens: SessionTokenService,
  now: () => number = Date.now,
): IdentityRecoveryService {
  return new IdentityRecoveryService(
    sessionTokens,
    new NodeIdentityRecoveryRepository(room),
    {
      createRecoveryCode: () => crypto.randomInt(1_000_000).toString().padStart(6, "0"),
      now,
    },
  );
}

function isPlayerConnected(room: RuntimeRoom, playerId: string): boolean {
  const player = room.players.find(candidate => candidate.id === playerId);
  return Boolean(player?.connected || player?.socketId);
}

export async function issueIdentityRecovery(
  room: RuntimeRoom,
  actorPlayerId: string,
  targetPlayerId: string,
  sessionTokens: SessionTokenService,
  now = Date.now(),
): Promise<{ recoveryCode: string; expiresAt: number }> {
  return recoveryService(room, sessionTokens, () => now).issue(
    room.players,
    actorPlayerId,
    targetPlayerId,
    { isPlayerConnected: playerId => isPlayerConnected(room, playerId) },
  );
}

export async function claimIdentityRecovery(
  room: RuntimeRoom,
  recoveryCode: string,
  sessionTokens: SessionTokenService,
  now = Date.now(),
): Promise<{ playerId: string; resumeToken: string }> {
  const claim = await recoveryService(room, sessionTokens, () => now).claim(
    room.players,
    recoveryCode,
    { isPlayerConnected: playerId => isPlayerConnected(room, playerId) },
  );
  const player = room.players.find(candidate => candidate.id === claim.playerId);
  if (!player) throw new Error("identity recovery player disappeared");
  player.resumeTokenHash = claim.resumeTokenHash;
  return { playerId: claim.playerId, resumeToken: claim.resumeToken };
}

export async function invalidateIdentityRecoveryGrant(
  room: RuntimeRoom,
  playerId: string,
  sessionTokens: SessionTokenService,
): Promise<void> {
  await recoveryService(room, sessionTokens).invalidate(playerId);
}

