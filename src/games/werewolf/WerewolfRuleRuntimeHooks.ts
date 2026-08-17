import type { GameRuleRuntimeHooks } from "../../domain/game.js";
import { collectWerewolfAfterDeathActions } from "./roles/RoleHookRunner.js";
import { WEREWOLF_ROLE_REGISTRY } from "./roles/registry.js";

/**
 * Production adapter between the pure B3 role hook runner and the legacy
 * domain phase/state model. The registry decides whether a role reaction is
 * triggered; this adapter only maps the currently supported hunter_shot
 * reaction onto the existing day_hunter flow.
 */
export const WEREWOLF_RULE_RUNTIME_HOOKS: GameRuleRuntimeHooks = {
  afterDeath: (game, event, nextActionId) => {
    const actions = collectWerewolfAfterDeathActions(
      game,
      event.deadPlayerId,
      event.cause,
      WEREWOLF_ROLE_REGISTRY,
    );
    const hunterShot = actions.find(action => action.kind === "hunter_shot");
    if (!hunterShot) return false;

    game.hunterTrigger = event.continuation;
    game.phase = "day_hunter";
    game.actionId = nextActionId();
    return true;
  },
};
