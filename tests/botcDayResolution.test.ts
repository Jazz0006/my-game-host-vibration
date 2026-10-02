import { describe, expect, it } from "vitest";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import { startBotcDayVotingDay } from "../src/games/botc/BotcDayVoting.js";
import type { GameModuleDependencies } from "../src/core/game/GameModule.js";
import {
  resolveBotcExecution,
  resolveBotcNoExecution,
  shouldVirginExecuteNominator,
  type BotcDayResolutionFacts,
} from "../src/games/botc/BotcDayResolution.js";

function facts(
  overrides: Partial<BotcDayResolutionFacts> = {},
): BotcDayResolutionFacts {
  return {
    dayNumber: 1,
    seatingPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    deadPlayerIds: [],
    assignments: [
      { playerId: "p1", actualRoleId: "chef", shownRoleId: "chef" },
      { playerId: "p2", actualRoleId: "empath", shownRoleId: "empath" },
      { playerId: "p3", actualRoleId: "virgin", shownRoleId: "virgin" },
      { playerId: "p4", actualRoleId: "scarlet_woman", shownRoleId: "scarlet_woman" },
      { playerId: "p5", actualRoleId: "imp", shownRoleId: "imp" },
    ],
    ...overrides,
  };
}

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

describe("PV-4C BotC execution / death / end-of-day resolution", () => {
  it("records execution of an already-dead player without a second death", () => {
    const resolved = resolveBotcExecution(
      facts({ deadPlayerIds: ["p2"] }),
      "p2",
      "vote",
    );

    expect(resolved).toEqual({
      execution: {
        playerId: "p2",
        died: false,
        source: "vote",
      },
      deadPlayerIds: ["p2"],
      roleTransitions: [],
    });
  });

  it("lets a healthy Scarlet Woman replace an executed Imp when five were alive before death", () => {
    const resolved = resolveBotcExecution(facts(), "p5", "vote");

    expect(resolved).toMatchObject({
      execution: {
        playerId: "p5",
        died: true,
        source: "vote",
      },
      deadPlayerIds: ["p5"],
      roleTransitions: [
        {
          kind: "scarlet_woman_to_imp",
          playerId: "p4",
        },
      ],
    });
    expect(resolved.winner).toBeUndefined();
  });

  it("ends in a good win when the Imp dies without an eligible Scarlet Woman", () => {
    const poisoned = resolveBotcExecution(
      facts({ poisonedPlayerId: "p4" }),
      "p5",
      "vote",
    );
    expect(poisoned).toMatchObject({
      winner: "good",
      endReason: "demon_died",
      roleTransitions: [],
    });

    const fewerAlive = resolveBotcExecution(
      facts({ deadPlayerIds: ["p1"] }),
      "p5",
      "vote",
    );
    expect(fewerAlive).toMatchObject({
      winner: "good",
      endReason: "demon_died",
      roleTransitions: [],
    });
  });

  it("ends in an evil win when a healthy Saint dies by execution", () => {
    const saintFacts = facts({
      assignments: [
        { playerId: "p1", actualRoleId: "saint", shownRoleId: "saint" },
        { playerId: "p2", actualRoleId: "chef", shownRoleId: "chef" },
        { playerId: "p3", actualRoleId: "empath", shownRoleId: "empath" },
        { playerId: "p4", actualRoleId: "poisoner", shownRoleId: "poisoner" },
        { playerId: "p5", actualRoleId: "imp", shownRoleId: "imp" },
      ],
    });

    expect(resolveBotcExecution(saintFacts, "p1", "vote")).toMatchObject({
      winner: "evil",
      endReason: "saint_executed",
    });

    expect(
      resolveBotcExecution(
        { ...saintFacts, poisonedPlayerId: "p1" },
        "p1",
        "vote",
      ),
    ).not.toHaveProperty("endReason", "saint_executed");
  });

  it("applies the standard two-alive evil win after a non-Demon execution", () => {
    const resolved = resolveBotcExecution(
      facts({ deadPlayerIds: ["p1", "p2"] }),
      "p3",
      "vote",
    );

    expect(resolved).toMatchObject({
      winner: "evil",
      endReason: "two_alive",
    });
  });

  it("allows a healthy alive Mayor to win with exactly three alive and no execution", () => {
    const mayorFacts = facts({
      deadPlayerIds: ["p1", "p2"],
      assignments: [
        { playerId: "p1", actualRoleId: "chef", shownRoleId: "chef" },
        { playerId: "p2", actualRoleId: "empath", shownRoleId: "empath" },
        { playerId: "p3", actualRoleId: "mayor", shownRoleId: "mayor" },
        { playerId: "p4", actualRoleId: "poisoner", shownRoleId: "poisoner" },
        { playerId: "p5", actualRoleId: "imp", shownRoleId: "imp" },
      ],
    });

    expect(resolveBotcNoExecution(mayorFacts)).toEqual({
      winner: "good",
      endReason: "mayor_no_execution",
    });

    expect(
      resolveBotcNoExecution({
        ...mayorFacts,
        poisonedPlayerId: "p3",
      }),
    ).toEqual({});
  });

  it("commits Virgin immediate execution into authoritative game state", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "chef" },
          { playerId: "p2", actualRoleId: "empath" },
          { playerId: "p3", actualRoleId: "virgin" },
          { playerId: "p4", actualRoleId: "poisoner" },
          { playerId: "p5", actualRoleId: "imp" },
        ],
      },
      dependencies,
    );
    game.phase = "day";
    game.dayNumber = 1;
    game.nightNumber = 1;
    game.dayVoting = startBotcDayVotingDay(undefined, 1);

    const result = module.handleCommand(
      game,
      { playerId: "p1", isModerator: false, now: 1 },
      { type: "nominate", nomineePlayerId: "p3" },
      dependencies,
    );

    expect(result.outcome).toMatchObject({
      kind: "virginExecutionTriggered",
      virginPlayerId: "p3",
      executedPlayerId: "p1",
    });
    expect(game.deadPlayerIds).toEqual(["p1"]);
    expect(game.executedAndDiedTodayPlayerId).toBe("p1");
    expect(game.virginAbilitySpent).toBe(true);
    expect(game.dayVoting.activeNomination).toBeUndefined();
    expect(game.dayResolution).toEqual({
      dayNumber: 1,
      execution: {
        playerId: "p1",
        died: true,
        source: "virgin",
      },
      noExecution: false,
    });
  });

  it("resolves an executed Imp into death plus Scarlet Woman succession facts", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "chef" },
          { playerId: "p2", actualRoleId: "empath" },
          { playerId: "p3", actualRoleId: "washerwoman" },
          { playerId: "p4", actualRoleId: "scarlet_woman" },
          { playerId: "p5", actualRoleId: "imp" },
        ],
      },
      dependencies,
    );
    game.phase = "day";
    game.dayNumber = 1;
    game.nightNumber = 1;
    game.dayVoting = {
      ...startBotcDayVotingDay(undefined, 1),
      highVoteCount: 3,
      blockNomineePlayerId: "p5",
    };

    const result = module.handleCommand(
      game,
      { isModerator: true, now: 1 },
      { type: "resolveDay" },
      dependencies,
    );

    expect(result.outcome).toMatchObject({
      kind: "dayResolved",
      executionPlayerId: "p5",
      executionDied: true,
      noExecution: false,
    });
    expect(game.deadPlayerIds).toEqual(["p5"]);
    expect(game.executedAndDiedTodayPlayerId).toBe("p5");
    expect(game.roleTransitions).toEqual([
      {
        kind: "scarlet_woman_to_imp",
        playerId: "p4",
      },
    ]);
    expect(game.winner).toBeUndefined();
  });

  it("keeps execution of an already-dead player distinct from execution-caused death", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "chef" },
          { playerId: "p2", actualRoleId: "undertaker" },
          { playerId: "p3", actualRoleId: "washerwoman" },
          { playerId: "p4", actualRoleId: "poisoner" },
          { playerId: "p5", actualRoleId: "imp" },
        ],
      },
      dependencies,
    );
    game.phase = "day";
    game.dayNumber = 1;
    game.nightNumber = 1;
    game.deadPlayerIds = ["p2"];
    game.dayVoting = {
      ...startBotcDayVotingDay(undefined, 1),
      highVoteCount: 2,
      blockNomineePlayerId: "p2",
    };

    const result = module.handleCommand(
      game,
      { isModerator: true, now: 1 },
      { type: "resolveDay" },
      dependencies,
    );

    expect(result.outcome).toMatchObject({
      kind: "dayResolved",
      executionPlayerId: "p2",
      executionDied: false,
      noExecution: false,
    });
    expect(game.deadPlayerIds).toEqual(["p2"]);
    expect(game.executedAndDiedTodayPlayerId).toBeUndefined();
    expect(game.dayResolution).toEqual({
      dayNumber: 1,
      execution: {
        playerId: "p2",
        died: false,
        source: "vote",
      },
      noExecution: false,
    });
    expect(game.winner).toBeUndefined();
  });

  it("triggers Virgin only for a healthy living actual Virgin nominated by an actual Townsfolk", () => {
    const current = facts();
    expect(shouldVirginExecuteNominator(current, "p3", "p1")).toBe(true);
    expect(shouldVirginExecuteNominator(current, "p3", "p4")).toBe(false);
    expect(
      shouldVirginExecuteNominator(
        { ...current, poisonedPlayerId: "p3" },
        "p3",
        "p1",
      ),
    ).toBe(false);

    const drunkShownVirgin: BotcDayResolutionFacts = {
      ...current,
      assignments: [
        { playerId: "p1", actualRoleId: "chef", shownRoleId: "chef" },
        { playerId: "p2", actualRoleId: "empath", shownRoleId: "empath" },
        { playerId: "p3", actualRoleId: "drunk", shownRoleId: "virgin" },
        { playerId: "p4", actualRoleId: "scarlet_woman", shownRoleId: "scarlet_woman" },
        { playerId: "p5", actualRoleId: "imp", shownRoleId: "imp" },
      ],
    };
    expect(shouldVirginExecuteNominator(drunkShownVirgin, "p3", "p1")).toBe(false);
  });
});
