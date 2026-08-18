import { describe, expect, it } from "vitest";
import { SessionTokenService } from "../src/core/session/SessionTokenService.js";
import { DEFAULT_GAME_CONFIG } from "../src/domain/game.js";
import { NodeSessionTokenCryptoProvider } from "../src/runtime/node/NodeSessionTokenCryptoProvider.js";
import {
  IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS,
  IDENTITY_RECOVERY_TTL_MS,
  consumeIdentityRecoveryGrant,
  issueIdentityRecoveryGrant,
} from "../src/runtime/node/identityRecovery.js";
import type { RuntimeRoom } from "../src/runtime/node/roomBridge.js";

function room(): RuntimeRoom {
  return {
    id: "1234",
    gameType: "werewolf",
    players: [
      {
        id: "player-1",
        name: "玩家一",
        seat: 1,
        isHost: false,
        connected: false,
        socketId: null,
        resumeTokenHash: "a".repeat(64),
      },
    ],
    gameConfig: DEFAULT_GAME_CONFIG,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("C4.3 identity recovery grants", () => {
  const tokens = new SessionTokenService(new NodeSessionTokenCryptoProvider());

  it("issues a six-digit numeric recovery code", async () => {
    const targetRoom = room();
    const grant = await issueIdentityRecoveryGrant(targetRoom, "player-1", tokens, 1000);

    expect(grant.recoveryCode).toMatch(/^\d{6}$/u);
  });

  it("replaces older grants for the same player and consumes the new grant once", async () => {
    const targetRoom = room();
    const first = await issueIdentityRecoveryGrant(targetRoom, "player-1", tokens, 1000);
    const second = await issueIdentityRecoveryGrant(targetRoom, "player-1", tokens, 2000);

    expect(first.recoveryCode).not.toBe(second.recoveryCode);
    expect(await consumeIdentityRecoveryGrant(targetRoom, first.recoveryCode, tokens, 2500)).toBeNull();
    expect(await consumeIdentityRecoveryGrant(targetRoom, second.recoveryCode, tokens, 2500)).toBe("player-1");
    expect(await consumeIdentityRecoveryGrant(targetRoom, second.recoveryCode, tokens, 2500)).toBeNull();
  });

  it("rejects expired grants", async () => {
    const targetRoom = room();
    const grant = await issueIdentityRecoveryGrant(targetRoom, "player-1", tokens, 1000);

    expect(
      await consumeIdentityRecoveryGrant(
        targetRoom,
        grant.recoveryCode,
        tokens,
        1000 + IDENTITY_RECOVERY_TTL_MS,
      ),
    ).toBeNull();
  });

  it("invalidates active grants after repeated wrong guesses", async () => {
    const targetRoom = room();
    const grant = await issueIdentityRecoveryGrant(targetRoom, "player-1", tokens, 1000);

    for (let attempt = 0; attempt < IDENTITY_RECOVERY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(
        await consumeIdentityRecoveryGrant(
          targetRoom,
          String(attempt).padStart(6, "0"),
          tokens,
          2000 + attempt,
        ),
      ).toBeNull();
    }

    expect(await consumeIdentityRecoveryGrant(targetRoom, grant.recoveryCode, tokens, 3000)).toBeNull();
  });
});
