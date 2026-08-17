import type { GameState } from "../../../domain/game.js";
import type { WerewolfDeathCause, WerewolfRuleEffect } from "./RoleDefinition.js";
import {
  collectWerewolfAfterDeathEffects,
  type WerewolfRoleRegistryLike,
} from "./RoleHookRunner.js";
import type { WerewolfRuleState } from "./WerewolfRuleState.js";

export type WerewolfResolvedDeath = {
  playerId: string;
  cause: WerewolfDeathCause;
};

export type WerewolfDeathChainResult<TInteractionKind extends string = string> = {
  deaths: WerewolfResolvedDeath[];
  interactionEffects: WerewolfRuleEffect<TInteractionKind>[];
};

/**
 * Pure spike resolver for chained death effects. It does not mutate GameState;
 * callers decide how/when resolved deaths are committed to the production state.
 */
export function resolveWerewolfDeathChain<
  TRoleId extends string,
  TInteractionKind extends string,
>(
  game: GameState,
  initialDeath: WerewolfResolvedDeath,
  ruleState: WerewolfRuleState,
  registry: WerewolfRoleRegistryLike<TRoleId, TInteractionKind>,
): WerewolfDeathChainResult<TInteractionKind> {
  const queue: WerewolfResolvedDeath[] = [initialDeath];
  const resolvedPlayerIds = new Set(game.deadPlayerIds);
  const deaths: WerewolfResolvedDeath[] = [];
  const interactionEffects: WerewolfRuleEffect<TInteractionKind>[] = [];

  while (queue.length > 0) {
    const death = queue.shift()!;
    if (resolvedPlayerIds.has(death.playerId)) continue;

    resolvedPlayerIds.add(death.playerId);
    deaths.push(death);

    // Hooks should observe the same effective death set as the resolver even
    // though the original GameState is kept immutable for the spike.
    const hookGame: GameState = {
      ...game,
      deadPlayerIds: [...resolvedPlayerIds],
    };
    const effects = collectWerewolfAfterDeathEffects(
      hookGame,
      death.playerId,
      death.cause,
      registry,
      ruleState,
    );

    for (const effect of effects) {
      if (effect.type === "death") {
        if (!resolvedPlayerIds.has(effect.targetPlayerId)) {
          queue.push({ playerId: effect.targetPlayerId, cause: effect.cause });
        }
      } else {
        interactionEffects.push(effect);
      }
    }
  }

  return { deaths, interactionEffects };
}
