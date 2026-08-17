import type { PendingInteraction } from "../../core/interaction/PendingInteraction.js";
import type { GameState, Role } from "../../domain/game.js";
import type { WerewolfRoleDefinition } from "./roles/RoleDefinition.js";
import {
  WEREWOLF_ROLE_REGISTRY,
  type WerewolfInteractionKind,
} from "./roles/registry.js";

export type WerewolfInteraction = PendingInteraction<WerewolfInteractionKind>;

function actorsForDefinition(
  game: GameState,
  definition: WerewolfRoleDefinition<string, WerewolfInteractionKind>,
): string[] {
  return Object.entries(game.roles)
    .filter(([playerId, assignedRole]) => {
      if (assignedRole !== definition.id) return false;
      if (definition.interaction?.allowDeadActors) return game.deadPlayerIds.includes(playerId);
      return !game.deadPlayerIds.includes(playerId);
    })
    .map(([playerId]) => playerId);
}

function activeInteraction(
  game: GameState,
  definition: WerewolfRoleDefinition<string, WerewolfInteractionKind>,
): WerewolfInteraction | undefined {
  const interaction = definition.interaction;
  if (!interaction || interaction.phase !== game.phase) return undefined;
  if (interaction.isEnabled && !interaction.isEnabled(game)) return undefined;

  const actorPlayerIds = actorsForDefinition(game, definition);
  if (actorPlayerIds.length === 0) return undefined;

  return {
    id: game.actionId,
    kind: interaction.kind,
    actorPlayerIds,
    mode: interaction.mode,
    wakePolicy: interaction.wakePolicy,
    completionPolicy: interaction.completionPolicy,
    status: "active",
  };
}

/**
 * Resolves the current authoritative interaction from registered role data.
 *
 * The planner deliberately contains no role-specific phase switch. Adding a
 * normal action role should be a registry change, not an orchestrator change.
 * Complex roles can extend RoleDefinition with focused rule hooks later.
 */
export function getActiveWerewolfInteraction(
  game: GameState,
  registry: Readonly<Record<string, WerewolfRoleDefinition<string, WerewolfInteractionKind>>> =
    WEREWOLF_ROLE_REGISTRY,
): WerewolfInteraction | undefined {
  for (const definition of Object.values(registry)) {
    const interaction = activeInteraction(game, definition);
    if (interaction) return interaction;
  }
  return undefined;
}

/** Current legacy rules-engine role order, now sourced from role metadata. */
export function registeredNightOrder(): Role[] {
  return Object.values(WEREWOLF_ROLE_REGISTRY)
    .filter(definition => definition.nightOrder !== undefined)
    .sort((left, right) => (left.nightOrder ?? 0) - (right.nightOrder ?? 0))
    .map(definition => definition.id);
}
