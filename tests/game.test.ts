import { describe, expect, it } from "vitest";
import {
  confirmRole,
  confirmSeerResult,
  dealRoles,
  playerIdForRole,
  startFivePlayerGame,
  submitSeerTarget,
  submitWitchAction,
  submitWolfTarget,
} from "../src/domain/game.js";

const PLAYERS = ["p1", "p2", "p3", "p4", "p5"];

function beginNight() {
  const state = startFivePlayerGame(PLAYERS);
  for (const playerId of PLAYERS) confirmRole(state, playerId, state.actionId);
  return state;
}

describe("five-player game", () => {
  it("deals exactly the configured private roles", () => {
    const roles = Object.values(dealRoles(PLAYERS, () => 0));
    expect(roles).toHaveLength(5);
    expect(roles.filter(role => role === "werewolf")).toHaveLength(1);
    expect(roles.filter(role => role === "seer")).toHaveLength(1);
    expect(roles.filter(role => role === "witch")).toHaveLength(1);
    expect(roles.filter(role => role === "villager")).toHaveLength(2);
  });

  it("waits for every role confirmation before waking the werewolf", () => {
    const state = startFivePlayerGame(PLAYERS);
    const revealActionId = state.actionId;
    for (const playerId of PLAYERS.slice(0, 4)) confirmRole(state, playerId, revealActionId);
    expect(state.phase).toBe("role_reveal");

    expect(confirmRole(state, PLAYERS[4]!, revealActionId)).toBe(true);
    expect(state.phase).toBe("night_werewolf");
    expect(state.actionId).not.toBe(revealActionId);
  });

  it("runs wolf, witch, and seer in order and settles a saved night", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = PLAYERS.find(id => id !== wolf && id !== witch)!;

    submitWolfTarget(state, wolf, victim, state.actionId);
    expect(state.phase).toBe("night_witch");
    submitWitchAction(state, witch, { useAntidote: true }, state.actionId);
    expect(state.phase).toBe("night_seer");
    expect(submitSeerTarget(state, seer, wolf, state.actionId)).toBe("werewolf");
    confirmSeerResult(state, seer, state.actionId);

    expect(state.phase).toBe("night_complete");
    expect(state.deaths).toEqual([]);
  });

  it("settles both wolf and poison deaths when the antidote is not used", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const candidates = PLAYERS.filter(id => id !== wolf && id !== witch);

    submitWolfTarget(state, wolf, candidates[0], state.actionId);
    submitWitchAction(state, witch, { poisonTargetId: candidates[1]! }, state.actionId);
    submitSeerTarget(state, seer, wolf, state.actionId);
    confirmSeerResult(state, seer, state.actionId);

    expect(new Set(state.deaths)).toEqual(new Set([candidates[0], candidates[1]]));
  });

  it("rejects invalid actors, stale actions, and using both potions", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const victim = PLAYERS.find(id => id !== wolf)!;
    const differentVictim = PLAYERS.find(id => id !== wolf && id !== victim)!;
    const staleActionId = state.actionId;

    expect(() => submitWolfTarget(state, witch, victim, state.actionId)).toThrow("当前不是你的行动阶段");
    submitWolfTarget(state, wolf, victim, state.actionId);
    expect(() => submitWolfTarget(state, wolf, differentVictim, staleActionId)).toThrow("行动已失效");
    expect(() =>
      submitWitchAction(
        state,
        witch,
        { useAntidote: true, poisonTargetId: victim },
        state.actionId,
      ),
    ).toThrow("同一晚只能使用一瓶药");
  });

  it("treats an identical repeated submission as a successful no-op", () => {
    const state = beginNight();
    const wolf = playerIdForRole(state, "werewolf");
    const witch = playerIdForRole(state, "witch");
    const seer = playerIdForRole(state, "seer");
    const victim = PLAYERS.find(id => id !== wolf)!;

    const wolfActionId = state.actionId;
    submitWolfTarget(state, wolf, victim, wolfActionId);
    expect(() => submitWolfTarget(state, wolf, victim, wolfActionId)).not.toThrow();

    const witchActionId = state.actionId;
    submitWitchAction(state, witch, { useAntidote: true }, witchActionId);
    expect(() =>
      submitWitchAction(state, witch, { useAntidote: true }, witchActionId),
    ).not.toThrow();

    const seerActionId = state.actionId;
    submitSeerTarget(state, seer, wolf, seerActionId);
    expect(submitSeerTarget(state, seer, wolf, seerActionId)).toBe("werewolf");
    confirmSeerResult(state, seer, seerActionId);
    expect(() => confirmSeerResult(state, seer, seerActionId)).not.toThrow();
  });
});
