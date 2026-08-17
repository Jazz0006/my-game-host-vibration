import { describe, expect, it } from "vitest";
import { configFromRoleDeck, type GameState } from "../src/domain/game.js";
import {
  executeWerewolfCommand,
  type RuntimePlayer,
  type RuntimeRoom,
} from "../src/runtime/node/roomBridge.js";

function players(): RuntimePlayer[] {
  return [
    { id: "p1", name: "一号", seat: 1, isHost: true, resumeTokenHash: "h1", socketId: "s1", connected: true },
    { id: "p2", name: "二号", seat: 2, isHost: false, resumeTokenHash: "h2", socketId: "s2", connected: true },
    { id: "p3", name: "三号", seat: 3, isHost: false, resumeTokenHash: "h3", socketId: "s3", connected: true },
    { id: "p4", name: "四号", seat: 4, isHost: false, resumeTokenHash: "h4", socketId: "s4", connected: true },
    { id: "p5", name: "五号", seat: 5, isHost: false, resumeTokenHash: "h5", socketId: "s5", connected: true },
  ];
}

function game(overrides: Partial<GameState> = {}): GameState {
  const config = configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]);
  return {
    config,
    phase: "night_start",
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
    actionId: "action-1",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
    ...overrides,
  };
}

function room(state: GameState): RuntimeRoom {
  return {
    id: "123456",
    gameType: "werewolf",
    players: players(),
    createdAt: 1,
    updatedAt: 1,
    gameConfig: state.config,
    game: state,
  };
}

describe("executeWerewolfCommand", () => {
  it("marks start-night as requiring night orchestration", () => {
    const state = game();
    const outcome = executeWerewolfCommand(room(state), { type: "startNight" }, { isHost: true });

    expect(outcome).toEqual({ kind: "afterNightAction" });
    expect(state.phase).toBe("night_werewolf");
  });

  it("marks seer target selection as a broadcast-only command", () => {
    const state = game({ phase: "night_seer", actionId: "seer-action" });
    const outcome = executeWerewolfCommand(
      room(state),
      { type: "submitSeerTarget", targetPlayerId: "p1", actionId: "seer-action" },
      { playerId: "p2" },
    );

    expect(outcome).toEqual({ kind: "broadcast" });
    expect(state.seerTargetId).toBe("p1");
  });

  it("reports vote changes and when all eligible players have voted", () => {
    const state = game({
      phase: "day_vote",
      actionId: "vote-action",
      dayNumber: 1,
      votes: { p1: "p2", p2: "p1", p3: "p1", p4: "p1" },
    });

    const outcome = executeWerewolfCommand(
      room(state),
      { type: "submitVote", targetId: "p1", actionId: "vote-action" },
      { playerId: "p5" },
    );

    expect(outcome).toEqual({ kind: "vote", changed: true, allEligibleVoted: true });
  });

  it("reports close-vote results without exposing rule functions to the server", () => {
    const state = game({
      phase: "day_vote",
      actionId: "vote-action",
      dayNumber: 1,
      votes: { p1: "p2", p2: "p1", p3: "p1", p4: "p1", p5: "p1" },
    });

    const outcome = executeWerewolfCommand(room(state), { type: "closeDayVote" }, { isHost: true });

    expect(outcome).toEqual({ kind: "voteClosed", result: "p1" });
    expect(state.eliminatedTodayId).toBe("p1");
  });
});
