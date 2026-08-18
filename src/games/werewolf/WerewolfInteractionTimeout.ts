import { GameRuleError } from "../../domain/game.js";
import {
  activeInteraction,
  type RuntimeRoom,
} from "../../runtime/node/roomBridge.js";
import { runPlayerCommand } from "../../runtime/node/werewolfCommandFacade.js";

export type WerewolfTimeoutRecoveryResult = {
  previousActionId: string;
  recovered: boolean;
};

function actorFor(room: RuntimeRoom): string {
  const interaction = activeInteraction(room);
  const actor = interaction?.actorPlayerIds[0];
  if (!actor) throw new GameRuleError("当前没有可恢复的夜间行动");
  return actor;
}

/**
 * C4.4 timeout recovery deliberately completes only the current secret
 * interaction. It never advances an arbitrary phase and never exposes the
 * actor or secret answer to the host.
 *
 * For the seer, an already revealed result is auto-confirmed. If no target has
 * been selected, the runtime performs a temporary internal check solely to run
 * the existing night-settlement path, then erases that temporary result before
 * any player view is broadcast. The player therefore receives no information.
 */
export function recoverTimedOutWerewolfInteraction(
  room: RuntimeRoom,
  expectedActionId: string,
): WerewolfTimeoutRecoveryResult {
  const game = room.game;
  if (!game || game.actionId !== expectedActionId) {
    return { previousActionId: expectedActionId, recovered: false };
  }

  const actor = actorFor(room);

  switch (game.phase) {
    case "night_guard":
      runPlayerCommand(room, actor, {
        type: "submitGuardTarget",
        actionId: expectedActionId,
        targetPlayerId: null,
      });
      break;

    case "night_werewolf":
      runPlayerCommand(room, actor, {
        type: "submitWolfTarget",
        actionId: expectedActionId,
        targetPlayerId: null,
      });
      break;

    case "night_witch":
      runPlayerCommand(room, actor, {
        type: "submitWitchAction",
        actionId: expectedActionId,
        useAntidote: false,
        poisonTargetId: null,
      });
      break;

    case "night_seer": {
      if (!game.seerTargetId) {
        const fallbackTarget = Object.keys(game.roles).find(
          playerId => playerId !== actor && !game.deadPlayerIds.includes(playerId),
        );
        if (!fallbackTarget) throw new GameRuleError("预言家没有可查验的目标");
        runPlayerCommand(room, actor, {
          type: "submitSeerTarget",
          actionId: expectedActionId,
          targetPlayerId: fallbackTarget,
        });
        runPlayerCommand(room, actor, {
          type: "confirmSeerResult",
          actionId: expectedActionId,
        });
        delete game.seerTargetId;
        game.seerResultConfirmed = false;
      } else {
        runPlayerCommand(room, actor, {
          type: "confirmSeerResult",
          actionId: expectedActionId,
        });
      }
      break;
    }

    case "day_hunter":
      if (game.hunterTrigger !== "night") {
        throw new GameRuleError("白天猎人行动不使用夜间自动超时");
      }
      runPlayerCommand(room, actor, {
        type: "submitHunterExecution",
        actionId: expectedActionId,
        targetPlayerId: null,
      });
      break;

    default:
      throw new GameRuleError("当前阶段不支持夜间自动超时恢复");
  }

  return { previousActionId: expectedActionId, recovered: true };
}
