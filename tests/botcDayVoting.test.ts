import { describe, expect, it } from "vitest";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import type { GameModuleDependencies } from "../src/core/game/GameModule.js";
import {
  closeBotcNomination,
  createBotcDayVotingPublicView,
  startBotcDayVotingDay,
  startBotcNomination,
  submitBotcDayVote,
  type BotcDayVotingFacts,
} from "../src/games/botc/BotcDayVoting.js";

function facts(overrides: Partial<BotcDayVotingFacts> = {}): BotcDayVotingFacts {
  return {
    seatingPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    deadPlayerIds: [],
    assignments: [
      { playerId: "p1", actualRoleId: "butler", shownRoleId: "butler" },
      { playerId: "p2", actualRoleId: "imp", shownRoleId: "imp" },
      { playerId: "p3", actualRoleId: "chef", shownRoleId: "chef" },
      { playerId: "p4", actualRoleId: "empath", shownRoleId: "empath" },
      { playerId: "p5", actualRoleId: "saint", shownRoleId: "saint" },
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

describe("PV-4B BotC day nomination and voting authority", () => {
  it("allows self-nomination and dead nominees while enforcing once-per-day nominators and nominees", () => {
    const state = startBotcDayVotingDay(undefined, 1);
    const currentFacts = facts({ deadPlayerIds: ["p5"] });

    const first = startBotcNomination(state, currentFacts, "p1", "p1");
    expect(first).toMatchObject({
      id: "day-1-nomination-1",
      nominatorPlayerId: "p1",
      nomineePlayerId: "p1",
    });
    closeBotcNomination(state, currentFacts);

    expect(() => startBotcNomination(state, currentFacts, "p1", "p5")).toThrow(
      "already nominated today",
    );

    const second = startBotcNomination(state, currentFacts, "p2", "p5");
    expect(second.nomineePlayerId).toBe("p5");
    closeBotcNomination(state, currentFacts);

    expect(() => startBotcNomination(state, currentFacts, "p3", "p5")).toThrow(
      "already been nominated today",
    );
    expect(() => startBotcNomination(state, currentFacts, "p5", "p3")).toThrow(
      "Dead BotC players cannot nominate",
    );
  });

  it("lets living players vote on repeated nominations and consumes a dead player's ghost vote only on a closed yes vote", () => {
    const currentFacts = facts({ deadPlayerIds: ["p5"] });
    const state = startBotcDayVotingDay(undefined, 1);

    startBotcNomination(state, currentFacts, "p1", "p2");
    submitBotcDayVote(state, currentFacts, "p3", true);
    submitBotcDayVote(state, currentFacts, "p5", true);
    submitBotcDayVote(state, currentFacts, "p5", false);
    expect(closeBotcNomination(state, currentFacts).yesVoterPlayerIds).toEqual(["p3"]);
    expect(state.spentGhostVotePlayerIds).toEqual([]);

    startBotcNomination(state, currentFacts, "p2", "p3");
    submitBotcDayVote(state, currentFacts, "p3", true);
    submitBotcDayVote(state, currentFacts, "p4", true);
    submitBotcDayVote(state, currentFacts, "p5", true);
    closeBotcNomination(state, currentFacts);
    expect(state.spentGhostVotePlayerIds).toEqual(["p5"]);

    startBotcNomination(state, currentFacts, "p3", "p4");
    submitBotcDayVote(state, currentFacts, "p3", true);
    expect(() => submitBotcDayVote(state, currentFacts, "p5", true)).toThrow(
      "already spent their ghost vote",
    );
    expect(() => submitBotcDayVote(state, currentFacts, "p5", false)).not.toThrow();
  });

  it("uses half-alive threshold, unique-high block, tie clearing, then a later higher block", () => {
    const currentFacts = facts();
    const state = startBotcDayVotingDay(undefined, 1);

    startBotcNomination(state, currentFacts, "p1", "p2");
    for (const voter of ["p1", "p2", "p3"]) {
      submitBotcDayVote(state, currentFacts, voter, true);
    }
    expect(closeBotcNomination(state, currentFacts)).toMatchObject({
      voteCount: 3,
      threshold: 3,
      result: "new_high",
    });
    expect(state).toMatchObject({
      highVoteCount: 3,
      tiedAtHigh: false,
      blockNomineePlayerId: "p2",
    });

    startBotcNomination(state, currentFacts, "p2", "p3");
    for (const voter of ["p1", "p4", "p5"]) {
      submitBotcDayVote(state, currentFacts, voter, true);
    }
    expect(closeBotcNomination(state, currentFacts).result).toBe("tied_high");
    expect(state.highVoteCount).toBe(3);
    expect(state.tiedAtHigh).toBe(true);
    expect(state.blockNomineePlayerId).toBeUndefined();

    startBotcNomination(state, currentFacts, "p3", "p4");
    for (const voter of ["p1", "p2", "p3", "p4"]) {
      submitBotcDayVote(state, currentFacts, voter, true);
    }
    expect(closeBotcNomination(state, currentFacts).result).toBe("new_high");
    expect(state).toMatchObject({
      highVoteCount: 4,
      tiedAtHigh: false,
      blockNomineePlayerId: "p4",
    });
  });

  it("requires a healthy living Butler's master to be voting yes at close", () => {
    const currentFacts = facts({ butlerMasterPlayerId: "p2" });
    const state = startBotcDayVotingDay(undefined, 1);

    startBotcNomination(state, currentFacts, "p3", "p4");
    submitBotcDayVote(state, currentFacts, "p1", true);
    submitBotcDayVote(state, currentFacts, "p3", true);
    submitBotcDayVote(state, currentFacts, "p4", true);
    expect(() => closeBotcNomination(state, currentFacts)).toThrow(
      "BotC voting constraints are not satisfied",
    );

    submitBotcDayVote(state, currentFacts, "p2", true);
    expect(closeBotcNomination(state, currentFacts).voteCount).toBe(4);

    const poisonedState = startBotcDayVotingDay(undefined, 1);
    const poisonedFacts = facts({
      butlerMasterPlayerId: "p2",
      poisonedPlayerId: "p1",
    });
    startBotcNomination(poisonedState, poisonedFacts, "p3", "p4");
    submitBotcDayVote(poisonedState, poisonedFacts, "p1", true);
    submitBotcDayVote(poisonedState, poisonedFacts, "p3", true);
    submitBotcDayVote(poisonedState, poisonedFacts, "p4", true);
    expect(() => closeBotcNomination(poisonedState, poisonedFacts)).not.toThrow();
  });

  it("blocks next-night transition while a unique execution candidate is unresolved", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "washerwoman" },
          { playerId: "p2", actualRoleId: "chef" },
          { playerId: "p3", actualRoleId: "empath" },
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

    module.handleCommand(
      game,
      { playerId: "p1", isModerator: false, now: 1 },
      { type: "nominate", nomineePlayerId: "p2" },
      dependencies,
    );
    for (const playerId of ["p1", "p2", "p3"]) {
      module.handleCommand(
        game,
        { playerId, isModerator: false, now: 1 },
        { type: "submitDayVote", vote: true },
        dependencies,
      );
    }
    const closed = module.handleCommand(
      game,
      { isModerator: true, now: 1 },
      { type: "closeNomination" },
      dependencies,
    );
    expect(closed.outcome).toMatchObject({
      kind: "nominationClosed",
      blockNomineePlayerId: "p2",
      voteCount: 3,
      threshold: 3,
    });

    expect(() =>
      module.handleCommand(
        game,
        { isModerator: true, now: 1 },
        { type: "beginOtherNight" },
        dependencies,
      ),
    ).toThrow("execution resolution is required");
  });

  it("resets daily nomination state at dawn while preserving spent ghost votes", () => {
    const currentFacts = facts({ deadPlayerIds: ["p5"] });
    const firstDay = startBotcDayVotingDay(undefined, 1);
    startBotcNomination(firstDay, currentFacts, "p1", "p2");
    submitBotcDayVote(firstDay, currentFacts, "p3", true);
    submitBotcDayVote(firstDay, currentFacts, "p4", true);
    submitBotcDayVote(firstDay, currentFacts, "p5", true);
    closeBotcNomination(firstDay, currentFacts);

    const secondDay = startBotcDayVotingDay(firstDay, 2);
    expect(secondDay).toMatchObject({
      dayNumber: 2,
      nominationSequence: 0,
      usedNominatorPlayerIds: [],
      usedNomineePlayerIds: [],
      spentGhostVotePlayerIds: ["p5"],
      highVoteCount: 0,
      tiedAtHigh: false,
    });

    const view = createBotcDayVotingPublicView(secondDay, currentFacts);
    expect(view).toMatchObject({
      aliveCount: 4,
      threshold: 2,
      spentGhostVotePlayerIds: ["p5"],
    });
    expect(JSON.stringify(view)).not.toContain("actualRoleId");
    expect(JSON.stringify(view)).not.toContain("poisonedPlayerId");
    expect(JSON.stringify(view)).not.toContain("butlerMasterPlayerId");
  });
});
