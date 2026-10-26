import { describe, expect, it } from "vitest";
import { BotcGameModule, type BotcCommand } from "../src/games/botc/BotcGameModule.js";
import { resolveTroubleBrewingImpAttack } from "../src/games/botc/TroubleBrewingLife.js";
import type { TroubleBrewingRoleId } from "../src/games/botc/TroubleBrewing.js";

function session(roles: TroubleBrewingRoleId[] = ["poisoner", "imp", "monk", "ravenkeeper", "empath"]) {
  const module = new BotcGameModule();
  const ids = roles.map((_, index) => `p${index + 1}`);
  const dependencies = { random: { randomInt: () => 0, randomId: () => "playable-game" } };
  const game = module.createGame({ playerIds: ids, config: { scriptId: "trouble-brewing" },
    assignments: roles.map((actualRoleId, index) => ({ playerId: ids[index]!, actualRoleId })) }, dependencies);
  const context = { players: ids.map((id, index) => ({ id, name: id, seat: index + 1 })) };
  let now = 0;
  const send = (command: BotcCommand, playerId?: string) => module.handleCommand(game, {
    ...(playerId ? { playerId } : {}), isModerator: !playerId, now: ++now,
    actionId: game.interactionId, automaticInformation: true,
  }, command, dependencies);
  return { module, game, ids, context, send };
}

