import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import {
  BotcGameModule,
  type BotcGameState,
} from "../src/games/botc/BotcGameModule.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6"] as const;
const viewContext: GameViewContext = {
  players: playerIds.map((id, index) => ({
    id,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function playerContext(playerId: string): GameCommandContext {
  return {
    playerId,
    isModerator: false,
    now: 10,
  };
}

const moderatorContext: GameCommandContext = {
  isModerator: true,
  now: 10,
};

function createFirstNight(): {
  module: BotcGameModule;
  state: BotcGameState;
} {
  const module = new BotcGameModule();
  const state = module.createGame(
    {
      playerIds,
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "poisoner" },
        { playerId: "p2", actualRoleId: "imp" },
        { playerId: "p3", actualRoleId: "butler" },
        { playerId: "p4", actualRoleId: "washerwoman" },
        { playerId: "p5", actualRoleId: "chef" },
        { playerId: "p6", actualRoleId: "empath" },
      ],
    },
    dependencies,
  );

  for (const playerId of playerIds) {
    module.handleCommand(
      state,
      playerContext(playerId),
      { type: "confirmRole" },
      dependencies,
    );
  }
  module.handleCommand(
    state,
    moderatorContext,
    { type: "beginFirstNight" },
    dependencies,
  );

  return { module, state };
}

describe("PV-3B1 Trouble Brewing player night choices", () => {
  it("commits Poisoner and Butler single-target choices through the active night cursor", () => {
    const { module, state } = createFirstNight();

    expect(module.getPlayerView(state, "p1", viewContext)).toMatchObject({
      mode: "night_wake",
      nightStep: {
        id: "role:poisoner",
        roleId: "poisoner",
        choice: {
          kind: "player_targets",
          minTargets: 1,
          maxTargets: 1,
          allowedPlayerIds: [...playerIds],
        },
      },
    });

    expect(() =>
      module.handleCommand(
        state,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      ),
    ).toThrow("Active BotC night step requires a player choice");

    expect(() =>
      module.handleCommand(
        state,
        playerContext("p2"),
        { type: "submitNightChoice", playerIds: ["p4"] },
        dependencies,
      ),
    ).toThrow("Only the active BotC night actor");

    const poison = module.handleCommand(
      state,
      playerContext("p1"),
      { type: "submitNightChoice", playerIds: ["p4"] },
      dependencies,
    );
    expect(poison.outcome).toEqual({
      kind: "nightChoiceCommitted",
      completedStepId: "role:poisoner",
      selectedPlayerIds: ["p4"],
      nextStepId: "role:washerwoman",
      nightComplete: false,
    });
    expect(state.poisonedPlayerId).toBe("p4");

    for (const stepId of [
      "role:washerwoman",
      "role:chef",
      "role:empath",
    ]) {
      expect(module.getModeratorView(state, viewContext).nightStep?.id).toBe(stepId);
      module.handleCommand(
        state,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      );
    }

    const butlerView = module.getPlayerView(state, "p3", viewContext);
    expect(butlerView).toMatchObject({
      mode: "night_wake",
      nightStep: {
        id: "role:butler",
        roleId: "butler",
        choice: {
          kind: "player_targets",
          minTargets: 1,
          maxTargets: 1,
        },
      },
    });
    expect(butlerView.nightStep?.choice?.allowedPlayerIds).not.toContain("p3");

    expect(() =>
      module.handleCommand(
        state,
        playerContext("p3"),
        { type: "submitNightChoice", playerIds: ["p3"] },
        dependencies,
      ),
    ).toThrow("Selected player is not a legal target");

    const butler = module.handleCommand(
      state,
      playerContext("p3"),
      { type: "submitNightChoice", playerIds: ["p5"] },
      dependencies,
    );
    expect(butler.outcome).toEqual({
      kind: "nightChoiceCommitted",
      completedStepId: "role:butler",
      selectedPlayerIds: ["p5"],
      nightComplete: true,
    });
    expect(state.phase).toBe("day");
    expect(state.poisonedPlayerId).toBe("p4");
    expect(state.butlerMasterPlayerId).toBe("p5");

    expect(module.getPublicView(state, viewContext)).not.toHaveProperty(
      "poisonedPlayerId",
    );
    expect(module.getPublicView(state, viewContext)).not.toHaveProperty(
      "butlerMasterPlayerId",
    );
    expect(module.getModeratorView(state, viewContext)).toMatchObject({
      nightEffects: {
        poisonedPlayerId: "p4",
        butlerMasterPlayerId: "p5",
      },
    });
  });

  it("expires the previous Poisoner target and Butler master at the next dusk", () => {
    const { module, state } = createFirstNight();

    module.handleCommand(
      state,
      playerContext("p1"),
      { type: "submitNightChoice", playerIds: ["p4"] },
      dependencies,
    );
    for (let index = 0; index < 3; index += 1) {
      module.handleCommand(
        state,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      );
    }
    module.handleCommand(
      state,
      playerContext("p3"),
      { type: "submitNightChoice", playerIds: ["p5"] },
      dependencies,
    );

    expect(state.phase).toBe("day");
    module.handleCommand(
      state,
      moderatorContext,
      { type: "beginOtherNight" },
      dependencies,
    );

    expect(state.poisonedPlayerId).toBeUndefined();
    expect(state.butlerMasterPlayerId).toBeUndefined();
    expect(module.getModeratorView(state, viewContext).nightStep?.id).toBe(
      "role:poisoner",
    );
  });
});
