import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import { configFromRoleDeck } from "../src/domain/game.js";
import {
  WerewolfGameModule,
  type WerewolfCommand,
} from "../src/games/werewolf/WerewolfGameModule.js";

function createDependencies(): GameModuleDependencies {
  let nextId = 1;
  return {
    random: {
      randomInt: maxExclusive => Math.max(0, maxExclusive - 1),
      randomId: () => `action-${nextId++}`,
    },
  };
}

const players: GameViewContext["players"] = [
  { id: "p1", name: "一号", seat: 1 },
  { id: "p2", name: "二号", seat: 2 },
  { id: "p3", name: "三号", seat: 3 },
  { id: "p4", name: "四号", seat: 4 },
  { id: "p5", name: "五号", seat: 5 },
];

const viewContext: GameViewContext = { players };

function playerContext(playerId: string): GameCommandContext {
  return { playerId, isHost: false, now: 1_000 };
}

function hostContext(): GameCommandContext {
  return { isHost: true, now: 1_000 };
}

describe("GameModule contract", () => {
  it("runs a complete werewolf game without server, transport, session, or UI runtime state", () => {
    const module = new WerewolfGameModule();
    const dependencies = createDependencies();
    const config = configFromRoleDeck(5, [
      "werewolf",
      "seer",
      "witch",
      "villager",
      "villager",
    ]);

    const game = module.createGame(
      { playerIds: players.map(player => player.id), config },
      dependencies,
    );

    // Deterministic randomInt keeps the configured role order unchanged.
    expect(game.roles).toEqual({
      p1: "werewolf",
      p2: "seer",
      p3: "witch",
      p4: "villager",
      p5: "villager",
    });
    expect(game.phase).toBe("role_reveal");

    for (const player of players) {
      module.handleCommand(
        game,
        playerContext(player.id),
        { type: "confirmRole", actionId: game.actionId },
        dependencies,
      );
    }
    expect(game.phase).toBe("night_start");

    module.handleCommand(game, hostContext(), { type: "startNight" }, dependencies);
    expect(game.phase).toBe("night_werewolf");

    module.handleCommand(
      game,
      playerContext("p1"),
      { type: "submitWolfTarget", targetPlayerId: "p4", actionId: game.actionId },
      dependencies,
    );
    expect(game.phase).toBe("night_witch");

    module.handleCommand(
      game,
      playerContext("p3"),
      { type: "submitWitchAction", actionId: game.actionId },
      dependencies,
    );
    expect(game.phase).toBe("night_seer");

    module.handleCommand(
      game,
      playerContext("p2"),
      { type: "submitSeerTarget", targetPlayerId: "p1", actionId: game.actionId },
      dependencies,
    );

    const seerView = module.getPlayerView(game, "p2", viewContext);
    expect(seerView).toMatchObject({
      mode: "seer_result",
      checkedAlignment: "werewolf",
    });

    module.handleCommand(
      game,
      playerContext("p2"),
      { type: "confirmSeerResult", actionId: game.actionId },
      dependencies,
    );
    expect(game.phase).toBe("night_complete");
    expect(game.deadPlayerIds).toEqual(["p4"]);

    module.handleCommand(game, hostContext(), { type: "startDayVote" }, dependencies);
    expect(game.phase).toBe("day_vote");

    const voteActionId = game.actionId;
    const votes: Array<[string, string]> = [
      ["p1", "p2"],
      ["p2", "p1"],
      ["p3", "p1"],
      ["p5", "p1"],
    ];
    for (const [voterId, targetId] of votes) {
      const command: WerewolfCommand = {
        type: "submitVote",
        targetId,
        actionId: voteActionId,
      };
      module.handleCommand(game, playerContext(voterId), command, dependencies);
    }

    const hostView = module.getHostView(game, viewContext);
    expect(hostView).toMatchObject({
      phase: "day_vote",
      aliveCount: 4,
      votesCast: 4,
      voteTally: { p1: 3, p2: 1 },
    });

    const publicView = module.getPublicView(game, viewContext);
    expect(publicView).not.toHaveProperty("roles");
    expect(publicView).not.toHaveProperty("voteTally");

    module.handleCommand(game, hostContext(), { type: "closeDayVote" }, dependencies);

    expect(game.phase).toBe("game_over");
    expect(game.winner).toBe("village");
    expect(game.deadPlayerIds).toEqual(["p4", "p1"]);

    const runtimeOnlyFields = [
      "socketId",
      "connected",
      "sessionToken",
      "resumeTokenHash",
      "roomCode",
      "isHost",
    ];
    for (const field of runtimeOnlyFields) {
      expect(game).not.toHaveProperty(field);
    }
  });
});
