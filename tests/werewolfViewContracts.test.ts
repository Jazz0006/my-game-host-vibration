import { describe, expect, it } from "vitest";
import type { GameViewContext } from "../src/core/game/GameModule.js";
import { configFromRoleDeck, type GameState } from "../src/domain/game.js";
import {
  WerewolfGameModule,
  type WerewolfHostView,
  type WerewolfPlayerView,
  type WerewolfPublicView,
} from "../src/games/werewolf/WerewolfGameModule.js";

const context: GameViewContext = {
  players: [
    { id: "p1", name: "一号", seat: 1 },
    { id: "p2", name: "二号", seat: 2 },
    { id: "p3", name: "三号", seat: 3 },
    { id: "p4", name: "四号", seat: 4 },
    { id: "p5", name: "五号", seat: 5 },
  ],
};

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    config: configFromRoleDeck(5, ["werewolf", "seer", "witch", "villager", "villager"]),
    phase: "night_werewolf",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "werewolf",
      p2: "seer",
      p3: "witch",
      p4: "villager",
      p5: "villager",
    },
    confirmedRolePlayerIds: [],
    actionId: "action-1",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
    ...overrides,
  };
}

function acceptsPlayerView(view: WerewolfPlayerView): WerewolfPlayerView {
  return view;
}

function acceptsHostView(view: WerewolfHostView): WerewolfHostView {
  return view;
}

function acceptsPublicView(view: WerewolfPublicView): WerewolfPublicView {
  return view;
}

describe("Werewolf view contracts", () => {
  it("exposes typed player action fields without transport state", () => {
    const module = new WerewolfGameModule();
    const view = acceptsPlayerView(module.getPlayerView(state(), "p1", context));

    expect(view.mode).toBe("wolf_action");
    expect(view.role).toBe("werewolf");
    expect(view.targets?.map(target => target.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(view).not.toHaveProperty("socketId");
    expect(view).not.toHaveProperty("connected");
    expect(view).not.toHaveProperty("sessionToken");
  });

  it("keeps private seer information in PlayerView only", () => {
    const module = new WerewolfGameModule();
    const game = state({
      phase: "night_seer",
      seerTargetId: "p1",
    });

    const playerView = acceptsPlayerView(module.getPlayerView(game, "p2", context));
    const publicView = acceptsPublicView(module.getPublicView(game, context));
    const hostView = acceptsHostView(module.getHostView(game, context));

    expect(playerView.mode).toBe("seer_result");
    expect(playerView.checkedPlayer).toEqual({ id: "p1", name: "一号", seat: 1 });
    expect(playerView.checkedAlignment).toBe("werewolf");
    expect(publicView).not.toHaveProperty("checkedAlignment");
    expect(hostView).not.toHaveProperty("checkedAlignment");
  });

  it("keeps vote tally host-only while sharing public progress fields", () => {
    const module = new WerewolfGameModule();
    const game = state({
      phase: "day_vote",
      dayNumber: 1,
      votes: { p1: "p4", p2: "p4", p3: "p5" },
    });

    const hostView = acceptsHostView(module.getHostView(game, context));
    const publicView = acceptsPublicView(module.getPublicView(game, context));

    expect(hostView.voteTally).toEqual({ p4: 2, p5: 1 });
    expect(publicView.votesCast).toBe(3);
    expect(publicView).not.toHaveProperty("voteTally");
    expect(publicView).not.toHaveProperty("roles");
  });

  it("uses only transport-neutral player references in all player target fields", () => {
    const module = new WerewolfGameModule();
    const game = state({ phase: "night_witch", wolfTargetId: "p4" });
    const view = acceptsPlayerView(module.getPlayerView(game, "p3", context));

    const refs = [view.attackedPlayer, ...(view.poisonTargets ?? [])].filter(Boolean);
    for (const ref of refs) {
      expect(Object.keys(ref!).sort()).toEqual(["id", "name", "seat"]);
    }
  });
});
