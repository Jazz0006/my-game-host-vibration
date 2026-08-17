import { describe, expect, it } from "vitest";
import { startGame, type GameConfig } from "../src/domain/game.js";
import {
  closeDayVote,
  confirmRole,
  startDayVote,
  submitVote,
  submitWolfTarget,
} from "../src/runtime/node/werewolfCommandFacade.js";

const config: GameConfig = {
  playerCount: 5,
  roleDeck: ["werewolf", "seer", "witch", "villager", "villager"],
};

function game() {
  return startGame(["p1", "p2", "p3", "p4", "p5"], config);
}

describe("werewolf command facade", () => {
  it("preserves confirm-role completion semantics", () => {
    const state = game();
    const actionId = state.actionId;

    expect(confirmRole(state, "p1", actionId)).toBe(false);
    expect(confirmRole(state, "p2", actionId)).toBe(false);
    expect(confirmRole(state, "p3", actionId)).toBe(false);
    expect(confirmRole(state, "p4", actionId)).toBe(false);
    expect(confirmRole(state, "p5", actionId)).toBe(true);
    expect(state.phase).toBe("night_start");
  });

  it("preserves night-action advanced semantics", () => {
    const state = game();
    const wolfId = Object.entries(state.roles).find(([, role]) => role === "werewolf")![0];
    const targetId = Object.keys(state.roles).find(id => id !== wolfId)!;
    state.phase = "night_werewolf";
    state.actionId = "wolf-action";

    expect(submitWolfTarget(state, wolfId, targetId, "wolf-action")).toBe(true);
    expect(state.actionId).not.toBe("wolf-action");
    expect(submitWolfTarget(state, wolfId, targetId, "wolf-action")).toBe(false);
  });

  it("preserves vote changed and close result semantics", () => {
    const state = game();
    state.phase = "night_complete";
    startDayVote(state);
    const actionId = state.actionId;

    expect(submitVote(state, "p1", "p5", actionId)).toBe(true);
    expect(submitVote(state, "p1", "p5", actionId)).toBe(false);
    expect(submitVote(state, "p2", "p5", actionId)).toBe(true);
    expect(submitVote(state, "p3", "p5", actionId)).toBe(true);

    expect(closeDayVote(state)).toBe("p5");
    expect(state.eliminatedTodayId).toBe("p5");
  });
});
