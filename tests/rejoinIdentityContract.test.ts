import { describe, expect, it } from "vitest";
import {
  authenticateRejoin,
  roomMemberIdentity,
} from "../src/core/room/RejoinIdentity.js";
import type { RoomState } from "../src/core/room/types.js";
import type { SessionTokenCryptoProvider } from "../src/core/security/SessionTokenCryptoProvider.js";
import { SessionTokenService } from "../src/core/session/SessionTokenService.js";

const GOOD_HASH = "a".repeat(64);
const BAD_HASH = "b".repeat(64);

class FakeCrypto implements SessionTokenCryptoProvider {
  randomToken(): string {
    return "unused";
  }

  async sha256Hex(value: string): Promise<string> {
    return value === "valid-rejoin-token" ? GOOD_HASH : BAD_HASH;
  }

  timingSafeEqualHex(actualHex: string, expectedHex: string): boolean {
    return actualHex === expectedHex;
  }
}

function room(): RoomState {
  return {
    id: "123456",
    gameType: "werewolf",
    players: [
      {
        id: "player-1",
        name: "房主",
        seat: 1,
        isHost: true,
        resumeTokenHash: GOOD_HASH,
      },
      {
        id: "player-2",
        name: "玩家二号",
        seat: 2,
        isHost: false,
        resumeTokenHash: GOOD_HASH,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    gameConfig: {},
  };
}

describe("C1 rejoin identity contract", () => {
  const tokens = new SessionTokenService(new FakeCrypto());

  it("exposes stable member identity without transport state or token material", () => {
    const identity = roomMemberIdentity(room().players[0]!);

    expect(identity).toEqual({
      playerId: "player-1",
      displayName: "房主",
      isHost: true,
    });
    expect(identity).not.toHaveProperty("socketId");
    expect(identity).not.toHaveProperty("rejoinToken");
    expect(identity).not.toHaveProperty("resumeTokenHash");
  });

  it("authenticates the original player independently of any socket id", async () => {
    const state = room();
    const player = await authenticateRejoin(
      state,
      {
        roomId: state.id,
        playerId: "player-2",
        rejoinToken: "valid-rejoin-token",
      },
      tokens,
    );

    expect(player?.id).toBe("player-2");
    expect(player?.seat).toBe(2);
    expect(player?.isHost).toBe(false);
  });

  it("rejects a wrong token, wrong room, or wrong player", async () => {
    const state = room();

    await expect(
      authenticateRejoin(
        state,
        { roomId: state.id, playerId: "player-2", rejoinToken: "wrong-token" },
        tokens,
      ),
    ).resolves.toBeUndefined();

    await expect(
      authenticateRejoin(
        state,
        { roomId: "654321", playerId: "player-2", rejoinToken: "valid-rejoin-token" },
        tokens,
      ),
    ).resolves.toBeUndefined();

    await expect(
      authenticateRejoin(
        state,
        { roomId: state.id, playerId: "missing", rejoinToken: "valid-rejoin-token" },
        tokens,
      ),
    ).resolves.toBeUndefined();
  });

  it("preserves host identity when the host authenticates again", async () => {
    const state = room();
    const host = await authenticateRejoin(
      state,
      {
        roomId: state.id,
        playerId: "player-1",
        rejoinToken: "valid-rejoin-token",
      },
      tokens,
    );

    expect(roomMemberIdentity(host!)).toEqual({
      playerId: "player-1",
      displayName: "房主",
      isHost: true,
    });
  });
});
