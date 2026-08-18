import { describe, expect, it } from "vitest";
import type { PendingInteraction } from "../src/core/interaction/PendingInteraction.js";
import {
  createRoomSnapshot,
  nextRoomRevision,
  restoreRoomSnapshot,
  type RoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import type { RoomPlayer, RoomState } from "../src/core/room/types.js";

type RuntimeLikePlayer = RoomPlayer & {
  socketId: string | null;
  connected: boolean;
};

type RepresentativeGameState = {
  phase: "night_werewolf";
  roles: Record<string, string>;
  actionId: string;
};

type RepresentativeGameConfig = {
  playerCount: number;
  roleDeck: string[];
};

type RepresentativeRuleState = {
  lovers: [string, string][];
  copiedAbilityByPlayerId: Record<string, string>;
};

describe("C2 room snapshot contract", () => {
  it("contains authoritative recovery data without socket transport state", () => {
    const snapshot: RoomSnapshot<
      RepresentativeGameState,
      RepresentativeGameConfig,
      RepresentativeRuleState,
      PendingInteraction<"wolf_kill">
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
      gameConfig: { playerCount: 5, roleDeck: ["werewolf"] },
      game: {
        phase: "night_werewolf",
        roles: { "player-1": "werewolf" },
        actionId: "action-7",
      },
      ruleState: {
        lovers: [["player-1", "player-2"]],
        copiedAbilityByPlayerId: { "player-3": "hunter" },
      },
      pendingInteraction: {
        id: "interaction-7",
        kind: "wolf_kill",
        actorPlayerIds: ["player-1"],
        mode: "single",
        wakePolicy: { vibrate: true },
        completionPolicy: { type: "single_submission" },
        status: "active",
      },
    };

    expect(snapshot.revision).toBe(7);
    expect(snapshot.membership[0]).not.toHaveProperty("socketId");
    expect(snapshot.membership[0]).not.toHaveProperty("connected");
    expect(JSON.stringify(snapshot)).not.toContain("socketId");
  });

  it("projects a runtime-like room into a transport-neutral snapshot and restores authoritative state", () => {
    const room: RoomState<
      RepresentativeGameState,
      RepresentativeGameConfig,
      RuntimeLikePlayer
    > = {
      id: "654321",
      gameType: "werewolf",
      players: [
        {
          id: "host-1",
          name: "房主",
          seat: 1,
          isHost: true,
          resumeTokenHash: "c".repeat(64),
          socketId: "socket-host",
          connected: true,
        },
        {
          id: "player-2",
          name: "玩家二号",
          seat: 2,
          isHost: false,
          resumeTokenHash: "d".repeat(64),
          socketId: null,
          connected: false,
        },
      ],
      createdAt: 1000,
      updatedAt: 2000,
      gameConfig: {
        playerCount: 5,
        roleDeck: ["werewolf", "seer", "witch", "villager", "villager"],
      },
      game: {
        phase: "night_werewolf",
        roles: { "host-1": "werewolf", "player-2": "seer" },
        actionId: "action-42",
      },
    };

    const ruleState: RepresentativeRuleState = {
      lovers: [["host-1", "player-2"]],
      copiedAbilityByPlayerId: { "player-2": "hunter" },
    };
    const pendingInteraction: PendingInteraction<"wolf_kill"> = {
      id: "interaction-42",
      kind: "wolf_kill",
      actorPlayerIds: ["host-1"],
      mode: "single",
      wakePolicy: { vibrate: true, audioCue: "wake" },
      completionPolicy: { type: "single_submission" },
      status: "active",
    };

    const snapshot = createRoomSnapshot(room, {
      revision: 12,
      ruleState,
      pendingInteraction,
    });

    expect(snapshot.membership).toEqual([
      {
        id: "host-1",
        name: "房主",
        seat: 1,
        isHost: true,
        resumeTokenHash: "c".repeat(64),
      },
      {
        id: "player-2",
        name: "玩家二号",
        seat: 2,
        isHost: false,
        resumeTokenHash: "d".repeat(64),
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("socket-host");
    expect(JSON.stringify(snapshot)).not.toContain("connected");

    const persisted = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const restored = restoreRoomSnapshot(persisted);

    expect(restored.revision).toBe(12);
    expect(restored.room).toEqual({
      id: room.id,
      gameType: room.gameType,
      players: snapshot.membership,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      gameConfig: room.gameConfig,
      game: room.game,
    });
    expect(restored.ruleState).toEqual(ruleState);
    expect(restored.pendingInteraction).toEqual(pendingInteraction);
    expect(restored.room.players[0]).not.toHaveProperty("socketId");
    expect(restored.room.players[0]).not.toHaveProperty("connected");
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

  it("advances revision monotonically and rejects invalid or exhausted revisions", () => {
    expect(nextRoomRevision(0)).toBe(1);
    expect(nextRoomRevision(41)).toBe(42);
    expect(() => nextRoomRevision(-1)).toThrow(/revision/);
    expect(() => nextRoomRevision(Number.NaN)).toThrow(/revision/);
    expect(() => nextRoomRevision(Number.MAX_SAFE_INTEGER)).toThrow(/safe integer range/);
  });
});
