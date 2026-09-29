import type { RoomPlayer } from "../../core/room/types.js";
import type { SessionTokenService } from "../../core/session/SessionTokenService.js";

const RECOVERY_CODE_ATTEMPTS = 10;

export const IDENTITY_RECOVERY_TTL_MS = 5 * 60 * 1000;
export const IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS = 5;

export type IdentityRecoveryGrant = {
  playerId: string;
  expiresAt: number;
};

export type IdentityRecoveryState = {
  version: 1;
  grants: Record<string, IdentityRecoveryGrant>;
  failedAttempts: number;
};

export interface IdentityRecoveryStateRepository {
  load(): Promise<IdentityRecoveryState | undefined>;
  save(state: IdentityRecoveryState): Promise<void>;
  clear(): Promise<void>;
}

export type IdentityRecoveryDependencies = {
  isPlayerConnected(playerId: string): boolean;
};

export type IdentityRecoveryServiceOptions = {
  createRecoveryCode(): string;
  now?: () => number;
};

export type IdentityRecoveryClaim = {
  playerId: string;
  resumeToken: string;
  resumeTokenHash: string;
};

export type IdentityRecoveryErrorCode =
  | "not_recovery_controller"
  | "invalid_target"
  | "target_online"
  | "invalid_or_expired"
  | "target_unavailable"
  | "credential_rotation_failed";

export class IdentityRecoveryError extends Error {
  constructor(
    readonly code: IdentityRecoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityRecoveryError";
  }
}

type IdentityRecoveryMember = Pick<RoomPlayer, "id" | "isHost" | "resumeTokenHash">;

function emptyState(): IdentityRecoveryState {
  return {
    version: 1,
    grants: {},
    failedAttempts: 0,
  };
}

function removeGrantForPlayer(
  state: IdentityRecoveryState,
  playerId: string,
): boolean {
  let changed = false;
  for (const [hash, grant] of Object.entries(state.grants)) {
    if (grant.playerId !== playerId) continue;
    delete state.grants[hash];
    changed = true;
  }
  return changed;
}

function recordFailedAttempt(state: IdentityRecoveryState): void {
  state.failedAttempts += 1;
  if (state.failedAttempts < IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS) return;
  state.grants = {};
  state.failedAttempts = 0;
}

/**
 * Game-neutral room identity recovery semantics.
 *
 * Runtime adapters own transport authentication, persistence wiring and live
 * socket replacement. This service owns one-time grant lifecycle, recovery
 * authorization, replay/guess protection and resume-credential rotation.
 */
export class IdentityRecoveryService {
  private readonly now: () => number;

  constructor(
    private readonly sessionTokens: SessionTokenService,
    private readonly repository: IdentityRecoveryStateRepository,
    private readonly options: IdentityRecoveryServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async issue(
    members: readonly IdentityRecoveryMember[],
    actorPlayerId: string,
    targetPlayerId: string,
    dependencies: IdentityRecoveryDependencies,
  ): Promise<{ recoveryCode: string; expiresAt: number }> {
    const actor = members.find(member => member.id === actorPlayerId);
    if (!actor?.isHost) {
      throw new IdentityRecoveryError(
        "not_recovery_controller",
        "只有房主可以协助恢复身份",
      );
    }

    const target = members.find(member => member.id === targetPlayerId);
    if (!target || target.id === actor.id || target.isHost) {
      throw new IdentityRecoveryError("invalid_target", "请选择一名其他玩家");
    }
    if (dependencies.isPlayerConnected(target.id)) {
      throw new IdentityRecoveryError(
        "target_online",
        "该玩家当前在线，不需要恢复身份",
      );
    }

    const state = await this.repository.load() ?? emptyState();
    removeGrantForPlayer(state, target.id);
    state.failedAttempts = 0;

    for (let attempt = 0; attempt < RECOVERY_CODE_ATTEMPTS; attempt += 1) {
      const recoveryCode = this.options.createRecoveryCode();
      if (!/^\d{6}$/u.test(recoveryCode)) {
        throw new Error("recovery code generator must return exactly six digits");
      }
      const hash = await this.sessionTokens.hashSessionToken(recoveryCode);
      if (state.grants[hash]) continue;

      const expiresAt = this.now() + IDENTITY_RECOVERY_TTL_MS;
      state.grants[hash] = { playerId: target.id, expiresAt };
      await this.repository.save(state);
      return { recoveryCode, expiresAt };
    }

    throw new Error("Unable to allocate recovery code");
  }

  async claim(
    members: readonly IdentityRecoveryMember[],
    recoveryCode: string,
    dependencies: IdentityRecoveryDependencies,
  ): Promise<IdentityRecoveryClaim> {
    const state = await this.repository.load() ?? emptyState();
    const normalized = recoveryCode.trim();

    if (!/^\d{6}$/u.test(normalized)) {
      recordFailedAttempt(state);
      await this.repository.save(state);
      throw new IdentityRecoveryError(
        "invalid_or_expired",
        "恢复码无效或已过期",
      );
    }

    const hash = await this.sessionTokens.hashSessionToken(normalized);
    const grant = state.grants[hash];
    if (!grant) {
      recordFailedAttempt(state);
      await this.repository.save(state);
      throw new IdentityRecoveryError(
        "invalid_or_expired",
        "恢复码无效或已过期",
      );
    }

    // Consume before any later validation so concurrent/replayed claims cannot
    // reuse the same recovery capability.
    delete state.grants[hash];
    if (grant.expiresAt <= this.now()) {
      recordFailedAttempt(state);
      await this.repository.save(state);
      throw new IdentityRecoveryError(
        "invalid_or_expired",
        "恢复码无效或已过期",
      );
    }

    const target = members.find(member => member.id === grant.playerId);
    if (!target || target.isHost || dependencies.isPlayerConnected(grant.playerId)) {
      await this.repository.save(state);
      throw new IdentityRecoveryError(
        "target_unavailable",
        "该身份当前无法恢复，请让房主重新生成恢复码",
      );
    }

    let replacement;
    try {
      replacement = await this.sessionTokens.createSessionToken();
    } catch {
      await this.repository.save(state);
      throw new IdentityRecoveryError(
        "credential_rotation_failed",
        "恢复身份失败，请让房主重新生成恢复码",
      );
    }

    state.failedAttempts = 0;
    await this.repository.save(state);
    return {
      playerId: target.id,
      resumeToken: replacement.token,
      resumeTokenHash: replacement.hash,
    };
  }

  async invalidate(playerId: string): Promise<void> {
    const state = await this.repository.load();
    if (!state || !removeGrantForPlayer(state, playerId)) return;
    await this.repository.save(state);
  }

  clear(): Promise<void> {
    return this.repository.clear();
  }
}
