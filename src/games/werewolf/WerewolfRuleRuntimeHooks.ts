import type { GameRuleRuntimeHooks } from "../../domain/game.js";
import { collectWerewolfAfterDeathEffects } from "./roles/RoleHookRunner.js";
import { WEREWOLF_ROLE_REGISTRY } from "./roles/registry.js";

/**
 * Production adapter between the pure role hook runner and the legacy
 * domain phase/state model. The registry decides whether a role reaction is
 * triggered; this adapter currently maps only interaction effects used by the
 * production Hunter flow. Death effects are exercised by the B4 spike resolver
 * and are not yet wired into production domain settlement.
 */
export const WEREWOLF_RULE_RUNTIME_HOOKS: GameRuleRuntimeHooks = {
  afterDeath: (game, event, nextActionId) => {
    const effects = collectWerewolfAfterDeathEffects(
      game,
      event.deadPlayerId,
      event.cause,
      WEREWOLF_ROLE_REGISTRY,
    );
    const hunterShot = effects.find(
      effect => effect.type === "interaction" && effect.kind === "hunter_shot",
    );
    if (!hunterShot) return false;

    game.hunterTrigger = event.continuation;
    game.phase = "day_hunter";
    game.actionId = nextActionId();
    return true;
  },
};
