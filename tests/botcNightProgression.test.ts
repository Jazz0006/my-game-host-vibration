import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

const moderatorContext: GameCommandContext = {
  isModerator: true,
  now: 1_000,
};

function playerContext(playerId: string): GameCommandContext {
  return {
    playerId,
    isModerator: false,
    now: 1_000,
  };
}

function confirmAll(
  module: BotcGameModule,
  game: ReturnType<BotcGameModule["createGame"]>,
): void {
  for (const assignment of game.assignments) {
    module.handleCommand(
      game,
      playerContext(assignment.playerId),
      { type: "confirmRole" },
      dependencies,
    );
  }
}

function completeFirstNight(
  module: BotcGameModule,
  game: ReturnType<BotcGameModule["createGame"]>,
): void {
  const started = module.handleCommand(
    game,
    moderatorContext,
    { type: "beginFirstNight" },
    dependencies,
  );

  while (started.state.phase === "first_night") {
    const step = module.getModeratorView(game, { players: [] }).nightStep;
    if (step?.id === "role:poisoner") {
      module.handleCommand(
        game,
        playerContext("p1"),
        { type: "submitNightChoice", playerIds: ["p5"] },
        dependencies,
      );
    } else {
      module.handleCommand(
        game,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      );
    }
  }
}

describe("B0B3 Trouble Brewing live other-night progression", () => {
  it("re-evaluates later eligibility after each completed step without replaying prior slots", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "poisoner" },
          { playerId: "p2", actualRoleId: "imp" },
          { playerId: "p3", actualRoleId: "ravenkeeper" },
          { playerId: "p4", actualRoleId: "monk" },
          { playerId: "p5", actualRoleId: "empath" },
        ],
      },
      dependencies,
    );

    confirmAll(module, game);
    completeFirstNight(module, game);
    expect(game).toMatchObject({ phase: "day", dayNumber: 1, nightNumber: 1 });

    const started = module.handleCommand(
      game,
      moderatorContext,
      { type: "beginOtherNight" },
      dependencies,
    );
    expect(started.outcome).toEqual({
      kind: "otherNightStarted",
      firstStepId: "role:poisoner",
      nightComplete: false,
    });

    expect(
      module.handleCommand(
        game,
        playerContext("p1"),
        { type: "submitNightChoice", playerIds: ["p5"] },
        dependencies,
      ).outcome,
    ).toEqual({
      kind: "nightChoiceCommitted",
      completedStepId: "role:poisoner",
      selectedPlayerIds: ["p5"],
      nextStepId: "role:monk",
      nightComplete: false,
    });

    expect(
      module.handleCommand(
        game,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      ).outcome,
    ).toEqual({
      kind: "nightStepCompleted",
      completedStepId: "role:monk",
      nextStepId: "role:imp",
      nightComplete: false,
    });

    // This directly simulates facts that a later Rules/Information owner will
    // commit while resolving the active Imp action. There is deliberately no
    // moderator command for injecting arbitrary deaths into production state.
    game.deadPlayerIds.push("p3");
    game.diedTonightPlayerIds.push("p3");

    expect(module.getModeratorView(game, { players: [] }).nightStep).toMatchObject({
      id: "role:imp",
      actorPlayerIds: ["p2"],
    });

    const afterImp = module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      dependencies,
    );
    expect(afterImp.outcome).toEqual({
      kind: "nightStepCompleted",
      completedStepId: "role:imp",
      nextStepId: "role:ravenkeeper",
      nightComplete: false,
    });

    const afterRavenkeeper = module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      dependencies,
    );
    expect(afterRavenkeeper.outcome).toEqual({
      kind: "nightStepCompleted",
      completedStepId: "role:ravenkeeper",
      nextStepId: "role:empath",
      nightComplete: false,
    });

    const completed = module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      dependencies,
    );
    expect(completed.outcome).toEqual({
      kind: "nightStepCompleted",
      completedStepId: "role:empath",
      nightComplete: true,
    });
    expect(game).toMatchObject({
      phase: "day",
      dayNumber: 2,
      nightNumber: 2,
      diedTonightPlayerIds: [],
      roleTransitions: [],
    });
    expect(game).not.toHaveProperty("otherNightProgress");
  });

  it("keeps role-change notifications private to the actor and moderator", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
        config: { scriptId: "trouble-brewing" },
        assignments: [
          { playerId: "p1", actualRoleId: "virgin" },
          { playerId: "p2", actualRoleId: "slayer" },
          { playerId: "p3", actualRoleId: "soldier" },
          { playerId: "p4", actualRoleId: "scarlet_woman" },
          { playerId: "p5", actualRoleId: "imp" },
        ],
      },
      dependencies,
    );

    confirmAll(module, game);
    completeFirstNight(module, game);
    game.deadPlayerIds.push("p5");
    game.roleTransitions.push({
      kind: "scarlet_woman_to_imp",
      playerId: "p4",
    });

    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginOtherNight" },
      dependencies,
    );

    const viewContext: GameViewContext = {
      players: game.assignments.map((assignment, index) => ({
        id: assignment.playerId,
        name: `Player ${index + 1}`,
        seat: index + 1,
      })),
    };

    const actorView = module.getPlayerView(game, "p4", viewContext);
    expect(actorView).toMatchObject({
      mode: "night_wake",
      roleId: "imp",
      roleName: "Imp",
      nightStep: {
        id: "role_change:scarlet_woman_to_imp",
        kind: "role_change_info",
        roleId: "imp",
      },
    });

    expect(module.getPlayerView(game, "p1", viewContext).nightStep).toBeUndefined();
    expect(module.getPublicView(game, viewContext)).not.toHaveProperty("nightStep");
    expect(module.getModeratorView(game, viewContext).nightStep).toMatchObject({
      id: "role_change:scarlet_woman_to_imp",
      transitionKind: "scarlet_woman_to_imp",
      actorPlayerIds: ["p4"],
    });

    const advanced = module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      dependencies,
    );
    expect(advanced.outcome).toEqual({
      kind: "nightStepCompleted",
      completedStepId: "role_change:scarlet_woman_to_imp",
      nextStepId: "role:imp",
      nightComplete: false,
    });
    expect(module.getPlayerView(game, "p4", viewContext).nightStep).toMatchObject({
      id: "role:imp",
      roleId: "imp",
    });

    const completed = module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      dependencies,
    );
    expect(completed.outcome).toEqual({
      kind: "nightStepCompleted",
      completedStepId: "role:imp",
      nightComplete: true,
    });
    expect(game.assignments.find(item => item.playerId === "p4")).toMatchObject({
      actualRoleId: "imp",
      shownRoleId: "imp",
    });
    expect(game.roleTransitions).toEqual([]);

    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginOtherNight" },
      dependencies,
    );
    expect(module.getModeratorView(game, viewContext).nightStep).toMatchObject({
      id: "role:imp",
      actorPlayerIds: ["p4"],
    });
  });
});
