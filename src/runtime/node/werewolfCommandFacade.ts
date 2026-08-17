import type { GameState, Role } from "../../domain/game.js";
import {
  werewolfGameModule,
  type WerewolfCommand,
} from "../../games/werewolf/WerewolfGameModule.js";
import {
  executeWerewolfCommand,
  type RuntimeRoom,
  type WerewolfCommandOutcome,
} from "./roomBridge.js";

const commandDependencies = {
  random: {
    randomInt(maxExclusive: number) {
      return Math.floor(Math.random() * maxExclusive);
    },
    randomId() {
      return "unused-command-id";
    },
  },
};

function runStateCommand(
  state: GameState,
  playerId: string | undefined,
  isHost: boolean,
  command: WerewolfCommand,
): void {
  werewolfGameModule.handleCommand(
    state,
    { playerId, isHost, now: Date.now() },
    command,
    commandDependencies,
  );
}

export function runPlayerCommand(
  room: RuntimeRoom,
  playerId: string,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { playerId });
}

export function runHostCommand(
  room: RuntimeRoom,
  command: WerewolfCommand,
): WerewolfCommandOutcome {
  return executeWerewolfCommand(room, command, { isHost: true });
}

export function confirmRole(state: GameState, playerId: string, actionId?: string): boolean {
  const beforeCount = state.confirmedRolePlayerIds.length;
  runStateCommand(state, playerId, false, { type: "confirmRole", actionId });
  return state.confirmedRolePlayerIds.length > beforeCount && state.phase === "night_start";
}

export function submitWolfTarget(
  state: GameState,
  playerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  runStateCommand(state, playerId, false, { type: "submitWolfTarget", targetPlayerId, actionId });
  return state.actionId !== beforeActionId;
}

export function submitGuardTarget(
  state: GameState,
  playerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  runStateCommand(state, playerId, false, { type: "submitGuardTarget", targetPlayerId, actionId });
  return state.actionId !== beforeActionId;
}

export function submitWitchAction(
  state: GameState,
  playerId: string,
  action: { useAntidote?: boolean; poisonTargetId?: string | null },
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  runStateCommand(state, playerId, false, {
    type: "submitWitchAction",
    useAntidote: action.useAntidote,
    poisonTargetId: action.poisonTargetId,
    actionId,
  });
  return state.actionId !== beforeActionId;
}

export function submitSeerTarget(
  state: GameState,
  playerId: string,
  targetPlayerId: string | undefined,
  actionId?: string,
): Role {
  runStateCommand(state, playerId, false, { type: "submitSeerTarget", targetPlayerId, actionId });
  return state.roles[state.seerTargetId!]!;
}

export function confirmSeerResult(
  state: GameState,
  playerId: string,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  runStateCommand(state, playerId, false, { type: "confirmSeerResult", actionId });
  return state.actionId !== beforeActionId;
}

export function submitHunterExecution(
  state: GameState,
  playerId: string,
  targetPlayerId: string | null | undefined,
  actionId?: string,
): boolean {
  const beforeActionId = state.actionId;
  runStateCommand(state, playerId, false, { type: "submitHunterExecution", targetPlayerId, actionId });
  return state.actionId !== beforeActionId;
}

export function startNight(state: GameState): void {
  runStateCommand(state, undefined, true, { type: "startNight" });
}

export function startDayVote(state: GameState): void {
  runStateCommand(state, undefined, true, { type: "startDayVote" });
}

export function submitVote(
  state: GameState,
  playerId: string,
  targetId: string,
  actionId: string,
): boolean {
  const beforeVote = state.votes[playerId];
  runStateCommand(state, playerId, false, { type: "submitVote", targetId, actionId });
  return state.votes[playerId] !== beforeVote;
}

export function closeDayVote(state: GameState): "pk" | "no_kill" | string {
  runStateCommand(state, undefined, true, { type: "closeDayVote" });
  if (state.phase === "day_pk") return "pk";
  if (state.noKillToday) return "no_kill";
  return state.eliminatedTodayId ?? "no_kill";
}

export function beginNightStart(state: GameState): void {
  runStateCommand(state, undefined, true, { type: "beginNightStart" });
}
