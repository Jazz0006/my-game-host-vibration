import { describe, expect, it } from "vitest";
import type { GameState } from "../src/domain/game.js";
import {
  getActiveWerewolfInteraction,
  registeredNightOrder,
} from "../src/games/werewolf/WerewolfNightPlanner.js";
import type { WerewolfRoleDefinition } from "../src/games/werewolf/roles/RoleDefinition.js";
import {
  WEREWOLF_ROLE_REGISTRY,
  type WerewolfInteractionKind,
} from "../src/games/werewolf/roles/registry.js";
import {
  CLASSIC_WEREWOLF_SCRIPTS,
  getClassicWerewolfScript,
} from "../src/games/werewolf/scripts/classic.js";

function guardState(): GameState {
  return {
    config: { playerCount: 5, roleDeck: ["werewolf", "guard", "seer", "villager", "villager"] },
    phase: "night_guard",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "werewolf",
      p2: "guard",
      p3: "seer",
      p4: "villager",
      p5: "villager",
    },
    confirmedRolePlayerIds: [],
    actionId: "guard-action",
    witchUsedAntidote: false,
    witchAntidoteSpent: false,
    witchPoisonSpent: false,
    seerResultConfirmed: false,
    deaths: [],
    votes: {},
    pkCandidateIds: [],
    deadPlayerIds: [],
  };
}

describe("Werewolf role registry", () => {
  it("contains the current roles as declarative definitions", () => {
    expect(Object.keys(WEREWOLF_ROLE_REGISTRY).sort()).toEqual([
      "guard",
      "hunter",
      "seer",
      "villager",
      "werewolf",
      "witch",
    ]);
    expect(WEREWOLF_ROLE_REGISTRY.seer).toMatchObject({
      team: "village",
      maxCount: 1,
      nightOrder: 40,
      interaction: { kind: "seer_check", phase: "night_seer" },
    });
    expect(WEREWOLF_ROLE_REGISTRY.villager.interaction).toBeUndefined();
  });

  it("declares the current night order in role metadata", () => {
    expect(registeredNightOrder()).toEqual(["guard", "werewolf", "witch", "seer"]);
  });

  it("lets the planner consume an injected role definition without a role-specific switch", () => {
    const customGuard: WerewolfRoleDefinition<string, WerewolfInteractionKind> = {
      id: "guard",
      name: "测试守卫",
      description: "用于证明 Planner 消费注册定义。",
      team: "village",
      interaction: {
        phase: "night_guard",
        kind: "seer_check",
        mode: "single",
        wakePolicy: { vibrate: false, audioCue: "custom_guard" },
        completionPolicy: { type: "explicit_confirmation" },
      },
    };

    const interaction = getActiveWerewolfInteraction(guardState(), { customGuard });
    expect(interaction).toEqual({
      id: "guard-action",
      kind: "seer_check",
      actorPlayerIds: ["p2"],
      mode: "single",
      wakePolicy: { vibrate: false, audioCue: "custom_guard" },
      completionPolicy: { type: "explicit_confirmation" },
      status: "active",
    });
  });
});

describe("Werewolf scripts", () => {
  it("keeps table composition separate from role behavior", () => {
    expect(CLASSIC_WEREWOLF_SCRIPTS.map(script => script.id)).toEqual([
      "classic-5",
      "classic-8",
      "classic-10",
    ]);
    expect(getClassicWerewolfScript("classic-10")?.roleDeck).toHaveLength(10);
    expect(getClassicWerewolfScript("missing")).toBeUndefined();
  });
});
