import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
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

const moderator: GameCommandContext = { isModerator: true, now: 1 };
const player = (playerId: string): GameCommandContext => ({
  playerId,
  isModerator: false,
  now: 1,
});

const playerIds = ["p1", "p2", "p3", "p4", "p5"] as const;
const assignments: readonly BotcSetupAssignment[] = [
  { playerId: "p1", actualRoleId: "fortune_teller" },
  { playerId: "p2", actualRoleId: "chef" },
  { playerId: "p3", actualRoleId: "empath" },
  { playerId: "p4", actualRoleId: "poisoner" },
  { playerId: "p5", actualRoleId: "imp" },
];
const viewContext: GameViewContext = {
  players: playerIds.map((id, index) => ({
    id,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function createAtFirstNight() {
  const module = new BotcGameModule();
  const game = module.createGame(
    {
      playerIds: [...playerIds],
      config: { scriptId: "trouble-brewing" },
      assignments,
    },
    dependencies,
  );
  for (const id of playerIds) {
    module.handleCommand(game, player(id), { type: "confirmRole" }, dependencies);
  }
  module.handleCommand(
    game,
    moderator,
    { type: "setRedHerring", playerId: "p3" },
    dependencies,
  );
  module.handleCommand(game, moderator, { type: "beginFirstNight" }, dependencies);
  return { module, game };
}

function commitAndAck(
  module: BotcGameModule,
  game: ReturnType<BotcGameModule["createGame"]>,
  recipientPlayerId: string,
) {
  module.handleCommand(
    game,
    moderator,
    { type: "commitNightInformation" },
    dependencies,
  );
  module.handleCommand(
    game,
    player(recipientPlayerId),
    { type: "acknowledgeNightInformation" },
    dependencies,
  );
}

describe("PV-3B3 Fortune Teller runtime", () => {
  it("persists one Red Herring before first night and keeps it moderator-only", () => {
    const { module, game } = createAtFirstNight();

    expect(game.redHerring).toEqual({
      playerId: "p3",
      selectionSource: "moderator",
    });
    expect(module.getModeratorView(game, viewContext).redHerring).toEqual({
      playerId: "p3",
      selectionSource: "moderator",
    });
    for (const id of playerIds) {
      expect(JSON.stringify(module.getPlayerView(game, id, viewContext))).not.toContain(
        "redHerring",
      );
    }
  });

  it("records two distinct targets without advancing, then commits private YES and advances only after acknowledgement", () => {
    const { module, game } = createAtFirstNight();

    module.handleCommand(
      game,
      player("p4"),
      { type: "submitNightChoice", playerIds: ["p2"] },
      dependencies,
    );
    commitAndAck(module, game, "p2");
    commitAndAck(module, game, "p3");

    expect(module.getModeratorView(game, viewContext).nightStep?.id).toBe(
      "role:fortune_teller",
    );
    expect(
      module.getPlayerView(game, "p1", viewContext).nightStep?.choice,
    ).toMatchObject({
      minTargets: 2,
      maxTargets: 2,
    });

    expect(() =>
      module.handleCommand(
        game,
        player("p1"),
        { type: "submitNightChoice", playerIds: ["p2", "p2"] },
        dependencies,
      ),
    ).toThrow(/distinct/i);

    const selected = module.handleCommand(
      game,
      player("p1"),
      { type: "submitNightChoice", playerIds: ["p2", "p3"] },
      dependencies,
    );
    expect(selected.outcome).toEqual({
      kind: "nightChoiceRecorded",
      stepId: "role:fortune_teller",
      selectedPlayerIds: ["p2", "p3"],
    });
    expect(game.fortuneTellerChoice).toEqual({
      nightNumber: 1,
      playerIds: ["p2", "p3"],
    });
    expect(module.getModeratorView(game, viewContext).nightStep?.id).toBe(
      "role:fortune_teller",
    );
    expect(module.getModeratorView(game, viewContext).informationDecision).toMatchObject({
      stepId: "role:fortune_teller",
      recipientPlayerId: "p1",
      roleId: "fortune_teller",
      committed: false,
    });
    expect(
      module.getPlayerView(game, "p1", viewContext).nightStep?.choice,
    ).toBeUndefined();

    module.handleCommand(
      game,
      moderator,
      { type: "commitNightInformation" },
      dependencies,
    );

    expect(game.informationHistory.at(-1)).toMatchObject({
      stepId: "role:fortune_teller",
      recipientPlayerId: "p1",
      result: {
        kind: "boolean",
        abilityRoleId: "fortune_teller",
        value: true,
        reliability: "reliable",
        semanticTruth: "true",
        selectedCandidateId: "fortune_teller:boolean:yes",
        selectedResolution: {
          kind: "fortune_teller",
          selectedPlayerIds: ["p2", "p3"],
        },
      },
    });
    expect(module.getPlayerView(game, "p1", viewContext).privateInformation).toEqual({
      kind: "boolean",
      abilityRoleId: "fortune_teller",
      value: true,
    });
    expect(JSON.stringify(module.getPlayerView(game, "p1", viewContext))).not.toContain(
      "redHerring",
    );

    const acknowledged = module.handleCommand(
      game,
      player("p1"),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
    expect(acknowledged.outcome).toEqual({
      kind: "nightInformationAcknowledged",
      completedStepId: "role:fortune_teller",
      nightComplete: true,
    });
    expect(game.phase).toBe("day");
    expect(game.fortuneTellerChoice).toBeUndefined();
  });

  it("auto-selects a persistent actual-good Red Herring when none was precommitted", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      {
        playerIds: [...playerIds],
        config: { scriptId: "trouble-brewing" },
        assignments,
      },
      dependencies,
    );
    for (const id of playerIds) {
      module.handleCommand(game, player(id), { type: "confirmRole" }, dependencies);
    }

    module.handleCommand(game, moderator, { type: "beginFirstNight" }, dependencies);

    expect(game.redHerring).toEqual({
      playerId: "p1",
      selectionSource: "baseline_v1",
    });
    expect(game.redHerring?.playerId).not.toBe("p4");
    expect(game.redHerring?.playerId).not.toBe("p5");
  });
});
