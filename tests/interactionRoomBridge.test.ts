import { describe, expect, it } from "vitest";
import { configFromRoleDeck, type GameState } from "../src/domain/game.js";
import {
  actingPlayerIds,
  playerGameView,
  roomGameView,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";

function game(): GameState {
  return {
    config: configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]),
    phase: "night_seer",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "werewolf",
      p2: "seer",
      p3: "witch",
      p4: "villager",
      p5: "villager",
    },
    confirmedRolePlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    actionId: "seer-interaction",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
  };
}

function room(): RuntimeRoom {
  const config = configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]);
  return {
    id: "123456",
    gameType: "werewolf",
    createdAt: 1,
    updatedAt: 1,
    gameConfig: config,
    game: game(),
    players: [
      { id: "p1", name: "一号", seat: 1, isHost: true, socketId: "s1", connected: true, resumeTokenHash: "h1" },
      { id: "p2", name: "二号", seat: 2, isHost: false, socketId: "s2", connected: true, resumeTokenHash: "h2" },
      { id: "p3", name: "三号", seat: 3, isHost: false, socketId: "s3", connected: true, resumeTokenHash: "h3" },
      { id: "p4", name: "四号", seat: 4, isHost: false, socketId: "s4", connected: true, resumeTokenHash: "h4" },
      { id: "p5", name: "五号", seat: 5, isHost: false, socketId: "s5", connected: true, resumeTokenHash: "h5" },
    ],
  };
}

describe("room bridge interactions", () => {
  it("exposes the active interaction only to an acting player's private view", () => {
    const currentRoom = room();

    expect(playerGameView(currentRoom, "p2")).toMatchObject({
      activeInteraction: {
        id: "seer-interaction",
        kind: "seer_check",
        mode: "single",
        wakePolicy: { vibrate: true },
        completionPolicy: { type: "explicit_confirmation" },
        status: "active",
      },
    });

    expect(playerGameView(currentRoom, "p3")).not.toHaveProperty("activeInteraction");
  });

  it("gives the host the authoritative interaction including actor ids", () => {
    const hostView = roomGameView(room(), true);

    expect(hostView).toMatchObject({
      activeInteraction: {
        id: "seer-interaction",
        kind: "seer_check",
        actorPlayerIds: ["p2"],
      },
    });
  });

  it("does not leak the active interaction into the public room game view", () => {
    expect(roomGameView(room(), false)).not.toHaveProperty("activeInteraction");
  });

  it("derives acting players from the active interaction", () => {
    expect(actingPlayerIds(room())).toEqual(["p2"]);
  });
});
