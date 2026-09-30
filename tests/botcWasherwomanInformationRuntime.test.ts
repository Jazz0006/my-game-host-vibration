import { describe, expect, it } from "vitest";
import type {
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import type { BotcSetupAssignment } from "../src/games/botc/TroubleBrewingSetup.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

const moderatorContext = {
  isModerator: true,
  now: 1,
};

function playerContext(playerId: string) {
  return {
    playerId,
    isModerator: false,
    now: 1,
  };
}

function createGame(
  assignments: readonly BotcSetupAssignment[],
): {
  module: BotcGameModule;
  game: ReturnType<BotcGameModule["createGame"]>;
  viewContext: GameViewContext;
} {
  const module = new BotcGameModule();
  const playerIds = assignments.map(assignment => assignment.playerId);
  const game = module.createGame(
    {
      playerIds,
      config: { scriptId: "trouble-brewing" },
      assignments,
    },
    dependencies,
  );
  const viewContext: GameViewContext = {
    players: playerIds.map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      seat: index + 1,
    })),
  };
  for (const playerId of playerIds) {
    module.handleCommand(
      game,
      playerContext(playerId),
      { type: "confirmRole" },
      dependencies,
    );
  }
  return { module, game, viewContext };
}

describe("PV-3B2A Washerwoman information runtime", () => {
  it("commits one durable poisoned Washerwoman result, exposes only player-visible content, then advances on recipient acknowledgement", () => {
    const { module, game, viewContext } = createGame([
      { playerId: "p1", actualRoleId: "washerwoman" },
      { playerId: "p2", actualRoleId: "empath" },
      { playerId: "p3", actualRoleId: "chef" },
      { playerId: "p4", actualRoleId: "poisoner" },
      { playerId: "p5", actualRoleId: "imp" },
    ]);

    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      dependencies,
    );
    expect(module.getModeratorView(game, viewContext).nightStep).toMatchObject({
      id: "role:poisoner",
      actorPlayerIds: ["p4"],
    });

    module.handleCommand(
      game,
      playerContext("p4"),
      { type: "submitNightChoice", playerIds: ["p1"] },
      dependencies,
    );
    expect(game.poisonedPlayerId).toBe("p1");
    expect(module.getModeratorView(game, viewContext).nightStep).toMatchObject({
      id: "role:washerwoman",
      actorPlayerIds: ["p1"],
    });

    expect(() =>
      module.handleCommand(
        game,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      ),
    ).toThrow("requires an authoritative information commit");

    const beforeCommit = module.getPlayerView(game, "p1", viewContext);
    expect(beforeCommit).toMatchObject({
      mode: "night_wake",
      nightStep: { id: "role:washerwoman" },
    });
    expect(beforeCommit).not.toHaveProperty("privateInformation");

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
      selectionSource: "baseline_v1",
      candidateId: expect.stringMatching(/^washerwoman:/u),
    });
    expect(game.informationHistory).toHaveLength(1);
    expect(game.informationHistory[0]).toMatchObject({
      stepId: "role:washerwoman",
      nightNumber: 1,
      recipientPlayerId: "p1",
      selectionSource: "baseline_v1",
      acknowledged: false,
      result: {
        kind: "pair",
        abilityRoleId: "washerwoman",
        recipientPlayerId: "p1",
        reliability: "poisoned",
        semanticTruth: "true",
        selectedCandidateId: expect.stringMatching(/^washerwoman:/u),
        shownPlayerIds: [expect.any(String), expect.any(String)],
        selectedResolution: {
          matchingPlayerId: expect.any(String),
          matchSource: expect.any(String),
        },
      },
    });

    const firstView = module.getPlayerView(game, "p1", viewContext);
    const reconnectView = module.getPlayerView(game, "p1", viewContext);
    expect(reconnectView).toEqual(firstView);
    expect(firstView.privateInformation).toMatchObject({
      kind: "pair",
      abilityRoleId: "washerwoman",
      learnedRole: {
        id: expect.any(String),
        name: expect.any(String),
        nameZh: expect.any(String),
      },
      shownPlayerIds: [expect.any(String), expect.any(String)],
    });
    expect(firstView.privateInformation).not.toHaveProperty("reliability");
    expect(firstView.privateInformation).not.toHaveProperty("semanticTruth");
    expect(firstView.privateInformation).not.toHaveProperty("selectedResolution");
    expect(JSON.stringify(firstView)).not.toContain('"poisoned"');

    expect(module.getPublicView(game, viewContext)).not.toHaveProperty(
      "informationDecision",
    );
    const moderator = module.getModeratorView(game, viewContext);
    expect(moderator.informationDecision).toEqual({
      stepId: "role:washerwoman",
      recipientPlayerId: "p1",
      roleId: "washerwoman",
      committed: true,
    });
    expect(moderator.currentInformation?.result.reliability).toBe("poisoned");

    expect(() =>
      module.handleCommand(
        game,
        playerContext("p2"),
        { type: "acknowledgeNightInformation" },
        dependencies,
      ),
    ).toThrow("Only the active BotC information recipient");

    expect(() =>
      module.handleCommand(
        game,
        moderatorContext,
        { type: "completeNightStep" },
        dependencies,
      ),
    ).toThrow("requires player acknowledgement");

    const acknowledged = module.handleCommand(
      game,
      playerContext("p1"),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
    expect(acknowledged.outcome).toEqual({
      kind: "nightInformationAcknowledged",
      completedStepId: "role:washerwoman",
      nextStepId: "role:chef",
      nightComplete: false,
    });
    expect(game.informationHistory[0]?.acknowledged).toBe(true);
    expect(module.getPlayerView(game, "p1", viewContext).mode).toBe("waiting");
  });

  it("records Drunk reliability in canonical history without revealing Drunk status to the shown Washerwoman", () => {
    const { module, game, viewContext } = createGame([
      { playerId: "p1", actualRoleId: "drunk", shownRoleId: "washerwoman" },
      { playerId: "p2", actualRoleId: "saint" },
      { playerId: "p3", actualRoleId: "empath" },
      { playerId: "p4", actualRoleId: "baron" },
      { playerId: "p5", actualRoleId: "imp" },
    ]);

    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      dependencies,
    );
    expect(module.getModeratorView(game, viewContext).nightStep).toMatchObject({
      id: "role:washerwoman",
      actorPlayerIds: ["p1"],
      actorSource: "shown_drunk",
    });

    module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );

    expect(game.informationHistory[0]?.result.reliability).toBe("drunk");
    const playerView = module.getPlayerView(game, "p1", viewContext);
    expect(playerView.privateInformation).toBeDefined();
    expect(JSON.stringify(playerView)).not.toContain("drunk");
    expect(JSON.stringify(playerView)).not.toContain("shown_drunk");
    expect(JSON.stringify(playerView)).not.toContain("reliability");
  });
});
