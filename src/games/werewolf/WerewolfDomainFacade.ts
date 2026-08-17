import {
  defaultGameRandomSource,
  type GameRandomSource,
} from "../../domain/gameRandom.js";
import {
  closeDayVote as domainCloseDayVote,
  confirmSeerResult as domainConfirmSeerResult,
  startNight as domainStartNight,
  submitGuardTarget as domainSubmitGuardTarget,
  submitWitchAction as domainSubmitWitchAction,
  submitWolfTarget as domainSubmitWolfTarget,
  type GameState,
} from "../../domain/game.js";
import { WEREWOLF_RULE_RUNTIME_HOOKS } from "./WerewolfRuleRuntimeHooks.js";

export {
  allAliveVoted,
  beginNightStart,
  checkVictory,
  configFromPlayerCount,
  configFromRoleDeck,
  confirmRole,
  dealRoles,
  playerIdForRole,
  startDayVote,
  startGame,
  submitHunterExecution,
  submitSeerTarget,
  submitVote,
  type GameConfig,
  type GamePhase,
  type GameState,
  type Role,
} from "../../domain/game.js";

export function startNight(
  state: GameState,
  random: GameRandomSource = defaultGameRandomSource,
): void {
  domainStartNight(state, random, WEREWOLF_RULE_RUNTIME_HOOKS);
}

export function submitWolfTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  return domainSubmitWolfTarget(
    state,
    actorPlayerId,
    targetPlayerId,
    actionId,
    random,
    WEREWOLF_RULE_RUNTIME_HOOKS,
  );
}

export function submitGuardTarget(
  state: GameState,
  actorPlayerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  return domainSubmitGuardTarget(
    state,
    actorPlayerId,
    targetPlayerId,
    actionId,
    random,
    WEREWOLF_RULE_RUNTIME_HOOKS,
  );
}

export function submitWitchAction(
  state: GameState,
  actorPlayerId: string,
  action: { useAntidote?: boolean; poisonTargetId?: string | null },
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  return domainSubmitWitchAction(
    state,
    actorPlayerId,
    action,
    actionId,
    random,
    WEREWOLF_RULE_RUNTIME_HOOKS,
  );
}

export function confirmSeerResult(
  state: GameState,
  actorPlayerId: string,
  actionId?: string,
  random: GameRandomSource = defaultGameRandomSource,
): boolean {
  return domainConfirmSeerResult(
    state,
    actorPlayerId,
    actionId,
    random,
    WEREWOLF_RULE_RUNTIME_HOOKS,
  );
}

export function closeDayVote(
  state: GameState,
  random: GameRandomSource = defaultGameRandomSource,
): "pk" | "no_kill" | string {
  return domainCloseDayVote(state, random, WEREWOLF_RULE_RUNTIME_HOOKS);
}
