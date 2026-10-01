import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import { createTroubleBrewingOtherNightSequence } from "../src/games/botc/TroubleBrewingNightSequence.js";
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

const playerIds = Array.from({ length: 13 }, (_, index) => `p${index + 1}`);
const assignments: readonly BotcSetupAssignment[] = [
  { playerId: "p1", actualRoleId: "poisoner" },
  { playerId: "p2", actualRoleId: "spy" },
  { playerId: "p3", actualRoleId: "baron" },
  { playerId: "p4", actualRoleId: "imp" },
  { playerId: "p5", actualRoleId: "drunk", shownRoleId: "empath" },
  { playerId: "p6", actualRoleId: "saint" },
  { playerId: "p7", actualRoleId: "washerwoman" },
  { playerId: "p8", actualRoleId: "librarian" },
  { playerId: "p9", actualRoleId: "investigator" },
  { playerId: "p10", actualRoleId: "chef" },
  { playerId: "p11", actualRoleId: "fortune_teller" },
  { playerId: "p12", actualRoleId: "undertaker" },
  { playerId: "p13", actualRoleId: "monk" },
];

const viewContext: GameViewContext = {
  players: playerIds.map((id, index) => ({
    id,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function createAtSpyStep() {
  const module = new BotcGameModule();
  const game = module.createGame(
    {
      playerIds,
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
    { type: "setRedHerring", playerId: "p10" },
    dependencies,
  );
  module.handleCommand(game, moderator, { type: "beginFirstNight" }, dependencies);
  for (const stepId of ["minion_info", "demon_info"]) {
    expect(module.getModeratorView(game, viewContext).nightStep?.id).toBe(stepId);
    module.handleCommand(
      game,
      moderator,
      { type: "completeNightStep" },
      dependencies,
    );
  }
  expect(module.getModeratorView(game, viewContext).nightStep?.id).toBe("role:poisoner");
  module.handleCommand(
    game,
    player("p1"),
    { type: "submitNightChoice", playerIds: ["p2"] },
    dependencies,
  );
  expect(module.getModeratorView(game, viewContext).nightStep?.id).toBe("role:spy");
  return { module, game };
}

describe("PV-3B4 Spy Grimoire runtime", () => {
  it("commits a reconnect-stable explicit Grimoire and advances only after Spy acknowledgement", () => {
    const { module, game } = createAtSpyStep();

    expect(module.getModeratorView(game, viewContext).informationDecision).toEqual({
      stepId: "role:spy",
      recipientPlayerId: "p2",
      roleId: "spy",
      committed: false,
    });

    module.handleCommand(
      game,
      moderator,
      { type: "commitNightInformation" },
      dependencies,
    );

    expect(game.informationHistory.at(-1)).toMatchObject({
      stepId: "role:spy",
      recipientPlayerId: "p2",
      acknowledged: false,
      selectionSource: "baseline_v1",
      result: {
        kind: "spy_grimoire",
        abilityRoleId: "spy",
        reliability: "poisoned",
        semanticTruth: "true",
        players: expect.arrayContaining([
          {
            playerId: "p2",
            actualRoleId: "spy",
            shownRoleId: "spy",
            alive: true,
          },
          {
            playerId: "p5",
            actualRoleId: "drunk",
            shownRoleId: "empath",
            alive: true,
          },
          {
            playerId: "p4",
            actualRoleId: "imp",
            shownRoleId: "imp",
            alive: true,
          },
        ]),
        reminders: {
          drunkPlayerId: "p5",
          poisonedPlayerId: "p2",
          redHerringPlayerId: "p10",
          pairInformation: expect.arrayContaining([
            expect.objectContaining({ abilityRoleId: "washerwoman" }),
            expect.objectContaining({ abilityRoleId: "librarian" }),
            expect.objectContaining({ abilityRoleId: "investigator" }),
          ]),
        },
      },
    });

    const firstView = module.getPlayerView(game, "p2", viewContext);
    expect(firstView.privateInformation).toMatchObject({
      kind: "spy_grimoire",
      abilityRoleId: "spy",
    });
    const spyView = firstView.privateInformation as Extract<
      NonNullable<typeof firstView.privateInformation>,
      { kind: "spy_grimoire" }
    >;
    expect(spyView.players).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerId: "p5",
        actualRole: expect.objectContaining({ id: "drunk", nameZh: "酒鬼" }),
        shownRole: expect.objectContaining({ id: "empath", nameZh: "共情者" }),
        alive: true,
      }),
    ]));
    expect(spyView.reminders).toMatchObject({
      drunkPlayerId: "p5",
      poisonedPlayerId: "p2",
      redHerringPlayerId: "p10",
    });
    expect(JSON.stringify(firstView)).not.toContain('"reliability"');
    expect(JSON.stringify(firstView)).not.toContain('"semanticTruth"');
    expect(JSON.stringify(firstView)).not.toContain('"selectionSource"');
    expect(module.getPlayerView(game, "p1", viewContext).privateInformation).toBeUndefined();
    expect(module.getPublicView(game, viewContext)).not.toHaveProperty("privateInformation");

    const reconnectView = module.getPlayerView(game, "p2", viewContext);
    expect(reconnectView.privateInformation).toEqual(firstView.privateInformation);

    expect(() =>
      module.handleCommand(
        game,
        moderator,
        { type: "completeNightStep" },
        dependencies,
      ),
    ).toThrow(/information/i);

    const acknowledged = module.handleCommand(
      game,
      player("p2"),
      { type: "acknowledgeNightInformation" },
      dependencies,
    );
    expect(acknowledged.outcome).toMatchObject({
      kind: "nightInformationAcknowledged",
      completedStepId: "role:spy",
      nextStepId: "role:washerwoman",
    });
    expect(module.getPlayerView(game, "p2", viewContext).privateInformation).toBeUndefined();
  });

  it("does not schedule a dead actual Spy on other nights", () => {
    const sequence = createTroubleBrewingOtherNightSequence({
      assignments: assignments.map(assignment => ({
        playerId: assignment.playerId,
        actualRoleId: assignment.actualRoleId,
        shownRoleId: assignment.shownRoleId ?? assignment.actualRoleId,
      })),
      deadPlayerIds: ["p2"],
      diedTonightPlayerIds: [],
      roleTransitions: [],
    });

    expect(sequence.map(step => step.id)).not.toContain("role:spy");
  });
});
