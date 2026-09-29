import {
  nextRoomRevision,
  type RoomSnapshot,
} from "../../core/room/RoomSnapshot.js";
import type { SessionTokenService } from "../../core/session/SessionTokenService.js";
import {
  IdentityRecoveryService,
  type IdentityRecoveryDependencies,
} from "../shared/IdentityRecoveryService.js";
import { CloudflareIdentityRecoveryRepository } from "./CloudflareIdentityRecoveryRepository.js";
import {
  CloudflareRoomSnapshotRepository,
  type DurableObjectStorageLike,
} from "./CloudflareRoomSnapshotRepository.js";

export type CloudflareIdentityRecoverySession = {
  roomId: string;
  playerId: string;
  resumeToken: string;
  name: string;
  seat: number;
  isHost: boolean;
  revision: number;
};

export type CloudflareIdentityRecoveryClaimResult = {
  session: CloudflareIdentityRecoverySession;
  snapshot: RoomSnapshot;
};

function createRecoveryCode(): string {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return String(value[0]! % 1_000_000).padStart(6, "0");
}

/**
 * Cloudflare adapter for the shared identity-recovery semantic owner.
 *
 * Recovery grant/attempt state is persisted outside the game snapshot so a DO
 * eviction cannot lose a live recovery contract.
 */
export class CloudflareIdentityRecoveryRuntime {
  private readonly snapshots: CloudflareRoomSnapshotRepository;
  private readonly recovery: IdentityRecoveryService;

  constructor(
    storage: DurableObjectStorageLike,
    private readonly sessionTokens: SessionTokenService,
    private readonly dependencies: IdentityRecoveryDependencies,
    now: () => number = Date.now,
  ) {
    this.snapshots = new CloudflareRoomSnapshotRepository(storage);
    this.recovery = new IdentityRecoveryService(
      sessionTokens,
      new CloudflareIdentityRecoveryRepository(storage),
      { createRecoveryCode, now },
    );
  }

  async issue(
    actorPlayerId: string,
    actorResumeToken: string,
    targetPlayerId: string,
  ): Promise<{ recoveryCode: string; expiresAt: number }> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room_not_found");

    const actor = snapshot.membership.find(member => member.id === actorPlayerId);
    const validActor = actor
      ? await this.sessionTokens.verifySessionToken(
        actorResumeToken,
        actor.resumeTokenHash,
      )
      : false;
    if (!validActor) throw new Error("invalid_session");

    return this.recovery.issue(
      snapshot.membership,
      actorPlayerId,
      targetPlayerId,
      this.dependencies,
    );
  }

  async claim(recoveryCode: string): Promise<CloudflareIdentityRecoveryClaimResult> {
    const snapshot = await this.snapshots.load();
    if (!snapshot) throw new Error("room_not_found");

    const claim = await this.recovery.claim(
      snapshot.membership,
      recoveryCode,
      this.dependencies,
    );
    const target = snapshot.membership.find(member => member.id === claim.playerId);
    if (!target) throw new Error("room_member_missing");

    const revision = nextRoomRevision(snapshot.revision);
    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      revision,
      metadata: {
        ...snapshot.metadata,
        updatedAt: Date.now(),
      },
      membership: snapshot.membership.map(member => (
        member.id === claim.playerId
          ? { ...member, resumeTokenHash: claim.resumeTokenHash }
          : member
      )),
    };
    await this.snapshots.save(nextSnapshot);

    return {
      session: {
        roomId: snapshot.metadata.roomId,
        playerId: target.id,
        resumeToken: claim.resumeToken,
        name: target.name,
        seat: target.seat,
        isHost: target.isHost,
        revision,
      },
      snapshot: nextSnapshot,
    };
  }

  invalidate(playerId: string): Promise<void> {
    return this.recovery.invalidate(playerId);
  }

  clear(): Promise<void> {
    return this.recovery.clear();
  }
}
