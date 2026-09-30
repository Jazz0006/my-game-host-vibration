import { describe, expect, it } from "vitest";
import type {
  GameCommandContext,
  GameModuleDependencies,
  GameViewContext,
} from "../src/core/game/GameModule.js";
import { BotcGameModule } from "../src/games/botc/BotcGameModule.js";
import {
  createDemonBluffRecommendationRequest,
  recommendDemonBluffsBaselineV1,
} from "../src/games/botc/TroubleBrewingRecommendation.js";

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

function dependencies(sequence: number[] = [0]): GameModuleDependencies {
  let index = 0;
  return {
    random: {
      randomInt: maxExclusive => {
        const value = sequence[index % sequence.length] ?? 0;
        index += 1;
        return Math.min(Math.max(value, 0), maxExclusive - 1);
      },
      randomId: () => "unused",
    },
  };
}

function sevenPlayerInput() {
  return {
    playerIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    config: { scriptId: "trouble-brewing" as const },
    assignments: [
      { playerId: "p1", actualRoleId: "drunk" as const, shownRoleId: "empath" as const },
      { playerId: "p2", actualRoleId: "washerwoman" as const },
      { playerId: "p3", actualRoleId: "chef" as const },
      { playerId: "p4", actualRoleId: "monk" as const },
      { playerId: "p5", actualRoleId: "saint" as const },
      { playerId: "p6", actualRoleId: "baron" as const },
      { playerId: "p7", actualRoleId: "imp" as const },
    ],
  };
}

function confirmAll(
  module: BotcGameModule,
  game: ReturnType<BotcGameModule["createGame"]>,
  deps: GameModuleDependencies,
): void {
  for (const assignment of game.assignments) {
    module.handleCommand(
      game,
      playerContext(assignment.playerId),
      { type: "confirmRole" },
      deps,
    );
  }
}

const viewContext: GameViewContext = {
  players: [
    { id: "p1", name: "P1", seat: 1 },
    { id: "p2", name: "P2", seat: 2 },
    { id: "p3", name: "P3", seat: 3 },
    { id: "p4", name: "P4", seat: 4 },
    { id: "p5", name: "P5", seat: 5 },
    { id: "p6", name: "P6", seat: 6 },
    { id: "p7", name: "P7", seat: 7 },
  ],
};

describe("B0C2 Demon Info recommendation policy and runtime delivery", () => {
  it("baseline V1 avoids the shown Drunk role when enough legal alternatives exist", () => {
    const request = createDemonBluffRecommendationRequest(
      {
        demonPlayerId: "demon",
        minionPlayerIds: ["minion"],
        legalBluffRoleIds: ["empath", "fortune_teller", "undertaker", "soldier"],
      },
      { shownDrunkRoleId: "empath" },
    );

    expect(
      recommendDemonBluffsBaselineV1(request, {
        randomInt: () => 0,
      }),
    ).toEqual({
      roleIds: ["fortune_teller", "undertaker", "soldier"],
    });
  });

  it("automatically commits a legal recommendation before first-night Demon Info", () => {
    const module = new BotcGameModule();
    const deps = dependencies([0]);
    const game = module.createGame(sevenPlayerInput(), deps);

    confirmAll(module, game, deps);
    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      deps,
    );

    expect(game.demonInfo).toBeDefined();
    expect(game.demonInfo?.demonPlayerId).toBe("p7");
    expect(game.demonInfo?.minionPlayerIds).toEqual(["p6"]);
    expect(game.demonInfo?.bluffRoleIds).toHaveLength(3);
    expect(game.demonInfo?.bluffRoleIds).not.toContain("empath");
    expect(new Set(game.demonInfo?.bluffRoleIds).size).toBe(3);
  });

  it("allows a moderator to commit a legal manual choice before first night and preserves it", () => {
    const module = new BotcGameModule();
    const deps = dependencies([0]);
    const game = module.createGame(sevenPlayerInput(), deps);

    const committed = module.handleCommand(
      game,
      moderatorContext,
      {
        type: "setDemonBluffs",
        roleIds: ["empath", "fortune_teller", "undertaker"],
      },
      deps,
    );
    expect(committed.outcome).toEqual({
      kind: "demonBluffsCommitted",
      source: "moderator",
      roleIds: ["empath", "fortune_teller", "undertaker"],
    });

    confirmAll(module, game, deps);
    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      deps,
    );

    expect(game.demonInfo?.bluffRoleIds).toEqual([
      "empath",
      "fortune_teller",
      "undertaker",
    ]);
  });

  it("rejects an illegal manual bluff choice at the recommendation legality boundary", () => {
    const module = new BotcGameModule();
    const deps = dependencies();
    const game = module.createGame(sevenPlayerInput(), deps);

    expect(() =>
      module.handleCommand(
        game,
        moderatorContext,
        {
          type: "setDemonBluffs",
          roleIds: ["fortune_teller", "undertaker", "washerwoman"],
        },
        deps,
      ),
    ).toThrow("legal bluff candidates");
  });

  it("delivers committed Demon Info only to the Demon at the demon_info step and to ModeratorView", () => {
    const module = new BotcGameModule();
    const deps = dependencies([0]);
    const game = module.createGame(sevenPlayerInput(), deps);

    module.handleCommand(
      game,
      moderatorContext,
      {
        type: "setDemonBluffs",
        roleIds: ["empath", "fortune_teller", "undertaker"],
      },
      deps,
    );
    confirmAll(module, game, deps);
    module.handleCommand(
      game,
      moderatorContext,
      { type: "beginFirstNight" },
      deps,
    );

    // 7+ first night begins with minion_info.
    expect(module.getPlayerView(game, "p7", viewContext).demonInfo).toBeUndefined();

    module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      deps,
    );

    const demonView = module.getPlayerView(game, "p7", viewContext);
    expect(demonView).toMatchObject({
      mode: "night_wake",
      nightStep: {
        id: "demon_info",
        kind: "system_info",
      },
      demonInfo: {
        minionPlayerIds: ["p6"],
        bluffRoles: [
          { id: "empath", name: "Empath", nameZh: "共情者" },
          { id: "fortune_teller", name: "Fortune Teller", nameZh: "占卜师" },
          { id: "undertaker", name: "Undertaker", nameZh: "送葬者" },
        ],
      },
    });

    expect(module.getPlayerView(game, "p6", viewContext).demonInfo).toBeUndefined();
    expect(module.getPlayerView(game, "p1", viewContext).demonInfo).toBeUndefined();
    expect(module.getPublicView(game, viewContext)).not.toHaveProperty("demonInfo");
    expect(module.getModeratorView(game, viewContext).demonInfo).toEqual(
      demonView.demonInfo,
    );

    module.handleCommand(
      game,
      moderatorContext,
      { type: "completeNightStep" },
      deps,
    );
    expect(module.getPlayerView(game, "p7", viewContext).demonInfo).toBeUndefined();
  });
});
