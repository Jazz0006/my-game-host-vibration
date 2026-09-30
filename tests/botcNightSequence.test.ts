import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import type { BotcSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";
import {
  createTroubleBrewingFirstNightSequence,
  TROUBLE_BREWING_FIRST_NIGHT_ROLE_ORDER,
  TROUBLE_BREWING_OTHER_NIGHT_ROLE_ORDER,
} from "../src/games/botc/TroubleBrewingNightSequence.js";

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

const fivePlayerAssignments: readonly BotcSetupAssignment[] = [
  { playerId: "p1", actualRoleId: "washerwoman" },
  {
    playerId: "p2",
    actualRoleId: "drunk",
    shownRoleId: "empath",
  },
  { playerId: "p3", actualRoleId: "saint" },
  { playerId: "p4", actualRoleId: "baron" },
  { playerId: "p5", actualRoleId: "imp" },
];

const fivePlayerViewContext: GameViewContext = {
  players: fivePlayerAssignments.map((assignment, index) => ({
    id: assignment.playerId,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function createFivePlayerGame(module: BotcGameModule) {
  return module.createGame(
    {
      playerIds: fivePlayerAssignments.map(assignment => assignment.playerId),
      config: { scriptId: "trouble-brewing" },
      assignments: fivePlayerAssignments,
    },
    dependencies,
  );
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

describe("B0B Trouble Brewing night sequence", () => {
  it("matches the canonical Trouble Brewing first/other-night relative role order", () => {
    expect(TROUBLE_BREWING_FIRST_NIGHT_ROLE_ORDER).toEqual([
      "poisoner",
      "spy",
      "washerwoman",
      "librarian",
      "investigator",
      "chef",
      "empath",
      "fortune_teller",
      "butler",
    ]);
    expect(TROUBLE_BREWING_OTHER_NIGHT_ROLE_ORDER).toEqual([
      "poisoner",
      "monk",
      "spy",
      "scarlet_woman",
      "imp",
      "ravenkeeper",
      "undertaker",
      "empath",
      "fortune_teller",
      "butler",
    ]);
  });

  it("skips standard evil-team info in 5–6 player games and wakes a Drunk as their shown role", () => {
    const sequence = createTroubleBrewingFirstNightSequence([
      { playerId: "p1", actualRoleId: "washerwoman", shownRoleId: "washerwoman" },
      { playerId: "p2", actualRoleId: "drunk", shownRoleId: "empath" },
      { playerId: "p3", actualRoleId: "saint", shownRoleId: "saint" },
      { playerId: "p4", actualRoleId: "baron", shownRoleId: "baron" },
      { playerId: "p5", actualRoleId: "imp", shownRoleId: "imp" },
    ]);

    expect(sequence).toEqual([
      {
        id: "role:washerwoman",
        kind: "role",
        roleId: "washerwoman",
        actorPlayerIds: ["p1"],
        actorSource: "actual",
      },
      {
        id: "role:empath",
        kind: "role",
        roleId: "empath",
        actorPlayerIds: ["p2"],
        actorSource: "shown_drunk",
      },
    ]);
  });

  it("starts 7+ player first nights with Minion info then Demon info", () => {
    const sequence = createTroubleBrewingFirstNightSequence([
      { playerId: "p1", actualRoleId: "poisoner", shownRoleId: "poisoner" },
      { playerId: "p2", actualRoleId: "imp", shownRoleId: "imp" },
      { playerId: "p3", actualRoleId: "washerwoman", shownRoleId: "washerwoman" },
      { playerId: "p4", actualRoleId: "librarian", shownRoleId: "librarian" },
      { playerId: "p5", actualRoleId: "investigator", shownRoleId: "investigator" },
      { playerId: "p6", actualRoleId: "chef", shownRoleId: "chef" },
      { playerId: "p7", actualRoleId: "fortune_teller", shownRoleId: "fortune_teller" },
    ]);

    expect(sequence.map(step => step.id)).toEqual([
      "minion_info",
      "demon_info",
      "role:poisoner",
      "role:washerwoman",
      "role:librarian",
      "role:investigator",
      "role:chef",
      "role:fortune_teller",
    ]);
    expect(sequence[0]).toMatchObject({ actorPlayerIds: ["p1"] });
    expect(sequence[1]).toMatchObject({ actorPlayerIds: ["p2"] });
  });

  it("progresses role reveal -> first night -> day without leaking the Drunk identity", () => {
    const module = new BotcGameModule();
    const game = createFivePlayerGame(module);

    expect(() =>
      module.handleCommand(
        game,
        moderatorContext,
        { type: "beginFirstNight" },
        dependencies,
      ),
    ).toThrow("All BotC players must confirm");

    confirmAll(module, game);

    expect(() =>
      module.handleCommand(
        game,
        playerContext("p1"),
        { type: "beginFirstNight" },
        dependencies,
      ),
    ).toThrow("Only the BotC moderator");

    const started = module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      dependencies,
    );
    expect(started.outcome).toEqual({
      kind: "firstNightStarted",
      firstStepId: "role:washerwoman",
      nightComplete: false,
    });
    expect(game).toMatchObject({
      phase: "first_night",
      nightNumber: 1,
      dayNumber: 0,
      nightStepIndex: 0,
    });

    expect(module.getPlayerView(game, "p1", fivePlayerViewContext)).toMatchObject({
      mode: "night_wake",
      nightStep: {
        id: "role:washerwoman",
        kind: "role",
        roleId: "washerwoman",
      },
    });
    expect(module.getPlayerView(game, "p2", fivePlayerViewContext).mode).toBe(
      "waiting",
    );

    const publicView = module.getPublicView(game, fivePlayerViewContext);
    expect(publicView).not.toHaveProperty("nightStep");

    const moderatorView = module.getModeratorView(game, fivePlayerViewContext);
    expect(moderatorView.nightStep).toEqual({
      id: "role:washerwoman",
      kind: "role",
      roleId: "washerwoman",
      actorPlayerIds: ["p1"],
      actorSource: "actual",
    });

    expect(() =>
      module.handleCommand(
        game,
        playerContext("p1"),
        { type: "completeNightStep" },
        dependencies,
      ),
    ).toThrow("Only the BotC moderator");

    const committed = module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );
    expect(committed.outcome).toMatchObject({
      kind: "nightInformationCommitted",
      stepId: "role:washerwoman",
      recipientPlayerId: "p1",
    });
    expect(
      module.getPlayerView(game, "p1", fivePlayerViewContext).privateInformation,
    ).toBeDefined();

    const advanced = module.handleCommand(
      game,
      playerContext("p1"),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
    expect(advanced.outcome).toEqual({
      kind: "nightInformationAcknowledged",
      completedStepId: "role:washerwoman",
      nextStepId: "role:empath",
      nightComplete: false,
    });

    const drunkView = module.getPlayerView(game, "p2", fivePlayerViewContext);
    expect(drunkView).toMatchObject({
      mode: "night_wake",
      roleId: "empath",
      nightStep: {
        id: "role:empath",
        kind: "role",
        roleId: "empath",
      },
    });
    expect(JSON.stringify(drunkView)).not.toContain("drunk");
    expect(JSON.stringify(drunkView)).not.toContain("shown_drunk");

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
      nightNumber: 1,
      dayNumber: 1,
    });
    expect(game).not.toHaveProperty("nightStepIndex");
    expect(module.getPlayerView(game, "p2", fivePlayerViewContext).mode).toBe(
      "day",
    );
  });

  it("closes an empty first-night plan directly into day", () => {
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

    const result = module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      dependencies,
    );

    expect(result.outcome).toEqual({
      kind: "firstNightStarted",
      nightComplete: true,
    });
    expect(game).toMatchObject({
      phase: "day",
      dayNumber: 1,
      nightNumber: 1,
    });
  });
});
