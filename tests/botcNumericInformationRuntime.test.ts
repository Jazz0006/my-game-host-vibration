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

const moderatorContext: GameCommandContext = {
  isModerator: true,
  now: 1,
};

function playerContext(playerId: string): GameCommandContext {
  return { playerId, isModerator: false, now: 1 };
}

const playerIds = ["p1", "p2", "p3", "p4", "p5"] as const;

// Deliberately not in seat order: numeric information must use playerIds as the
// canonical seating ring rather than accidentally treating assignment order as seats.
const assignments: readonly BotcSetupAssignment[] = [
  { playerId: "p3", actualRoleId: "librarian" },
  { playerId: "p5", actualRoleId: "imp" },
  { playerId: "p1", actualRoleId: "chef" },
  { playerId: "p4", actualRoleId: "poisoner" },
  { playerId: "p2", actualRoleId: "empath" },
];
const viewContext: GameViewContext = {
  players: playerIds.map((id, index) => ({
    id,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function createStartedGame() {
  const module = new BotcGameModule();
  const game = module.createGame(
    {
      playerIds,
      config: { scriptId: "trouble-brewing" },
      assignments,
    },
    dependencies,
  );
  expect(game.seatingPlayerIds).toEqual([...playerIds]);
  for (const playerId of playerIds) {
    module.handleCommand(
      game,
      playerContext(playerId),
      { type: "confirmRole" },
      dependencies,
    );
  }
  module.handleCommand(
    game,
    moderatorContext,
    { type: "beginFirstNight" },
    dependencies,
  );
  return { module, game };
}

function commitAndAcknowledge(
  module: BotcGameModule,
  game: ReturnType<BotcGameModule["createGame"]>,
  recipientPlayerId: string,
) {
  module.handleCommand(
    game,
    moderatorContext,
    { type: "commitNightInformation" },
    dependencies,
  );
  return module.handleCommand(
    game,
    playerContext(recipientPlayerId),
    { type: "acknowledgeNightInformation" },
    dependencies,
  );
}

describe("PV-3B2C Chef + Empath numeric information runtime", () => {
  it("commits poisoned Chef number privately and advances only after acknowledgement", () => {
    const { module, game } = createStartedGame();

    module.handleCommand(
      game,
      playerContext("p4"),
      { type: "submitNightChoice", playerIds: ["p1"] },
      dependencies,
    );
    expect(module.getModeratorView(game, viewContext).informationDecision).toEqual({
      stepId: "role:librarian",
      recipientPlayerId: "p3",
      roleId: "librarian",
      committed: false,
    });

    commitAndAcknowledge(module, game, "p3");
    expect(module.getModeratorView(game, viewContext).informationDecision).toEqual({
      stepId: "role:chef",
      recipientPlayerId: "p1",
      roleId: "chef",
      committed: false,
    });

    const before = game.nightStepIndex;
    module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );

    expect(game.nightStepIndex).toBe(before);
    expect(game.informationHistory.at(-1)).toMatchObject({
      stepId: "role:chef",
      recipientPlayerId: "p1",
      acknowledged: false,
      result: {
        kind: "number",
        abilityRoleId: "chef",
        value: 1,
        reliability: "poisoned",
        semanticTruth: "true",
        selectedCandidateId: "chef:number:1",
        selectedResolution: { kind: "chef_pairs" },
      },
    });
    expect(module.getPlayerView(game, "p1", viewContext).privateInformation).toEqual({
      kind: "number",
      abilityRoleId: "chef",
      value: 1,
    });
    expect(JSON.stringify(module.getPlayerView(game, "p1", viewContext))).not.toContain(
      "poisoned",
    );

    const ack = module.handleCommand(
      game,
      playerContext("p1"),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
    expect(ack.outcome).toMatchObject({
      kind: "nightInformationAcknowledged",
      completedStepId: "role:chef",
      nextStepId: "role:empath",
    });
  });

  it("uses dead-player skipping for later-night Empath information", () => {
    const { module, game } = createStartedGame();

    module.handleCommand(
      game,
      playerContext("p4"),
      { type: "submitNightChoice", playerIds: ["p3"] },
      dependencies,
    );
    commitAndAcknowledge(module, game, "p3");
    commitAndAcknowledge(module, game, "p1");
    commitAndAcknowledge(module, game, "p2");
    expect(game.phase).toBe("day");

    game.deadPlayerIds = ["p1"];
    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginOtherNight" },
      dependencies,
    );
    module.handleCommand(
      game,
      playerContext("p4"),
      { type: "submitNightChoice", playerIds: ["p3"] },
      dependencies,
    );
    module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      dependencies,
    );

    expect(module.getModeratorView(game, viewContext).informationDecision).toEqual({
      stepId: "role:empath",
      recipientPlayerId: "p2",
      roleId: "empath",
      committed: false,
    });

    module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );
    expect(game.informationHistory.at(-1)).toMatchObject({
      nightNumber: 2,
      stepId: "role:empath",
      recipientPlayerId: "p2",
      result: {
        kind: "number",
        abilityRoleId: "empath",
        value: 1,
        reliability: "reliable",
        semanticTruth: "true",
        selectedResolution: {
          kind: "empath_neighbors",
          clockwiseNeighborPlayerId: "p3",
          counterclockwiseNeighborPlayerId: "p5",
        },
      },
    });
  });
});
