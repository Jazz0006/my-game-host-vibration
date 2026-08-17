import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameState } from "../src/domain/game.js";
import {
  planWerewolfNightInteractions,
  type WerewolfDynamicNightRegistry,
} from "../src/games/werewolf/WerewolfDynamicNightPlanner.js";
import {
  CUPID_SPIKE_ROLE_DEFINITION,
  type CupidSpikeInteractionKind,
  type CupidSpikeRoleId,
} from "../src/games/werewolf/roles/experimental/CupidRoleDefinition.js";
import {
  WEREWOLF_ROLE_REGISTRY,
  type WerewolfInteractionKind,
} from "../src/games/werewolf/roles/registry.js";
import { CUPID_DYNAMIC_ORCHESTRATION_SPIKE_SCRIPT } from "../src/games/werewolf/scripts/experimental/cupidSpike.js";

type DynamicInteractionKind = WerewolfInteractionKind | CupidSpikeInteractionKind;

const registry: WerewolfDynamicNightRegistry<DynamicInteractionKind> = {
  cupid: CUPID_SPIKE_ROLE_DEFINITION,
  guard: WEREWOLF_ROLE_REGISTRY.guard,
  werewolf: WEREWOLF_ROLE_REGISTRY.werewolf,
  witch: WEREWOLF_ROLE_REGISTRY.witch,
  seer: WEREWOLF_ROLE_REGISTRY.seer,
  villager: WEREWOLF_ROLE_REGISTRY.villager,
};

const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

function assignmentsFromSpikeScript(): Record<string, CupidSpikeRoleId> {
  return Object.fromEntries(
    CUPID_DYNAMIC_ORCHESTRATION_SPIKE_SCRIPT.roleDeck.map((role, index) => [playerIds[index], role]),
  ) as Record<string, CupidSpikeRoleId>;
}

function legacyGame(): GameState {
  return {
    config: {
      playerCount: 8,
      roleDeck: [
        "villager",
        "guard",
        "werewolf",
        "werewolf",
        "witch",
        "seer",
        "villager",
        "villager",
      ],
    },
    phase: "night_start",
    nightNumber: 1,
    dayNumber: 0,
    roles: {
      p1: "villager",
      p2: "guard",
      p3: "werewolf",
      p4: "werewolf",
      p5: "witch",
      p6: "seer",
      p7: "villager",
      p8: "villager",
    },
    confirmedRolePlayerIds: [...playerIds],
    actionId: "legacy-action",
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

function kindsForNight(
  nightNumber: number,
  assignments = assignmentsFromSpikeScript(),
  game = legacyGame(),
  currentRegistry = registry,
): DynamicInteractionKind[] {
  return planWerewolfNightInteractions(
    { nightNumber, assignments, game },
    currentRegistry,
  ).map(interaction => interaction.kind);
}

describe("B4b dynamic Cupid orchestration spike", () => {
  it("lets a script compose Cupid without adding Cupid to the legacy Role union", () => {
    expect(CUPID_DYNAMIC_ORCHESTRATION_SPIKE_SCRIPT.roleDeck[0]).toBe("cupid");
    expect(CUPID_DYNAMIC_ORCHESTRATION_SPIKE_SCRIPT.roleDeck).toHaveLength(8);
  });

  it("plans Cupid automatically on the first night from role metadata", () => {
    expect(kindsForNight(1)).toEqual([
      "cupid_link_lovers",
      "guard_protect",
      "wolf_kill",
      "witch_action",
      "seer_check",
    ]);
  });

  it("automatically omits first-night-only Cupid on later nights", () => {
    expect(kindsForNight(2)).toEqual([
      "guard_protect",
      "wolf_kill",
      "witch_action",
      "seer_check",
    ]);
  });

  it("does not plan Cupid merely because Cupid exists in the registry", () => {
    const assignments = assignmentsFromSpikeScript();
    assignments.p1 = "villager";

    expect(kindsForNight(1, assignments)).not.toContain("cupid_link_lovers");
  });

  it("skips a dead role actor without changing the night flow definition", () => {
    const game = legacyGame();
    game.deadPlayerIds.push("p6");

    expect(kindsForNight(1, assignmentsFromSpikeScript(), game)).toEqual([
      "cupid_link_lovers",
      "guard_protect",
      "wolf_kill",
      "witch_action",
    ]);
  });

  it("continues to honor role eligibility such as an exhausted Witch", () => {
    const game = legacyGame();
    game.witchAntidoteSpent = true;
    game.witchPoisonSpent = true;

    expect(kindsForNight(1, assignmentsFromSpikeScript(), game)).toEqual([
      "cupid_link_lovers",
      "guard_protect",
      "wolf_kill",
      "seer_check",
    ]);
  });

  it("takes ordering from role metadata rather than a hidden fixed night order", () => {
    const lateCupidRegistry: WerewolfDynamicNightRegistry<DynamicInteractionKind> = {
      ...registry,
      cupid: {
        ...CUPID_SPIKE_ROLE_DEFINITION,
        interaction: {
          ...CUPID_SPIKE_ROLE_DEFINITION.interaction!,
          night: { order: 50, schedule: "first_night_only" },
        },
      },
    };

    expect(kindsForNight(1, assignmentsFromSpikeScript(), legacyGame(), lateCupidRegistry)).toEqual([
      "guard_protect",
      "wolf_kill",
      "witch_action",
      "seer_check",
      "cupid_link_lovers",
    ]);
  });

  it("does not add Cupid to the legacy phase state machine", () => {
    const domainSource = readFileSync("src/domain/game.ts", "utf8");
    const moduleSource = readFileSync("src/games/werewolf/WerewolfGameModule.ts", "utf8");

    expect(domainSource).not.toContain("night_cupid");
    expect(moduleSource).not.toContain("night_cupid");
  });
});
