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

const assignments: readonly BotcSetupAssignment[] = [
  { playerId: "p1", actualRoleId: "librarian" },
  { playerId: "p2", actualRoleId: "investigator" },
  { playerId: "p3", actualRoleId: "chef" },
  { playerId: "p4", actualRoleId: "poisoner" },
  { playerId: "p5", actualRoleId: "imp" },
];

const viewContext: GameViewContext = {
  players: assignments.map((assignment, index) => ({
    id: assignment.playerId,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function activeLibrarianStep() {
  const module = new BotcGameModule();
  const game = module.createGame(
    {
      playerIds: assignments.map(assignment => assignment.playerId),
      config: { scriptId: "trouble-brewing" },
      assignments,
    },
    dependencies,
  );
  for (const assignment of assignments) {
    module.handleCommand(
      game,
      playerContext(assignment.playerId),
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
  module.handleCommand(
    game,
    playerContext("p4"),
    { type: "submitNightChoice", playerIds: ["p3"] },
    dependencies,
  );
  return { module, game };
}

describe("PV-3B2B Librarian + Investigator information runtime", () => {
  it("commits a typed Librarian zero privately, acknowledges it, then reuses the same lifecycle for Investigator", () => {
    const { module, game } = activeLibrarianStep();

    expect(module.getModeratorView(game, viewContext).informationDecision).toEqual({
      stepId: "role:librarian",
      recipientPlayerId: "p1",
      roleId: "librarian",
      committed: false,
    });

    module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );

    expect(game.informationHistory[0]).toMatchObject({
      stepId: "role:librarian",
      recipientPlayerId: "p1",
      selectionSource: "baseline_v1",
      acknowledged: false,
      result: {
        kind: "no_characters",
        abilityRoleId: "librarian",
        noCharacterCategory: "outsider",
        reliability: "reliable",
        semanticTruth: "true",
        selectedCandidateId: "librarian:no-outsiders",
        selectedResolution: {
          noCharacterCategory: "outsider",
          truthSource: "actual_state",
        },
      },
    });

    expect(module.getPlayerView(game, "p1", viewContext).privateInformation).toEqual({
      kind: "no_characters",
      abilityRoleId: "librarian",
      noCharacterCategory: "outsider",
    });
    expect(module.getPlayerView(game, "p2", viewContext)).not.toHaveProperty(
      "privateInformation",
    );

    const librarianAck = module.handleCommand(
      game,
      playerContext("p1"),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
    expect(librarianAck.outcome).toMatchObject({
      kind: "nightInformationAcknowledged",
      completedStepId: "role:librarian",
      nextStepId: "role:investigator",
    });

    module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );

    expect(game.informationHistory[1]).toMatchObject({
      stepId: "role:investigator",
      recipientPlayerId: "p2",
      result: {
        kind: "pair",
        abilityRoleId: "investigator",
        learnedRoleId: "poisoner",
        reliability: "reliable",
        semanticTruth: "true",
        selectedResolution: {
          matchingPlayerId: "p4",
          matchSource: "actual",
        },
      },
    });
    const investigatorView = module.getPlayerView(game, "p2", viewContext);
    expect(investigatorView.privateInformation).toMatchObject({
      kind: "pair",
      abilityRoleId: "investigator",
      learnedRole: { id: "poisoner" },
      shownPlayerIds: [expect.any(String), expect.any(String)],
    });
    expect(JSON.stringify(investigatorView.privateInformation)).not.toContain(
      "semanticTruth",
    );
    expect(JSON.stringify(investigatorView.privateInformation)).not.toContain(
      "selectedResolution",
    );
  });

  it("keeps pair-information commit under moderator authority without advancing before recipient acknowledgement", () => {
    const { module, game } = activeLibrarianStep();
    const before = game.nightStepIndex;

    expect(() =>
      module.handleCommand(
        game,
        playerContext("p1"),
        { type: "commitNightInformation" },
        dependencies,
      ),
    ).toThrow("Only the BotC moderator");

    module.handleCommand(
      game,
      moderatorContext,
      { type: "commitNightInformation" },
      dependencies,
    );
    expect(game.nightStepIndex).toBe(before);
    expect(game.informationHistory).toHaveLength(1);
  });
});
