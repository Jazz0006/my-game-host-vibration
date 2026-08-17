import type { PendingInteraction } from "../../core/interaction/PendingInteraction.js";
import type { GameState } from "../../domain/game.js";
import type { WerewolfRoleInteractionDefinition } from "./roles/RoleDefinition.js";

export type WerewolfDynamicNightPlanningContext<TRoleId extends string> = {
  nightNumber: number;
  assignments: Readonly<Record<string, TRoleId>>;
  game: GameState;
};

export type WerewolfDynamicNightRoleDefinition<TInteractionKind extends string> = {
  id: string;
  interaction?: WerewolfRoleInteractionDefinition<TInteractionKind>;
};

export type WerewolfDynamicNightRegistry<TInteractionKind extends string> = Readonly<
  Record<string, WerewolfDynamicNightRoleDefinition<TInteractionKind>>
>;

function scheduledForNight(schedule: "every_night" | "first_night_only", nightNumber: number): boolean {
  return schedule === "every_night" || nightNumber === 1;
}

/**
 * Pure architecture-spike planner for night interactions.
 *
 * Unlike the legacy planner, this function does not inspect GamePhase and does
 * not use NIGHT_ORDER. The actual assigned roles plus role metadata determine
 * which interactions exist and in what order they should run.
 *
 * The registry projection deliberately contains only id + interaction. The
 * orchestrator must not depend on lifecycle hooks, team rules, or other role
 * implementation details.
 */
export function planWerewolfNightInteractions<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  context: WerewolfDynamicNightPlanningContext<TRoleId>,
  registry: WerewolfDynamicNightRegistry<TInteractionKind>,
): Array<PendingInteraction<TInteractionKind>> {
  const planned: Array<{
    order: number;
    roleId: string;
    interaction: PendingInteraction<TInteractionKind>;
  }> = [];

  for (const definition of Object.values(registry)) {
    const interactionDefinition = definition.interaction;
    const timing = interactionDefinition?.night;
    if (!interactionDefinition || !timing) continue;
    if (!scheduledForNight(timing.schedule, context.nightNumber)) continue;
    if (interactionDefinition.isEnabled && !interactionDefinition.isEnabled(context.game)) continue;

    const actorPlayerIds = Object.entries(context.assignments)
      .filter(([playerId, assignedRole]) => {
        if (assignedRole !== definition.id) return false;
        if (interactionDefinition.allowDeadActors) {
          return context.game.deadPlayerIds.includes(playerId);
        }
        return !context.game.deadPlayerIds.includes(playerId);
      })
      .map(([playerId]) => playerId);

    if (actorPlayerIds.length === 0) continue;

    planned.push({
      order: timing.order,
      roleId: definition.id,
      interaction: {
        id: `night-${context.nightNumber}-${interactionDefinition.kind}`,
        kind: interactionDefinition.kind,
        actorPlayerIds,
        mode: interactionDefinition.mode,
        wakePolicy: interactionDefinition.wakePolicy,
        completionPolicy: interactionDefinition.completionPolicy,
        status: "pending",
      },
    });
  }

  planned.sort((left, right) => left.order - right.order || left.roleId.localeCompare(right.roleId));
  return planned.map(item => item.interaction);
}
