import { describe, expect, it } from "vitest";
import type {
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import {
  BotcGameModule,
  type BotcSetupAssignment,
} from "../src/games/botc/BotcGameModule.js";
import {
  TROUBLE_BREWING_ROLES,
  troubleBrewingBaseCounts,
  troubleBrewingExpectedCounts,
} from "../src/games/botc/TroubleBrewing.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

const playerIds = ["p1", "p2", "p3", "p4", "p5"] as const;

const viewContext: GameViewContext = {
  players: playerIds.map((id, index) => ({
    id,
    name: `Player ${index + 1}`,
    seat: index + 1,
  })),
};

function createInput(assignments: readonly BotcSetupAssignment[]) {
  return {
    playerIds,
    config: { scriptId: "trouble-brewing" as const },
    assignments,
  };
}

describe("B0A Trouble Brewing setup and views", () => {
  it("owns the complete 22-character Trouble Brewing catalog", () => {
    expect(TROUBLE_BREWING_ROLES).toHaveLength(22);
    expect(new Set(TROUBLE_BREWING_ROLES.map(role => role.id))).toHaveProperty(
      "size",
      22,
    );
    expect(
      TROUBLE_BREWING_ROLES.filter(role => role.category === "townsfolk"),
    ).toHaveLength(13);
    expect(
      TROUBLE_BREWING_ROLES.filter(role => role.category === "outsider"),
    ).toHaveLength(4);
    expect(
      TROUBLE_BREWING_ROLES.filter(role => role.category === "minion"),
    ).toHaveLength(4);
    expect(
      TROUBLE_BREWING_ROLES.filter(role => role.category === "demon"),
    ).toHaveLength(1);
  });

  it.each([
    [5, { townsfolk: 3, outsider: 0, minion: 1, demon: 1 }],
    [6, { townsfolk: 3, outsider: 1, minion: 1, demon: 1 }],
    [7, { townsfolk: 5, outsider: 0, minion: 1, demon: 1 }],
    [8, { townsfolk: 5, outsider: 1, minion: 1, demon: 1 }],
    [9, { townsfolk: 5, outsider: 2, minion: 1, demon: 1 }],
    [10, { townsfolk: 7, outsider: 0, minion: 2, demon: 1 }],
    [11, { townsfolk: 7, outsider: 1, minion: 2, demon: 1 }],
    [12, { townsfolk: 7, outsider: 2, minion: 2, demon: 1 }],
    [13, { townsfolk: 9, outsider: 0, minion: 3, demon: 1 }],
    [14, { townsfolk: 9, outsider: 1, minion: 3, demon: 1 }],
    [15, { townsfolk: 9, outsider: 2, minion: 3, demon: 1 }],
  ] as const)("uses the official %i-player base distribution", (count, expected) => {
    expect(troubleBrewingBaseCounts(count)).toEqual(expected);
  });

  it("applies Baron's +2 Outsider / -2 Townsfolk setup mutation", () => {
    expect(
      troubleBrewingExpectedCounts(5, [
        "washerwoman",
        "drunk",
        "saint",
        "baron",
        "imp",
      ]),
    ).toEqual({
      townsfolk: 1,
      outsider: 2,
      minion: 1,
      demon: 1,
    });
  });

  it("keeps Drunk actual identity separate from the Townsfolk role shown to the player", () => {
    const module = new BotcGameModule();
    const game = module.createGame(
      createInput([
        { playerId: "p1", actualRoleId: "washerwoman" },
        {
          playerId: "p2",
          actualRoleId: "drunk",
          shownRoleId: "empath",
        },
        { playerId: "p3", actualRoleId: "saint" },
        { playerId: "p4", actualRoleId: "baron" },
        { playerId: "p5", actualRoleId: "imp" },
      ]),
      dependencies,
    );

    expect(game.assignments.find(item => item.playerId === "p2")).toEqual({
      playerId: "p2",
      actualRoleId: "drunk",
      shownRoleId: "empath",
    });

    const playerView = module.getPlayerView(game, "p2", viewContext);
    expect(playerView).toMatchObject({
      phase: "role_reveal",
      mode: "role_reveal",
      roleId: "empath",
      roleName: "Empath",
      roleCategory: "townsfolk",
      roleConfirmed: false,
    });
    expect(playerView).not.toHaveProperty("actualRoleId");

    const moderatorView = module.getModeratorView(game, viewContext);
    expect(moderatorView.assignments).toContainEqual({
      playerId: "p2",
      actualRoleId: "drunk",
      shownRoleId: "empath",
    });

    const publicView = module.getPublicView(game, viewContext);
    expect(publicView).toMatchObject({
      scriptId: "trouble-brewing",
      phase: "role_reveal",
      playerCount: 5,
      confirmedRoles: 0,
    });
    expect(publicView).not.toHaveProperty("assignments");
  });

  it("rejects duplicate actual characters and illegal category distributions", () => {
    const module = new BotcGameModule();

    expect(() =>
      module.createGame(
        createInput([
          { playerId: "p1", actualRoleId: "washerwoman" },
          { playerId: "p2", actualRoleId: "washerwoman" },
          { playerId: "p3", actualRoleId: "chef" },
          { playerId: "p4", actualRoleId: "poisoner" },
          { playerId: "p5", actualRoleId: "imp" },
        ]),
        dependencies,
      ),
    ).toThrow("duplicate actual characters");

    expect(() =>
      module.createGame(
        createInput([
          { playerId: "p1", actualRoleId: "washerwoman" },
          { playerId: "p2", actualRoleId: "librarian" },
          { playerId: "p3", actualRoleId: "investigator" },
          {
            playerId: "p4",
            actualRoleId: "drunk",
            shownRoleId: "empath",
          },
          { playerId: "p5", actualRoleId: "imp" },
        ]),
        dependencies,
      ),
    ).toThrow("Illegal Trouble Brewing setup");
  });

  it("requires a Drunk shown Townsfolk that is not actually in play", () => {
    const module = new BotcGameModule();

    expect(() =>
      module.createGame(
        createInput([
          { playerId: "p1", actualRoleId: "washerwoman" },
          { playerId: "p2", actualRoleId: "drunk" },
          { playerId: "p3", actualRoleId: "saint" },
          { playerId: "p4", actualRoleId: "baron" },
          { playerId: "p5", actualRoleId: "imp" },
        ]),
        dependencies,
      ),
    ).toThrow("Drunk setup requires a shown Townsfolk role");

    expect(() =>
      module.createGame(
        createInput([
          { playerId: "p1", actualRoleId: "washerwoman" },
          {
            playerId: "p2",
            actualRoleId: "drunk",
            shownRoleId: "saint",
          },
          { playerId: "p3", actualRoleId: "recluse" },
          { playerId: "p4", actualRoleId: "baron" },
          { playerId: "p5", actualRoleId: "imp" },
        ]),
        dependencies,
      ),
    ).toThrow("Drunk shown role must be a Townsfolk");

    expect(() =>
      module.createGame(
        createInput([
          { playerId: "p1", actualRoleId: "washerwoman" },
          {
            playerId: "p2",
            actualRoleId: "drunk",
            shownRoleId: "washerwoman",
          },
          { playerId: "p3", actualRoleId: "saint" },
          { playerId: "p4", actualRoleId: "baron" },
          { playerId: "p5", actualRoleId: "imp" },
        ]),
        dependencies,
      ),
    ).toThrow("must not be actually in play");
  });
});
