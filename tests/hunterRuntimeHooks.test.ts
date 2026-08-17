import { describe, expect, it } from "vitest";
import type { RandomProvider } from "../src/core/random/RandomProvider.js";
import type { GameState } from "../src/domain/game.js";
import { werewolfGameModule } from "../src/games/werewolf/WerewolfGameModule.js";

function randomProvider(): RandomProvider {
  let next = 0;
  return {
    randomInt: () => 0,
    randomId: () => `runtime-hook-${++next}`,
  };
}

function baseState(): GameState {
  return {
    config: {
      playerCount: 5,
      roleDeck: ["hunter", "seer", "werewolf", "villager", "villager"],
    },
    phase: "night_seer",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      hunter: "hunter",
      seer: "seer",
      wolf: "werewolf",
      v1: "villager",
      v2: "villager",
    },
    confirmedRolePlayerIds: ["hunter", "seer", "wolf", "v1", "v2"],
    actionId: "action-1",
    wolfTargetId: "hunter",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerTargetId: "wolf",
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
  };
}

const playerContext = (playerId: string) => ({ playerId, isHost: false, now: 0 });
const hostContext = { isHost: true, now: 0 };

describe("Hunter runtime hook migration", () => {
  it("routes a wolf-killed hunter through the registry-backed afterDeath hook", () => {
    const state = baseState();

    werewolfGameModule.handleCommand(
      state,
      playerContext("seer"),
      { type: "confirmSeerResult", actionId: state.actionId },
      { random: randomProvider() },
    );

    expect(state.deadPlayerIds).toContain("hunter");
    expect(state.deaths).toContain("hunter");
    expect(state.phase).toBe("day_hunter");
    expect(state.hunterTrigger).toBe("night");
    expect(state.winner).toBeUndefined();
  });

  it("routes a voted-out hunter through the same registry-backed hook", () => {
    const state = baseState();
    state.phase = "day_vote";
    state.dayNumber = 1;
    state.actionId = "day-vote";
    delete state.wolfTargetId;
    delete state.seerTargetId;
    state.votes = {
      seer: "hunter",
      wolf: "hunter",
      v1: "hunter",
      v2: "hunter",
    };

    werewolfGameModule.handleCommand(
      state,
      hostContext,
      { type: "closeDayVote" },
      { random: randomProvider() },
    );

    expect(state.deadPlayerIds).toContain("hunter");
    expect(state.eliminatedTodayId).toBe("hunter");
    expect(state.phase).toBe("day_hunter");
    expect(state.hunterTrigger).toBe("day");
  });

  it("treats poison as the authoritative cause when the hunter is both attacked and poisoned", () => {
    const state = baseState();
    state.witchPoisonTargetId = "hunter";
    state.witchPoisonSpent = true;

    werewolfGameModule.handleCommand(
      state,
      playerContext("seer"),
      { type: "confirmSeerResult", actionId: state.actionId },
      { random: randomProvider() },
    );

    expect(state.deadPlayerIds).toContain("hunter");
    expect(state.phase).toBe("night_complete");
    expect(state.hunterTrigger).toBeUndefined();
  });
});
