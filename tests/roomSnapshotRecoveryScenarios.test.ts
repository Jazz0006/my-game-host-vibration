import { describe, expect, it } from "vitest";
import type { PendingInteraction } from "../src/core/interaction/PendingInteraction.js";
import {
  createRoomSnapshot,
  restoreRoomSnapshot,
} from "../src/core/room/RoomSnapshot.js";
import type { RoomState } from "../src/core/room/types.js";
import type { GamePhase } from "../src/domain/game.js";
import type { WerewolfInteractionKind } from "../src/games/werewolf/roles/registry.js";
import type { WerewolfRuleState } from "../src/games/werewolf/roles/WerewolfRuleState.js";

type RecoveryGameState = {
  phase: GamePhase;
  actionId: string;
  roles: Record<string, string>;
  hunterTrigger?: "night" | "day";
};

type RecoveryGameConfig = {
  playerCount: number;
  roleDeck: string[];
};

const baseRoom = (
  phase: GamePhase,
  actionId: string,
): RoomState<RecoveryGameState, RecoveryGameConfig> => ({
  id: "123456",
  gameType: "werewolf",
  players: [
    {
      id: "wolf-1",
      name: "狼人",
      seat: 1,
      isHost: true,
      resumeTokenHash: "a".repeat(64),
    },
    {
      id: "witch-1",
      name: "女巫",
      seat: 2,
      isHost: false,
      resumeTokenHash: "b".repeat(64),
    },
    {
      id: "hunter-1",
      name: "猎人",
      seat: 3,
      isHost: false,
      resumeTokenHash: "c".repeat(64),
    },
  ],
  createdAt: 100,
  updatedAt: 200,
  gameConfig: {
    playerCount: 5,
    roleDeck: ["werewolf", "witch", "hunter", "villager", "villager"],
  },
  game: {
    phase,
    actionId,
    roles: {
      "wolf-1": "werewolf",
      "witch-1": "witch",
      "hunter-1": "hunter",
    },
    ...(phase === "day_hunter" ? { hunterTrigger: "day" as const } : {}),
  },
});

function interaction(
  kind: WerewolfInteractionKind,
  actorPlayerIds: string[],
  actionId: string,
): PendingInteraction<WerewolfInteractionKind> {
  const group = kind === "wolf_kill";
  return {
    id: actionId,
    kind,
    actorPlayerIds,
    mode: group ? "group" : "single",
    wakePolicy: { vibrate: true },
    completionPolicy: group
      ? { type: "any_actor_submission" }
      : { type: "single_submission" },
    status: "active",
  };
}

describe("C2 authoritative snapshot recovery scenarios", () => {
  const scenarios: Array<{
    label: string;
    phase: GamePhase;
    actionId: string;
    pendingInteraction?: PendingInteraction<WerewolfInteractionKind>;
  }> = [
    {
      label: "role reveal",
      phase: "role_reveal",
      actionId: "role-reveal-1",
    },
    {
      label: "werewolf action",
      phase: "night_werewolf",
      actionId: "wolf-action-1",
      pendingInteraction: interaction("wolf_kill", ["wolf-1"], "wolf-action-1"),
    },
    {
      label: "witch action",
      phase: "night_witch",
      actionId: "witch-action-1",
      pendingInteraction: interaction("witch_action", ["witch-1"], "witch-action-1"),
    },
    {
      label: "day vote",
      phase: "day_vote",
      actionId: "day-vote-1",
    },
    {
      label: "hunter trigger",
      phase: "day_hunter",
      actionId: "hunter-shot-1",
      pendingInteraction: interaction("hunter_shot", ["hunter-1"], "hunter-shot-1"),
    },
  ];

  for (const scenario of scenarios) {
    it(`round-trips ${scenario.label} authoritative state`, () => {
      const room = baseRoom(scenario.phase, scenario.actionId);
      const snapshot = createRoomSnapshot(room, {
        revision: 9,
        ...(scenario.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: scenario.pendingInteraction }),
      });

      const persisted = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
      const restored = restoreRoomSnapshot(persisted);

      expect(restored.revision).toBe(9);
      expect(restored.room.game?.phase).toBe(scenario.phase);
      expect(restored.room.game?.actionId).toBe(scenario.actionId);
      expect(restored.pendingInteraction).toEqual(scenario.pendingInteraction);
      if (scenario.phase === "day_hunter") {
        expect(restored.room.game?.hunterTrigger).toBe("day");
      }
    });
  }

  it("round-trips relationships, copied ability sources and ability resources", () => {
    const room = baseRoom("night_werewolf", "wolf-action-2");
    const ruleState: WerewolfRuleState = {
      relationships: [
        {
          id: "lovers-1",
          kind: "lovers",
          sourceRolePlayerId: "cupid-1",
          playerIds: ["wolf-1", "witch-1"],
        },
      ],
      abilitySources: [
        {
          ownerPlayerId: "mechanical-wolf-1",
          sourcePlayerId: "hunter-1",
          sourceRoleId: "hunter",
          learnedNightNumber: 1,
          availableFromNightNumber: 2,
        },
      ],
      abilityResources: [
        {
          ownerPlayerId: "mechanical-wolf-1",
          key: "hunter_shot",
          remainingUses: 1,
        },
      ],
    };

    const snapshot = createRoomSnapshot(room, {
      revision: 10,
      ruleState,
      pendingInteraction: interaction("wolf_kill", ["wolf-1"], "wolf-action-2"),
    });
    const persisted = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const restored = restoreRoomSnapshot(persisted);

    expect(restored.ruleState).toEqual(ruleState);
    expect(restored.ruleState?.relationships[0]?.playerIds).toEqual(["wolf-1", "witch-1"]);
    expect(restored.ruleState?.abilitySources[0]).toMatchObject({
      ownerPlayerId: "mechanical-wolf-1",
      sourceRoleId: "hunter",
      availableFromNightNumber: 2,
    });
    expect(restored.ruleState?.abilityResources[0]).toEqual({
      ownerPlayerId: "mechanical-wolf-1",
      key: "hunter_shot",
      remainingUses: 1,
    });
  });
});
