import crypto from "node:crypto";
import type { SessionTokenService } from "../../core/session/SessionTokenService.js";
import type { RuntimeRoom } from "./roomBridge.js";

const RECOVERY_CODE_SPACE = 1_000_000;
const RECOVERY_CODE_ATTEMPTS = 10;
export const IDENTITY_RECOVERY_TTL_MS = 5 * 60 * 1000;
export const IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS = 5;

type RecoveryGrant = {
  playerId: string;
  expiresAt: number;
};

const roomRecoveryGrants = new WeakMap<RuntimeRoom, Map<string, RecoveryGrant>>();
const roomFailedAttempts = new WeakMap<RuntimeRoom, number>();

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

function recordFailedAttempt(room: RuntimeRoom): void {
  const failedAttempts = (roomFailedAttempts.get(room) ?? 0) + 1;
  if (failedAttempts >= IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS) {
    grantsFor(room).clear();
    roomFailedAttempts.set(room, 0);
    return;
  }
  roomFailedAttempts.set(room, failedAttempts);
}

export async function issueIdentityRecoveryGrant(
  room: RuntimeRoom,
  playerId: string,
  sessionTokens: SessionTokenService,
  now = Date.now(),
): Promise<{ recoveryCode: string; expiresAt: number }> {
  removeExistingGrantForPlayer(room, playerId);
  roomFailedAttempts.set(room, 0);

  for (let attempt = 0; attempt < RECOVERY_CODE_ATTEMPTS; attempt += 1) {
    const recoveryCode = crypto.randomInt(RECOVERY_CODE_SPACE).toString().padStart(6, "0");
    const hash = await sessionTokens.hashSessionToken(recoveryCode);
    if (grantsFor(room).has(hash)) continue;

    const expiresAt = now + IDENTITY_RECOVERY_TTL_MS;
    grantsFor(room).set(hash, { playerId, expiresAt });
    return { recoveryCode, expiresAt };
  }

  throw new Error("Unable to allocate recovery code");
}

export async function consumeIdentityRecoveryGrant(
  room: RuntimeRoom,
  recoveryCode: string,
  sessionTokens: SessionTokenService,
  now = Date.now(),
): Promise<string | null> {
  const normalized = recoveryCode.trim();
  if (!/^\d{6}$/u.test(normalized)) {
    recordFailedAttempt(room);
    return null;
  }

  const hash = await sessionTokens.hashSessionToken(normalized);
  const grants = grantsFor(room);
  const grant = grants.get(hash);
  if (!grant) {
    recordFailedAttempt(room);
    return null;
  }

  // Consume before returning so concurrent/replayed claims cannot reuse the grant.
  grants.delete(hash);
  if (grant.expiresAt <= now) {
    recordFailedAttempt(room);
    return null;
  }

  roomFailedAttempts.set(room, 0);
  return grant.playerId;
}

export function invalidateIdentityRecoveryGrant(room: RuntimeRoom, playerId: string): void {
  removeExistingGrantForPlayer(room, playerId);
}
