import type { SessionTokenService } from "../../core/session/SessionTokenService.js";
import type { RuntimeRoom } from "./roomBridge.js";

const RECOVERY_GRANT_BYTES = 8;
export const IDENTITY_RECOVERY_TTL_MS = 5 * 60 * 1000;

type RecoveryGrant = {
  playerId: string;
  expiresAt: number;
};

const roomRecoveryGrants = new WeakMap<RuntimeRoom, Map<string, RecoveryGrant>>();

function grantsFor(room: RuntimeRoom): Map<string, RecoveryGrant> {
  let grants = roomRecoveryGrants.get(room);
  if (!grants) {
    grants = new Map<string, RecoveryGrant>();
    roomRecoveryGrants.set(room, grants);
  }
  return grants;
}

function removeExistingGrantForPlayer(room: RuntimeRoom, playerId: string): void {
  const grants = grantsFor(room);
  for (const [hash, grant] of grants) {
    if (grant.playerId === playerId) grants.delete(hash);
  }
}

export async function issueIdentityRecoveryGrant(
  room: RuntimeRoom,
  playerId: string,
  sessionTokens: SessionTokenService,
  now = Date.now(),
): Promise<{ recoveryCode: string; expiresAt: number }> {
  removeExistingGrantForPlayer(room, playerId);
  const token = await sessionTokens.createSessionToken(RECOVERY_GRANT_BYTES);
  const expiresAt = now + IDENTITY_RECOVERY_TTL_MS;
  grantsFor(room).set(token.hash, { playerId, expiresAt });
  return { recoveryCode: token.token, expiresAt };
}

export async function consumeIdentityRecoveryGrant(
  room: RuntimeRoom,
  recoveryCode: string,
  sessionTokens: SessionTokenService,
  now = Date.now(),
): Promise<string | null> {
  const normalized = recoveryCode.trim();
  if (!normalized) return null;

  const hash = await sessionTokens.hashSessionToken(normalized);
  const grants = grantsFor(room);
  const grant = grants.get(hash);
  if (!grant) return null;

  // Consume before returning so concurrent/replayed claims cannot reuse the grant.
  grants.delete(hash);
  if (grant.expiresAt <= now) return null;
  return grant.playerId;
}

export function invalidateIdentityRecoveryGrant(room: RuntimeRoom, playerId: string): void {
  removeExistingGrantForPlayer(room, playerId);
}
