import { describe, expect, it } from "vitest";
import type { GameModuleDependencies, GameViewContext } from "../src/core/game/GameModule.js";
import { configFromRoleDeck, type GameState } from "../src/domain/game.js";
import { WerewolfGameModule } from "../src/games/werewolf/WerewolfGameModule.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: maxExclusive => Math.max(0, maxExclusive - 1),
    randomId: () => "test-id",
  },
};

const viewContext: GameViewContext = {
  players: [
    { id: "p1", name: "一号", seat: 1 },
    { id: "p2", name: "二号", seat: 2 },
    { id: "p3", name: "三号", seat: 3 },
    { id: "p4", name: "四号", seat: 4 },
    { id: "p5", name: "五号", seat: 5 },
  ],
};

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    config: configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]),
    phase: "night_werewolf",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "werewolf",
      p2: "seer",
      p3: "witch",
      p4: "villager",
      p5: "villager",
    },
    confirmedRolePlayerIds: [],
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

describe("WerewolfGameModule", () => {
  it("creates a werewolf game through the existing rules engine", () => {
    const module = new WerewolfGameModule();
    const config = configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]);

    const game = module.createGame(
      { playerIds: viewContext.players.map(player => player.id), config },
      dependencies,
    );

    expect(game.phase).toBe("role_reveal");
    expect(Object.keys(game.roles)).toHaveLength(5);
    expect(Object.values(game.roles).sort()).toEqual([...config.roleDeck].sort());
  });

  it("delegates player commands to the existing rules engine", () => {
    const module = new WerewolfGameModule();
    const game = state();

    const result = module.handleCommand(
      game,
      { playerId: "p1", isHost: false, now: 123 },
      { type: "submitWolfTarget", targetPlayerId: "p4", actionId: "action-1" },
      dependencies,
    );

    expect(result.state).toBe(game);
    expect(game.wolfTargetId).toBe("p4");
    expect(game.phase).toBe("night_witch");
  });

  it("builds player action views from minimal room membership context", () => {
    const module = new WerewolfGameModule();
    const game = state();

    const view = module.getPlayerView(game, "p1", viewContext);

    expect(view.mode).toBe("wolf_action");
    expect(view.targets).toEqual(viewContext.players);
    expect(view.targets).toContainEqual({ id: "p4", name: "四号", seat: 4 });
  });

  it("keeps host-only vote tally out of the public view boundary", () => {
    const module = new WerewolfGameModule();
    const game = state({
      phase: "day_vote",
      votes: { p1: "p4", p2: "p4" },
    });

    const playerView = module.getPlayerView(game, "p3", viewContext);
    const publicView = module.getPublicView(game, viewContext);
    const hostView = module.getHostView(game, viewContext);

    expect(playerView).not.toHaveProperty("voteTally");
    expect(publicView).not.toHaveProperty("voteTally");
    expect(hostView.voteTally).toEqual({ p4: 2 });
    expect(publicView).toMatchObject({
      phase: "day_vote",
      aliveCount: 5,
      votesRequired: 5,
      votesCast: 2,
      deadPlayerIds: [],
    });
  });

  it("selects acting players inside the game module", () => {
    const module = new WerewolfGameModule();

    expect(module.getActingPlayerIds(state())).toEqual(["p1"]);
    expect(module.getActingPlayerIds(state({ phase: "night_seer" }))).toEqual(["p2"]);
    expect(module.getActingPlayerIds(state({ phase: "day_vote" }))).toEqual([
      "p1", "p2", "p3", "p4", "p5",
    ]);
    expect(module.getActingPlayerIds(state({
      phase: "day_pk",
      pkCandidateIds: ["p1", "p2"],
    }))).toEqual(["p3", "p4", "p5"]);
  });
});