describe("PV4 minimal playable Session", () => {
  it("runs poisoned protection, action-time death, private death information, Dawn, ghost vote, protected night and a good victory on one Session", () => {
    const { module, game, ids, context, send } = session();
    const initial = structuredClone(game.initialSetup);
    for (const id of ids) send({ type: "confirmRole" }, id);
    send({ type: "beginFirstNight" });
    send({ type: "submitNightChoice", playerIds: ["p1"] }, "p1");
    send({ type: "acknowledgeNightInformation" }, "p5");
    send({ type: "closeDay" });
    send({ type: "beginOtherNight" });
    send({ type: "submitNightChoice", playerIds: ["p3"] }, "p1");
    send({ type: "submitNightChoice", playerIds: ["p4"] }, "p3");
    expect(game.monkProtectedPlayerId).toBeUndefined();
    send({ type: "submitNightChoice", playerIds: ["p4"] }, "p2");
    expect(game.deadPlayerIds).toContain("p4");
    expect(module.getPublicView(game, context).deadPlayerIds).not.toContain("p4");
    send({ type: "submitNightChoice", playerIds: ["p2"] }, "p4");
    expect(module.getPlayerView(game, "p4", context).privateInformation).toEqual({
      kind: "character", abilityRoleId: "ravenkeeper", learnedRole: { id: "imp", name: "Imp", nameZh: "小恶魔" },
    });
    expect(module.getPlayerView(game, "p3", context)).not.toHaveProperty("privateInformation");
    send({ type: "acknowledgeNightInformation" }, "p4");
    send({ type: "acknowledgeNightInformation" }, "p5");
    expect(module.getPublicView(game, context)).toMatchObject({ phase: "day", dayNumber: 2, deadPlayerIds: ["p4"] });
    send({ type: "nominate", playerId: "p1" }, "p3");
    for (const id of ids) send({ type: "vote", approve: true }, id);
    send({ type: "finishVote" });
    send({ type: "closeDay" });
    expect(game.day).toMatchObject({ executionPlayerId: "p1", executionDied: true });
    expect(game.ghostVoteSpentPlayerIds).toEqual(["p4"]);
    send({ type: "beginOtherNight" });
    send({ type: "submitNightChoice", playerIds: ["p5"] }, "p3");
    send({ type: "submitNightChoice", playerIds: ["p5"] }, "p2");
    expect(game.deadPlayerIds).not.toContain("p5");
    send({ type: "acknowledgeNightInformation" }, "p5");
    send({ type: "nominate", playerId: "p2" }, "p3");
    expect(() => send({ type: "vote", approve: true }, "p4")).toThrow("Ghost vote is already spent");
    for (const id of ["p2", "p3", "p5"]) send({ type: "vote", approve: true }, id);
    send({ type: "finishVote" });
    send({ type: "closeDay" });
    expect(game).toMatchObject({ phase: "finished", winner: { team: "good", reason: "demon_dead" } });
    expect(game.initialSetup).toEqual(initial);
    expect(() => send({ type: "beginOtherNight" })).toThrow("only begin from day");
  });

  it("leaves no execution on a tied highest vote and distinguishes executing a dead nominee from a new death", () => {
    const first = session();
    first.game.phase = "day";
    first.game.dayNumber = 1;
    for (const [nominator, target] of [["p1", "p3"], ["p2", "p4"]]) {
      first.send({ type: "nominate", playerId: target! }, nominator);
      for (const id of ["p1", "p2", "p3"]) first.send({ type: "vote", approve: true }, id);
      first.send({ type: "finishVote" });
    }
    first.send({ type: "closeDay" });
    expect(first.game.day).not.toHaveProperty("executionPlayerId");
    expect(first.game.deadPlayerIds).toEqual([]);
    const second = session();
    second.game.phase = "day";
    second.game.dayNumber = 1;
    second.game.deadPlayerIds = ["p4"];
    second.send({ type: "nominate", playerId: "p4" }, "p3");
    for (const id of ["p1", "p2", "p3"]) second.send({ type: "vote", approve: true }, id);
    second.send({ type: "finishVote" });
    second.send({ type: "closeDay" });
    expect(second.game.day).toMatchObject({ executionPlayerId: "p4", executionDied: false });
    expect(second.game).not.toHaveProperty("executedAndDiedTodayPlayerId");
  });

  it("resolves healthy versus poisoned Soldier and Imp succession at action time", () => {
    const { game } = session(["poisoner", "imp", "monk", "soldier", "empath"]);
    expect(resolveTroubleBrewingImpAttack(game, "p2", "p4")).toBeUndefined();
    game.poisonedPlayerId = "p4";
    expect(resolveTroubleBrewingImpAttack(game, "p2", "p4")).toMatchObject({ died: true, deadPlayerIds: ["p4"] });
    const succession = resolveTroubleBrewingImpAttack(game, "p2", "p2")!;
    expect(succession.assignments.find(item => item.playerId === "p1")).toMatchObject({ actualRoleId: "imp", shownRoleId: "imp" });
    expect(succession.roleTransitions).toContainEqual({ kind: "imp_self_kill_to_imp", previousImpPlayerId: "p2", newImpPlayerId: "p1" });
    expect(game.assignments.find(item => item.playerId === "p1")!.actualRoleId).toBe("poisoner");
  });

  it("ends with evil victory when repeated nights reduce the town to two living players", () => {
    const { game, ids, send } = session(["poisoner", "imp", "washerwoman", "librarian", "investigator"]);
    for (const id of ids) send({ type: "confirmRole" }, id);
    send({ type: "beginFirstNight" });
    send({ type: "submitNightChoice", playerIds: ["p1"] }, "p1");
    for (const id of ["p3", "p4", "p5"]) send({ type: "acknowledgeNightInformation" }, id);
    for (const target of ["p3", "p4", "p5"]) {
      send({ type: "closeDay" });
      send({ type: "beginOtherNight" });
      send({ type: "submitNightChoice", playerIds: ["p1"] }, "p1");
      send({ type: "submitNightChoice", playerIds: [target] }, "p2");
    }
    expect(game).toMatchObject({ phase: "finished", winner: { team: "evil", reason: "two_alive" } });
  });

  it("does not count a healthy Butler's vote when the master abstains", () => {
    const { game, send } = session(["poisoner", "imp", "butler", "soldier", "monk", "empath"]);
    game.phase = "day";
    game.dayNumber = 1;
    game.butlerMasterPlayerId = "p2";
    send({ type: "nominate", playerId: "p1" }, "p3");
    for (const id of ["p3", "p4", "p5"]) send({ type: "vote", approve: true }, id);
    send({ type: "vote", approve: false }, "p2");
    send({ type: "finishVote" });
    expect(game.day!.tallies[0]).toMatchObject({ voteCount: 2, threshold: 3 });
    send({ type: "closeDay" });
    expect(game.day).not.toHaveProperty("executionPlayerId");
  });

  it("delivers Undertaker information from the actual player who died by execution", () => {
    const { module, game, ids, context, send } = session(["poisoner", "imp", "undertaker", "soldier", "monk"]);
    for (const id of ids) send({ type: "confirmRole" }, id);
    send({ type: "beginFirstNight" });
    send({ type: "submitNightChoice", playerIds: ["p1"] }, "p1");
    send({ type: "nominate", playerId: "p4" }, "p3");
    for (const id of ["p1", "p2", "p3"]) send({ type: "vote", approve: true }, id);
    send({ type: "finishVote" });
    send({ type: "closeDay" });
    send({ type: "beginOtherNight" });
    send({ type: "submitNightChoice", playerIds: ["p1"] }, "p1");
    send({ type: "submitNightChoice", playerIds: ["p2"] }, "p5");
    send({ type: "submitNightChoice", playerIds: ["p4"] }, "p2");
    expect(module.getPlayerView(game, "p3", context).privateInformation).toMatchObject({
      kind: "character", abilityRoleId: "undertaker", learnedRole: { id: "soldier" },
    });
    expect(module.getPlayerView(game, "p1", context)).not.toHaveProperty("privateInformation");
    send({ type: "acknowledgeNightInformation" }, "p3");
    expect(game.phase).toBe("day");
  });
});
