import { describe, expect, it } from "vitest";
import { SessionTokenService } from "../src/core/session/SessionTokenService.js";
import { NodeSessionTokenCryptoProvider } from "../src/runtime/node/NodeSessionTokenCryptoProvider.js";
import {
  IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS,
  IDENTITY_RECOVERY_TTL_MS,
  IdentityRecoveryError,
  IdentityRecoveryService,
  type IdentityRecoveryState,
  type IdentityRecoveryStateRepository,
} from "../src/runtime/shared/IdentityRecoveryService.js";

class MemoryRecoveryRepository implements IdentityRecoveryStateRepository {
  state: IdentityRecoveryState | undefined;

  async load(): Promise<IdentityRecoveryState | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: IdentityRecoveryState): Promise<void> {
    this.state = structuredClone(state);
  }

  async clear(): Promise<void> {
    this.state = undefined;
  }
}

function members() {
  return [
    {
      id: "host",
      name: "Host",
      seat: 1,
      isHost: true,
      resumeTokenHash: "a".repeat(64),
    },
    {
      id: "player-1",
      name: "Player",
      seat: 2,
      isHost: false,
      resumeTokenHash: "b".repeat(64),
    },
  ];
}

function service(repository: MemoryRecoveryRepository, now: () => number) {
  let nextCode = 100000;
  return new IdentityRecoveryService(
    new SessionTokenService(new NodeSessionTokenCryptoProvider()),
    repository,
    {
      createRecoveryCode: () => String(nextCode++).padStart(6, "0"),
      now,
    },
  );
}

describe("W3D3 shared identity recovery service", () => {
  it("issues a six-digit one-time grant and rotates the resume credential on claim", async () => {
    const repository = new MemoryRecoveryRepository();
    let now = 1_000;
    const recovery = service(repository, () => now);
    const roomMembers = members();

    const first = await recovery.issue(
      roomMembers,
      "host",
      "player-1",
      { isPlayerConnected: () => false },
    );
    const second = await recovery.issue(
      roomMembers,
      "host",
      "player-1",
      { isPlayerConnected: () => false },
    );

    expect(first.recoveryCode).not.toBe(second.recoveryCode);
    expect(second.recoveryCode).toMatch(/^\d{6}$/u);
    expect(second.expiresAt).toBe(1_000 + IDENTITY_RECOVERY_TTL_MS);

    await expect(
      recovery.claim(
        roomMembers,
        first.recoveryCode,
        { isPlayerConnected: () => false },
      ),
    ).rejects.toMatchObject({ code: "invalid_or_expired" });

    const claim = await recovery.claim(
      roomMembers,
      second.recoveryCode,
      { isPlayerConnected: () => false },
    );
    expect(claim.playerId).toBe("player-1");
    expect(claim.resumeToken).toBeTruthy();
    expect(claim.resumeTokenHash).not.toBe(roomMembers[1]!.resumeTokenHash);

    await expect(
      recovery.claim(
        roomMembers,
        second.recoveryCode,
        { isPlayerConnected: () => false },
      ),
    ).rejects.toMatchObject({ code: "invalid_or_expired" });

    now = 10_000;
  });

  it("rejects expired grants and persists guess throttling state", async () => {
    const repository = new MemoryRecoveryRepository();
    let now = 1_000;
    const recovery = service(repository, () => now);
    const roomMembers = members();

    const expired = await recovery.issue(
      roomMembers,
      "host",
      "player-1",
      { isPlayerConnected: () => false },
    );
    now = 1_000 + IDENTITY_RECOVERY_TTL_MS;
    await expect(
      recovery.claim(
        roomMembers,
        expired.recoveryCode,
        { isPlayerConnected: () => false },
      ),
    ).rejects.toMatchObject({ code: "invalid_or_expired" });

    now += 1;
    const active = await recovery.issue(
      roomMembers,
      "host",
      "player-1",
      { isPlayerConnected: () => false },
    );
    for (let attempt = 0; attempt < IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      const reconstructed = service(repository, () => now + attempt);
      await expect(
        reconstructed.claim(
          roomMembers,
          "999999",
          { isPlayerConnected: () => false },
        ),
      ).rejects.toBeInstanceOf(IdentityRecoveryError);
    }

    await expect(
      recovery.claim(
        roomMembers,
        active.recoveryCode,
        { isPlayerConnected: () => false },
      ),
    ).rejects.toMatchObject({ code: "invalid_or_expired" });
  });

  it("keeps authorization and online-target checks game-neutral", async () => {
    const repository = new MemoryRecoveryRepository();
    const recovery = service(repository, () => 1_000);
    const roomMembers = members();

    await expect(
      recovery.issue(
        roomMembers,
        "player-1",
        "host",
        { isPlayerConnected: () => false },
      ),
    ).rejects.toMatchObject({ code: "not_recovery_controller" });

    await expect(
      recovery.issue(
        roomMembers,
        "host",
        "player-1",
        { isPlayerConnected: playerId => playerId === "player-1" },
      ),
    ).rejects.toMatchObject({ code: "target_online" });
  });
});
