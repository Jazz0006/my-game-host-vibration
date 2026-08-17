import type { PendingInteraction } from "../../core/interaction/PendingInteraction.js";
import type { GameState, Role } from "../../domain/game.js";

export type WerewolfInteractionKind =
  | "wolf_kill"
  | "guard_protect"
  | "witch_action"
  | "seer_check"
  | "hunter_shot";

export type WerewolfInteraction = PendingInteraction<WerewolfInteractionKind>;

function livingPlayersWithRole(game: GameState, role: Role): string[] {
  return Object.entries(game.roles)
    .filter(
      ([playerId, assignedRole]) =>
        assignedRole === role && !game.deadPlayerIds.includes(playerId),
    )
    .map(([playerId]) => playerId);
}

function activeInteraction(
  game: GameState,
  input: Omit<WerewolfInteraction, "id" | "status">,
): WerewolfInteraction {
  return {
    id: game.actionId,
    status: "active",
    ...input,
  };
}

/**
 * Maps the current Werewolf rules state to the single authoritative player
 * interaction that should be active right now.
 *
 * The existing phase state machine remains the rules-engine implementation
 * detail during PR B. Runtime/client code should consume this interaction
 * instead of independently translating night phases into acting players.
 */
export function getActiveWerewolfInteraction(
  game: GameState,
): WerewolfInteraction | undefined {
  switch (game.phase) {
    case "night_werewolf": {
      const actorPlayerIds = livingPlayersWithRole(game, "werewolf");
      if (actorPlayerIds.length === 0) return undefined;
      return activeInteraction(game, {
        kind: "wolf_kill",
        actorPlayerIds,
        mode: "group",
        wakePolicy: { vibrate: true, audioCue: "wolf_wake" },
        completionPolicy: { type: "any_actor_submission" },
      });
    }

    case "night_guard": {
      const actorPlayerIds = livingPlayersWithRole(game, "guard");
      if (actorPlayerIds.length === 0) return undefined;
      return activeInteraction(game, {
        kind: "guard_protect",
        actorPlayerIds,
        mode: "single",
        wakePolicy: { vibrate: true },
        completionPolicy: { type: "single_submission" },
      });
    }

    case "night_witch": {
      const actorPlayerIds = livingPlayersWithRole(game, "witch");
      if (actorPlayerIds.length === 0) return undefined;
      return activeInteraction(game, {
        kind: "witch_action",
        actorPlayerIds,
        mode: "single",
        wakePolicy: { vibrate: true },
        completionPolicy: { type: "single_submission" },
      });
    }

    case "night_seer": {
      const actorPlayerIds = livingPlayersWithRole(game, "seer");
      if (actorPlayerIds.length === 0) return undefined;
      return activeInteraction(game, {
        kind: "seer_check",
        actorPlayerIds,
        mode: "single",
        wakePolicy: { vibrate: true },
        completionPolicy: { type: "explicit_confirmation" },
      });
    }

    case "day_hunter": {
      const actorPlayerIds = Object.entries(game.roles)
        .filter(
          ([playerId, role]) =>
            role === "hunter" && game.deadPlayerIds.includes(playerId),
        )
        .map(([playerId]) => playerId);
      if (actorPlayerIds.length === 0) return undefined;
      return activeInteraction(game, {
        kind: "hunter_shot",
        actorPlayerIds,
        mode: "single",
        wakePolicy: { vibrate: true },
        completionPolicy: { type: "single_submission" },
      });
    }

    default:
      return undefined;
  }
}
