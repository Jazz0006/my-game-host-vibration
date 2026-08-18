import { describe, expect, it } from "vitest";
import {
  nextRoomRevision,
  type RoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";

describe("C2 room snapshot contract", () => {
  it("contains authoritative recovery data without socket transport state", () => {
    const snapshot: RoomSnapshot<
      { phase: string; roles: Record<string, string> },
      { playerCount: number },
      { lovers: string[][] },
      { kind: string; actorPlayerIds: string[] }
    > = {
      revision: 7,
      metadata: {
        roomId: "123456",
        gameType: "werewolf",
        createdAt: 100,
        updatedAt: 200,
      },
      membership: [
        {
          id: "player-1",
          name: "房主",
          seat: 1,
          isHost: true,
          resumeTokenHash: "a".repeat(64),
        },
      ],
      gameConfig: { playerCount: 5 },
      game: { phase: "night_werewolf", roles: { "player-1": "werewolf" } },
      ruleState: { lovers: [["player-1", "player-2"]] },
      pendingInteraction: { kind: "wolf_action", actorPlayerIds: ["player-1"] },
    };

    expect(snapshot.revision).toBe(7);
    expect(snapshot.membership[0]).not.toHaveProperty("socketId");
    expect(snapshot.membership[0]).not.toHaveProperty("connected");
    expect(JSON.stringify(snapshot)).not.toContain("socketId");
  });

  it("keeps resume-token hashes authoritative while excluding plaintext rejoin tokens", () => {
    const snapshot: RoomSnapshot<unknown, Record<string, never>> = {
      revision: 0,
      metadata: {
        roomId: "123456",
        gameType: "werewolf",
        createdAt: 1,
        updatedAt: 1,
      },
      membership: [
        {
          id: "player-1",
          name: "玩家",
          seat: 1,
          isHost: false,
          resumeTokenHash: "b".repeat(64),
        },
      ],
      gameConfig: {},
    };

    expect(snapshot.membership[0]?.resumeTokenHash).toHaveLength(64);
    expect(snapshot.membership[0]).not.toHaveProperty("rejoinToken");
    expect(snapshot.membership[0]).not.toHaveProperty("resumeToken");
  });

  it("advances revision monotonically and rejects invalid revisions", () => {
    expect(nextRoomRevision(0)).toBe(1);
    expect(nextRoomRevision(41)).toBe(42);
    expect(() => nextRoomRevision(-1)).toThrow(/revision/);
    expect(() => nextRoomRevision(Number.NaN)).toThrow(/revision/);
  });
});
