import type { RandomProvider } from "../../core/random/RandomProvider.js";
import { defaultGameRandomSource } from "../../domain/gameRandom.js";
import {
  confirmSeerResult,
  GameRuleError,
  submitGuardTarget,
  submitHunterExecution,
  submitSeerTarget,
  submitWitchAction,
  submitWolfTarget,
  type GameState,
} from "./WerewolfDomainFacade.js";
import { getActiveWerewolfInteraction } from "./WerewolfNightPlanner.js";

export type WerewolfTimeoutRecoveryResult = {
  previousActionId: string;
  recovered: boolean;
};

export function isTimedWerewolfInteraction(game: GameState): boolean {
  if (
    game.phase === "night_guard" ||
    game.phase === "night_werewolf" ||
    game.phase === "night_witch" ||
    game.phase === "night_seer"
  ) {
    return true;
  }
  return game.phase === "day_hunter" && game.hunterTrigger === "night";
}

function actorFor(game: GameState): string {
  const interaction = getActiveWerewolfInteraction(game);
  const actor = interaction?.actorPlayerIds[0];
  if (!actor) throw new GameRuleError("当前没有可恢复的夜间行动");
  return actor;
}

/**
 * Game-owned timeout policy for secret Werewolf interactions.
 *
 * Runtimes own clocks and timeout delivery. This function owns the Werewolf
 * semantic decision for what a timed-out interaction means and mutates only
 * authoritative game state through the existing Werewolf domain facade.
 */
export function recoverTimedOutWerewolfInteraction(
  game: GameState,
  expectedActionId: string,
  random: RandomProvider = defaultGameRandomSource,
): WerewolfTimeoutRecoveryResult {
  if (game.actionId !== expectedActionId) {
    return { previousActionId: expectedActionId, recovered: false };
  }

  const actor = actorFor(game);

  switch (game.phase) {
    case "night_guard":
      submitGuardTarget(game, actor, null, expectedActionId, random);
      break;

    case "night_werewolf":
      submitWolfTarget(game, actor, null, expectedActionId, random);
      break;

    case "night_witch":
      submitWitchAction(
        game,
        actor,
        { useAntidote: false, poisonTargetId: null },
        expectedActionId,
        random,
      );
      break;

    case "night_seer": {
      if (!game.seerTargetId) {
        const fallbackTarget = Object.keys(game.roles).find(
          playerId => playerId !== actor && !game.deadPlayerIds.includes(playerId),
        );
        if (!fallbackTarget) throw new GameRuleError("预言家没有可查验的目标");
        submitSeerTarget(game, actor, fallbackTarget, expectedActionId);
        confirmSeerResult(game, actor, expectedActionId, random);

        // Timeout forfeits the unrevealed check. The temporary target exists
        // only to advance through the existing rule path and must not survive
        // into the authoritative view after recovery.
        delete game.seerTargetId;
        game.seerResultConfirmed = false;
      } else {
        confirmSeerResult(game, actor, expectedActionId, random);
      }
      break;
    }

    case "day_hunter":
      if (game.hunterTrigger !== "night") {
        throw new GameRuleError("白天猎人行动不使用夜间自动超时");
      }
      submitHunterExecution(game, actor, null, expectedActionId, random);
      break;

    default:
      throw new GameRuleError("当前阶段不支持夜间自动超时恢复");
  }

  return { previousActionId: expectedActionId, recovered: true };
}
