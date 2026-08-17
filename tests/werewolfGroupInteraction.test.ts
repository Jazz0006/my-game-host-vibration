import { describe, expect, it } from "vitest";
import { configFromRoleDeck, type GameState } from "../src/domain/game.js";
import { getActiveWerewolfInteraction } from "../src/games/werewolf/WerewolfNightPlanner.js";

function twoWolfGame(): GameState {
  return {
    config: configFromRoleDeck(6, [
      "werewolf",
      "werewolf",
      "seer",
      "witch",
      "villager",
      "villager",
    ]),
    phase: "night_werewolf",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "werewolf",
      p2: "werewolf",
      p3: "seer",
      p4: "witch",
      p5: "villager",
      p6: "villager",
    },
    confirmedRolePlayerIds: [],
    actionId: "wolf-group-1",
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

describe("Werewolf group interactions", () => {
  it("groups all living wolves into one interaction completed by any actor", () => {
    expect(getActiveWerewolfInteraction(twoWolfGame())).toEqual({
      id: "wolf-group-1",
      kind: "wolf_kill",
      actorPlayerIds: ["p1", "p2"],
      mode: "group",
      wakePolicy: { vibrate: true, audioCue: "wolf_wake" },
      completionPolicy: { type: "any_actor_submission" },
      status: "active",
    });
  });

  it("excludes dead wolves from the active group", () => {
    const game = twoWolfGame();
    game.deadPlayerIds.push("p2");

    expect(getActiveWerewolfInteraction(game)?.actorPlayerIds).toEqual(["p1"]);
  });
});
